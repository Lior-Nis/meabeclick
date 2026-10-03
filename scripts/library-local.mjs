#!/usr/bin/env node
/**
 * Prepares library lessons on this machine, with Claude Code or opencode,
 * and imports them into production's library.
 *
 *   node scripts/library-local.mjs --template math-4u --topic func
 *   node scripts/library-local.mjs --template math-4u --skill func.basics.linquad --skill func.basics.graph
 *   node scripts/library-local.mjs --due --ahead 3
 *
 *   --due                      what students need next and is not ready yet
 *                              (production's /api/library/due): each plan's
 *                              next --ahead skills, default 3
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
const due = flag('due');
const ahead = Number(opt('ahead', 3));
if (due ? !(Number.isInteger(ahead) && ahead > 0) : (!template || (!topic && !skills.length))) {
  console.error('usage: node scripts/library-local.mjs (--due [--ahead n] | --template <id> (--topic <key> | --skill <key>...)) [--engine claude|opencode] [--model m] [--dry-run] [--force]');
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

/** Production's library items, `template/skill` → status — read-only. */
async function productionItems() {
  const read = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
    const rows = db.prepare('SELECT template_id, skill_key, status FROM library_items').all();
    console.log(JSON.stringify(Object.fromEntries(rows.map(r => [r.template_id + '/' + r.skill_key, r.status]))));`;
  const text = await onBox('docker exec -i mea-beclick-app-1 node --no-warnings --input-type=module -', read);
  return JSON.parse(text.trim().split('\n').pop());
}

/* Posted, or read, on the box with its cron key, which never leaves it. */
const CRON = `set -a; . /home/meabeclick/mea-beclick/.cron-key.env; set +a; curl -sS -H "X-Cron-Key: $CRON_KEY" `;
const IMPORT = `${CRON}-X POST -H "Content-Type: application/json" --data-binary @- `
  + `-w '\\n%{http_code}' http://127.0.0.1:3000/api/library/import`;

/** What to prepare: [template, skill] pairs. */
async function jobs() {
  if (!due) {
    const keys = skills.length ? skills : topicSkillKeys(template, topic);
    if (!keys) { console.error(`no topic ${topic} in ${template}`); process.exit(2); }
    return keys.map(k => [template, k]);
  }
  const { due: list } = JSON.parse(await onBox(`${CRON}'http://127.0.0.1:3000/api/library/due?ahead=${ahead}'`));
  return list.filter(d => force || !d.ready).map(d => [d.templateId, d.skillKey]);
}

/** How long to wait before retrying a failed upload: about a deploy's restart. */
const RETRY_MS = Number(process.env.LIBRARY_RETRY_MS) || 30_000;

const todo = await jobs();
if (due && !todo.length) { console.log(`nothing due: every plan's next ${ahead} skills are ready`); process.exit(0); }
/* One template by hand: log the skill alone, as before. */
const label = ([t, k]) => (due ? `${t}/${k}` : k);
const items = dryRun ? {} : await productionItems();
let sent = 0;
for (const [i, job] of todo.entries()) {
  const [tpl, skill] = job;
  const name = label(job);
  const status = items[`${tpl}/${skill}`];
  if (status === 'ready' && !force) { console.log(`${name}: already ready in production, skipped`); continue; }
  if (status === 'queued' || status === 'preparing') { console.log(`${name}: being prepared in production, skipped`); continue; }

  const t0 = Date.now();
  let plan;
  try {
    plan = await generateLesson(libraryRequest(tpl, skill));
  } catch (err) {
    /* The engine's last words too: «claude exited 1» alone, 31 times,
       hid that the subscription had hit its limit (2026-10-03). This is
       the operator's own terminal, where the server would log it. */
    const said = String(err.detail ?? '').trim().split('\n').pop().slice(-300);
    console.log(`${name}: ${engine} failed (${err.kind ?? 'error'}): ${err.message}${said ? ` — ${said}` : ''}`);
    /* Out of usage, or signed out: every lesson after this one would fail
       the same way. Stop, and say what was not tried. */
    if (err.kind === 'engine-quota' || err.kind === 'engine-auth') {
      const what = err.kind === 'engine-quota' ? 'is out of usage' : 'is not signed in';
      console.log(`stopped: ${engine} ${what}. Not tried: ${todo.slice(i + 1).map(label).join(', ') || '(none)'}`);
      console.log(`done: ${sent} imported. Plans kept in ${out}`);
      process.exit(1);
    }
    continue;
  }
  const file = join(out, `${tpl}--${skill}.json`);
  await writeFile(file, JSON.stringify(plan, null, 2));
  const problems = validateLesson(plan);
  const secs = Math.round((Date.now() - t0) / 1000);
  if (problems.length) { console.log(`${name}: held here, not sent (${secs}s): ${problems.join(' · ')}  [${file}]`); continue; }
  if (dryRun) { console.log(`${name}: passes the check (${secs}s), not sent: dry run  [${file}]`); continue; }

  /* Retried once: a deploy restarting production mid-batch made curl fail
     to connect, and the unhandled rejection ended the whole batch. A plan
     that still cannot be sent is kept in --out and reported, and the
     batch goes on. */
  const body = JSON.stringify({ template: tpl, skill, plan, engine });
  let reply = null;
  for (let attempt = 1; attempt <= 2 && reply === null; attempt++) {
    try {
      reply = await onBox(IMPORT, body);
    } catch (err) {
      if (attempt === 1) await new Promise(r => setTimeout(r, RETRY_MS));
      else console.log(`${name}: upload failed (${err.message}); the plan is kept in ${file}`);
    }
  }
  if (reply === null) continue;
  const lines = reply.trim().split('\n');
  const code = lines.pop();
  console.log(`${name}: ${code === '200' ? 'imported, ready' : `refused ${code}`} (${secs}s) ${code === '200' ? '' : lines.join(' ')}`);
  if (code === '200') sent += 1;
}
console.log(`done: ${sent} imported. Plans kept in ${out}`);
