// scripts/library-local.mjs and an upload that fails.
//
// Found 2026-10-02: a deploy restarted production while the batch was
// uploading «calc.explog.growth». curl could not connect, ssh exited 7, the
// rejection was unhandled, and the script died with the rest of that topic
// untried. An upload failure is now retried once, and otherwise logged as
// that skill's failure, and the batch goes on.
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

async function setup({ failFirstImports }) {
  const dir = await mkdtemp(join(tmpdir(), 'library-upload-'));
  await writeFile(join(dir, 'plan.json'), JSON.stringify(PLAN));
  await writeFile(join(dir, 'claude'), `#!/bin/sh\ncat > /dev/null\ncat "${dir}/plan.json"\n`, { mode: 0o755 });
  /* A fake ssh: the read of production's items (a docker exec) answers {}, an import
     fails its first ${failFirstImports} times (curl's "could not connect",
     exit 7) and then answers 200. */
  await writeFile(join(dir, 'ssh'), `#!/bin/sh
body=$(cat)
case "$2" in
  docker*) echo '{}' ;;
  *) n=$(cat "${dir}/imports" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/imports"
     if [ $n -le ${failFirstImports} ]; then echo "curl: (7) Failed to connect" >&2; exit 7; fi
     printf '{"item":{}}\\n200' ;;
esac
`, { mode: 0o755 });
  return dir;
}

const run = (dir) => new Promise(resolve => execFile('node', ['--no-warnings', 'scripts/library-local.mjs',
  '--template', 'math-4u', '--skill', 'func.basics.linquad', '--skill', 'func.basics.graph', '--out', dir],
  { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, CLAUDE_BIN: join(dir, 'claude'), LIBRARY_RETRY_MS: '10' } },
  (err, stdout, stderr) => resolve({ code: err?.code ?? 0, text: stdout + stderr })));

test('an upload that fails once is retried, and the batch goes on', async () => {
  const dir = await setup({ failFirstImports: 1 });
  const r = await run(dir);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /func\.basics\.linquad: imported, ready/);
  assert.match(r.text, /func\.basics\.graph: imported, ready/);
  assert.equal((await readFile(join(dir, 'imports'), 'utf8')).trim(), '3', 'one retry, then the next skill');
});

test('an upload that keeps failing is that skill\'s failure, not the end of the batch', async () => {
  const dir = await setup({ failFirstImports: 2 });
  const r = await run(dir);
  assert.match(r.text, /func\.basics\.linquad: upload failed/);
  assert.match(r.text, /func\.basics\.graph: imported, ready/, 'the next skill still went');
  assert.match(r.text, /done: 1 imported/);
});
