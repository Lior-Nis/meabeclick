// scripts/library-local.mjs --due: prepare, on the tutor's machine, what
// students will need next — read from production's /api/library/due on the
// box with its cron key — instead of a template and topic named by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

const PLAN = {
  title: 'שיעור', gradeContext: 'כיתה יא',
  slides: [1, 2, 3, 4].map(n => ({ heading: `שקף ${n}`, bullets: ['y = 2x + 1'] })),
  examples: [{ problem: 'y = 3x', steps: ['m = 3'], answer: '3' }],
  homework: [{ task: 'א', why: 'w', answer: 'k' }, { task: 'ב', why: 'w', answer: 'k' }],
  games: {
    quiz: { title: 'q', subject: 'm', questions: [
      { q: '1', options: ['a', 'b', 'c'], answer: 0, why: '', hint: '' },
      { q: '2', options: ['a', 'b', 'c'], answer: 1, why: '', hint: '' },
      { q: '3', options: ['a', 'b', 'c'], answer: 2, why: '', hint: '' },
    ] },
    sequence: { title: 's', subject: 'm', steps: ['1', '2', '3'] },
  },
};

/* A fake ssh: production's items (a docker exec) answer {}, the due list
   answers `due` and records the command it was asked, an import answers
   200 and records the template and skill it was sent. */
async function setup(due) {
  const dir = await mkdtemp(join(tmpdir(), 'library-due-'));
  await writeFile(join(dir, 'plan.json'), JSON.stringify(PLAN));
  await writeFile(join(dir, 'due.json'), JSON.stringify({ due }));
  await writeFile(join(dir, 'claude'), `#!/bin/sh\ncat > /dev/null\ncat "${dir}/plan.json"\n`, { mode: 0o755 });
  await writeFile(join(dir, 'ssh'), `#!/bin/sh
body=$(cat)
case "$2" in
  docker*) echo '{}' ;;
  *library/due*) echo "$2" > "${dir}/due-asked"; cat "${dir}/due.json" ;;
  *) echo "$body" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const b=JSON.parse(s);console.log(b.template+"/"+b.skill)})' >> "${dir}/imported"
     printf '{"item":{}}\\n200' ;;
esac
`, { mode: 0o755 });
  return dir;
}

const run = (dir, extra) => new Promise(resolve => execFile('node', ['--no-warnings', 'scripts/library-local.mjs',
  '--due', ...extra, '--out', dir],
  { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_BIN: join(dir, 'claude') } },
  (err, stdout, stderr) => resolve({ code: err?.code ?? 0, text: stdout + stderr })));

test('--due prepares what is due and not ready, across templates', async () => {
  const dir = await setup([
    { templateId: 'math-4u', skillKey: 'func.basics.linquad', ready: false },
    { templateId: 'math-4u', skillKey: 'func.basics.graph', ready: true },
    { templateId: 'math-9', skillKey: 'alg.expr.distrib', ready: false },
  ]);
  const r = await run(dir, ['--ahead', '2']);
  assert.equal(r.code, 0, r.text);
  assert.match(await readFile(join(dir, 'due-asked'), 'utf8'), /ahead=2/);
  assert.deepEqual((await readFile(join(dir, 'imported'), 'utf8')).trim().split('\n'),
    ['math-4u/func.basics.linquad', 'math-9/alg.expr.distrib'], 'the ready one is not redone');
  assert.match(r.text, /math-4u\/func\.basics\.linquad: imported, ready/);
  assert.match(r.text, /done: 2 imported/);
});

test('--due with nothing due says so and sends nothing', async () => {
  const dir = await setup([{ templateId: 'math-4u', skillKey: 'func.basics.graph', ready: true }]);
  const r = await run(dir, []);
  assert.equal(r.code, 0, r.text);
  assert.match(await readFile(join(dir, 'due-asked'), 'utf8'), /ahead=3/, 'three ahead by default');
  assert.match(r.text, /nothing due/);
  await assert.rejects(readFile(join(dir, 'imported'), 'utf8'));
});
