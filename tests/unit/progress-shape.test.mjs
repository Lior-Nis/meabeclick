// tests/unit/progress-shape.test.mjs
//
// One shape for progress, declared once.
//
// PR #93 replaced a hand-typed integer on students_v2 with a computed
// ProgressFacts object — { kind, done, total, percent, note }. The student
// page was updated. The parent page was not: it kept its own hand-written
// `progress?: number` and rendered `{CURRENT.progress || 0}%`, which put
//
//     [object Object]%
//
// on a paying parent's screen, under a heading that reads
// "רמת התקדמות כללית". Found by QA'ing an unrelated fix in a browser; no
// test and no type-check caught it, because the page's own declaration of
// the shape was wrong in the same way as the code that used it.
//
// That is the real defect. Two pages and one server each hand-copied the
// same payload shape, so the copies could disagree and TypeScript was
// checking each page against its own mistake. The type now lives in
// src/lib/progress-facts.ts and is imported everywhere, which is what makes
// the next divergence a compile error instead of a screenshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');

const PAGES = [
  'src/routes/app/parent/+page.svelte',
  'src/routes/app/student/+page.svelte',
];

test('the progress shape is defined in one client-safe place', () => {
  const shape = read('src/lib/progress-facts.ts');
  assert.match(shape, /export (interface|type) ProgressFacts/);
  for (const field of ['kind', 'done', 'total', 'percent', 'note']) {
    assert.match(shape, new RegExp(`\\b${field}\\b`), `ProgressFacts must carry ${field}`);
  }
});

test('the server computes that same shape rather than its own', () => {
  const server = read('src/lib/server/progress.ts');
  assert.match(server, /from '\.\.\/progress-facts\.ts'/,
    'relative import inside src/lib/server/**, per the repo rule');
  assert.doesNotMatch(server, /export interface ProgressFacts \{/,
    'the server must not redeclare the shape it imports');
});

test('no page hand-copies the progress shape', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.match(src, /ProgressFacts/, `${p} must use the shared type`);
    assert.doesNotMatch(src, /progress\??:\s*number/,
      `${p} declares progress as a number — that is the bug this file exists for`);
    assert.doesNotMatch(src, /progress\??:\s*\{/,
      `${p} redeclares the shape inline, which is how the copies drifted`);
  }
});

test('the parent page renders the derived percent, not the object', () => {
  const src = read('src/routes/app/parent/+page.svelte');
  assert.doesNotMatch(src, /CURRENT\.progress \|\| 0/,
    'rendering the object itself is what produced "[object Object]%"');
  assert.match(src, /progress\?\.percent/,
    'percent is the only field derived from done/total, so it is the one to show');
});
