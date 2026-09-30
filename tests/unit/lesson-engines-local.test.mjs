// Generating a lesson with Claude Code or opencode instead of Codex.
//
// Production's Codex account ran out on 2026-09-30 and resets on 12.10: every
// generation there fails until then. Claude Code and opencode run on the
// tutor's own machine, so the library can be prepared there and imported
// (scripts/library-local.mjs, /api/library/import). The server keeps Codex:
// LESSON_ENGINE is unset there, and these engines are never its default.
//
// Stub CLIs stand in for the real ones, like tests/unit/lesson-engine.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'lesson-engines-local-'));

const { lessonEngine } = await import('../../src/lib/server/lesson/engine.ts');
const { generateLesson, extractJsonObject } = await import('../../src/lib/server/lesson/prep.ts');

const A_PLAN = {
  title: 'פונקציה לינארית', gradeContext: '4 יח"ל',
  slides: [{ heading: 'שיפוע', bullets: ['y = mx + b'] }],
  examples: [{ problem: 'y = 2x + 1', steps: ['m = 2'], answer: 'שיפוע 2' }],
  homework: [{ task: 'שרטטו y = x - 3', why: 'תרגול', answer: 'ישר דרך (0,-3)' }],
  games: {},
};
const REQUEST = { subject: 'מתמטיקה', request: 'פונקציה לינארית', level: 'כיתה יא', student: '' };

const KEYS = ['LESSON_ENGINE', 'CLAUDE_BIN', 'OPENCODE_BIN', 'CODEX_BIN', 'LESSON_MODEL', 'LESSON_TIMEOUT_MINUTES'];
async function withEnv(env, fn) {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return await fn(); } finally {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

/** A fake CLI that records its argv and stdin, then runs `body`. */
async function stub(body) {
  const dir = await mkdtemp(join(tmpdir(), 'stub-engine-'));
  const script = join(dir, 'engine');
  await writeFile(script, `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/argv.txt"
cat > "${dir}/stdin.txt"
${body}
`, { mode: 0o755 });
  const read = (f) => readFile(join(dir, f), 'utf8');
  return { script, dir, argv: async () => (await read('argv.txt')).split('\n').filter((_, i, a) => i < a.length - 1), stdin: () => read('stdin.txt') };
}

const json = JSON.stringify(A_PLAN);

test('the engine is Codex unless LESSON_ENGINE says otherwise, and a typo is refused', async () => {
  await withEnv({}, () => assert.equal(lessonEngine(), 'codex'));
  await withEnv({ LESSON_ENGINE: 'claude' }, () => assert.equal(lessonEngine(), 'claude'));
  await withEnv({ LESSON_ENGINE: 'opencode' }, () => assert.equal(lessonEngine(), 'opencode'));
  await withEnv({ LESSON_ENGINE: 'gpt' }, () => assert.throws(() => lessonEngine(), /codex, claude or opencode/));
});

test('Claude Code: the prompt goes on stdin, no tools, and the answer comes back on stdout', async () => {
  const s = await stub(`printf 'Here is the plan:\\n\\n\`\`\`json\\n%s\\n\`\`\`\\n' '${json}'`);
  await withEnv({ LESSON_ENGINE: 'claude', CLAUDE_BIN: s.script }, async () => {
    assert.deepEqual(await generateLesson(REQUEST), A_PLAN);
  });
  const argv = await s.argv();
  assert.ok(argv.includes('-p'), 'headless');
  const tools = argv.indexOf('--tools');
  assert.ok(tools >= 0 && argv[tools + 1] === '', 'no tools: the answer is text, it touches nothing');
  assert.match(await s.stdin(), /פונקציה לינארית/, 'the prompt arrived on stdin, never argv');
  assert.ok(!argv.some(a => a.includes('פונקציה לינארית')));
});

test('opencode: the prompt is an attached file, and colour codes and headers around the answer are dropped', async () => {
  const s = await stub(`f=""; while [ $# -gt 0 ]; do case "$1" in -f) f="$2"; shift 2;; *) shift;; esac; done
cp "$f" "${'$'}{0%/*}/attached.txt"
printf '\\033[91m> build · some-model\\033[0m\\n\\n%s\\n' '${json}'`);
  await withEnv({ LESSON_ENGINE: 'opencode', OPENCODE_BIN: s.script }, async () => {
    assert.deepEqual(await generateLesson(REQUEST), A_PLAN);
  });
  const argv = await s.argv();
  assert.equal(argv[0], 'run');
  assert.match(await readFile(join(s.dir, 'attached.txt'), 'utf8'), /פונקציה לינארית/, 'the prompt is the attached file');
  assert.ok(!argv.some(a => a.includes('פונקציה לינארית')), 'and never argv');
});

test('LESSON_MODEL picks the model for either engine', async () => {
  const s = await stub(`printf '%s' '${json}'`);
  await withEnv({ LESSON_ENGINE: 'claude', CLAUDE_BIN: s.script, LESSON_MODEL: 'opus' }, () => generateLesson(REQUEST));
  const argv = await s.argv();
  assert.equal(argv[argv.indexOf('--model') + 1], 'opus');
});

test('an answer with no plan in it is bad-output, a signed-out CLI is engine-auth', async () => {
  const prose = await stub(`printf 'Sorry, I cannot do that.'`);
  await withEnv({ LESSON_ENGINE: 'claude', CLAUDE_BIN: prose.script }, async () => {
    await assert.rejects(() => generateLesson(REQUEST), e => e.kind === 'bad-output');
  });
  const out = await stub(`printf 'Your organization has disabled Claude subscription access for Claude Code'; exit 1`);
  await withEnv({ LESSON_ENGINE: 'claude', CLAUDE_BIN: out.script }, async () => {
    await assert.rejects(() => generateLesson(REQUEST), e => e.kind === 'engine-auth');
  });
});

test('the JSON is found whatever surrounds it, and only a lone object counts', () => {
  assert.equal(extractJsonObject('\u001b[1m> build\u001b[0m\n{"a":1}\n'), '{"a":1}');
  assert.equal(extractJsonObject('text ```json\n{"a":{"b":2}}\n``` more'), '{"a":{"b":2}}');
  assert.equal(extractJsonObject('no object here'), null);
});

test('a local engine gets a longer budget than the server\'s Codex, and it can be set', async () => {
  const { lessonTimeoutMs } = await import('../../src/lib/server/lesson/prep.ts');
  await withEnv({}, () => assert.equal(lessonTimeoutMs(), 5 * 60_000, 'the server, on Codex: unchanged'));
  await withEnv({ LESSON_ENGINE: 'claude' }, () => assert.equal(lessonTimeoutMs(), 20 * 60_000));
  await withEnv({ LESSON_ENGINE: 'opencode', LESSON_TIMEOUT_MINUTES: '30' }, () => assert.equal(lessonTimeoutMs(), 30 * 60_000));
  await withEnv({ LESSON_TIMEOUT_MINUTES: 'soon' }, () => assert.equal(lessonTimeoutMs(), 5 * 60_000, 'nonsense is ignored'));
});
