#!/usr/bin/env node
/**
 * Prepares library lessons on this machine, with Claude Code or opencode,
 * and imports them into production's library.
 *
 *   node scripts/library-local.mjs --template math-4u --topic func
 *   node scripts/library-local.mjs --template math-4u --skill func.basics.linquad --skill func.basics.graph
 *
 *   --engine claude|opencode   default claude
 *   --model <name>             passed to the engine (LESSON_MODEL)
 *   --dry-run                  generate and check, send nothing
 *   --force                    also redo skills already ready in production
 *   --host <ssh host>          default mea
 *
 * Why it exists: production generates with Codex, and when that account is
 * out of usage (2026-09-30 → 12.10) no lesson can be made there. Here the
 * request, prompt, post-processing and check are the server's own
 * (libraryRequest, generateLesson, validateLesson); only the engine
 * differs, and only a lesson that passes the check is sent. The server
 * checks it again and records the engine, so the gate never counts it as a
 * Codex run (migration 025).
 *
 * Sent over ssh and posted ON the box with its cron key, which never leaves
 * it. Generated plans are kept under --out (default: a temp dir) either way.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const flag = (name) => args.includes(`--${name}`);

const template = opt('template');
const topic = opt('topic');
const skills = all('skill');
const engine = opt('engine', 'claude');
const host = opt('host', 'mea');
const dryRun = flag('dry-run');
const force = flag('force');
if (!template || (!topic && !skills.length)) {
  console.error('usage: node scripts/library-local.mjs --template <id> (--topic <key> | --skill <key>...) [--engine claude|opencode] [--model m] [--dry-run] [--force]');
  process.exit(2);
}
if (!['claude', 'opencode'].includes(engine)) { console.error('--engine must be claude or opencode'); process.exit(2); }

/* Set BEFORE the server modules load: db.ts opens DATA_DIR at import, and
   nothing here should touch this machine's own data. */
process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'library-local-db-'));
process.env.LESSON_ENGINE = engine;
if (opt('model')) process.env.LESSON_MODEL = opt('model');
const out = opt('out') ?? await mkdtemp(join(tmpdir(), 'library-local-'));
await mkdir(out, { recursive: true });

const { libraryRequest } = await import('../src/lib/server/library/prepare.ts');
const { topicSkillKeys } = await import('../src/lib/server/library/view.ts');
const { generateLesson, validateLesson } = await import('../src/lib/server/lesson/prep.ts');

const keys = skills.length ? skills : topicSkillKeys(template, topic);
if (!keys) { console.error(`no topic ${topic} in ${template}`); process.exit(2); }

/** Runs `remote` on the box, `input` on its stdin; resolves with stdout. */
function onBox(remote, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [host, remote], { stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', c => { stdout += c; });
    child.on('error', reject);
    child.on('close', code => (code === 0 ? resolve(stdout) : reject(new Error(`ssh ${host} exited ${code}`))));
    child.stdin.end(input);
  });
}

/** Production's library items for this template — read-only. */
async function productionItems() {
  const read = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
    const rows = db.prepare('SELECT skill_key, status FROM library_items WHERE template_id = ?').all(${JSON.stringify(template)});
    console.log(JSON.stringify(Object.fromEntries(rows.map(r => [r.skill_key, r.status]))));`;
  const text = await onBox('docker exec -i mea-beclick-app-1 node --no-warnings --input-type=module -', read);
  return JSON.parse(text.trim().split('\n').pop());
}

const IMPORT = `set -a; . /home/meabeclick/mea-beclick/.cron-key.env; set +a; `
  + `curl -sS -X POST -H "X-Cron-Key: $CRON_KEY" -H "Content-Type: application/json" --data-binary @- `
  + `-w '\\n%{http_code}' http://127.0.0.1:3000/api/library/import`;

const items = dryRun ? {} : await productionItems();
let sent = 0;
for (const [i, skill] of keys.entries()) {
  const status = items[skill];
  if (status === 'ready' && !force) { console.log(`${skill}: already ready in production, skipped`); continue; }
  if (status === 'queued' || status === 'preparing') { console.log(`${skill}: being prepared in production, skipped`); continue; }

  const t0 = Date.now();
  let plan;
  try {
    plan = await generateLesson(libraryRequest(template, skill));
  } catch (err) {
    console.log(`${skill}: ${engine} failed (${err.kind ?? 'error'}): ${err.message}`);
    /* Out of usage, or signed out: every lesson after this one would fail
       the same way. Stop, and say what was not tried. */
    if (err.kind === 'engine-quota' || err.kind === 'engine-auth') {
      const what = err.kind === 'engine-quota' ? 'is out of usage' : 'is not signed in';
      console.log(`stopped: ${engine} ${what}. Not tried: ${keys.slice(i + 1).join(', ') || '(none)'}`);
      console.log(`done: ${sent} imported. Plans kept in ${out}`);
      process.exit(1);
    }
    continue;
  }
  const file = join(out, `${template}--${skill}.json`);
  await writeFile(file, JSON.stringify(plan, null, 2));
  const problems = validateLesson(plan);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) { console.log(`${skill}: held here, not sent (${secs}s): ${problems.join(' · ')}  [${file}]`); continue; }
  if (dryRun) { console.log(`${skill}: passes the check (${secs}s), not sent: dry run  [${file}]`); continue; }

  const reply = await onBox(IMPORT, JSON.stringify({ template, skill, plan, engine }));
  const lines = reply.trim().split('\n');
  const code = lines.pop();
  console.log(`${skill}: ${code === '200' ? 'imported, ready' : `refused ${code}`} (${secs}s) ${code === '200' ? '' : lines.join(' ')}`);
  if (code === '200') sent += 1;
}
console.log(`done: ${sent} imported. Plans kept in ${out}`);
