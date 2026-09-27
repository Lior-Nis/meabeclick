// tests/unit/material-rules.test.mjs
//
// The two rules src/lib/server/materials.ts states about itself, made true.
//
// Its header says:
//
//   "A student may only ever be shown a version with `published_at` set."
//   "Generation may never remove or overwrite a version the tutor edited."
//
// Neither held. The table had exactly one consumer — the tutor's own API
// route — and neither generation nor the student's slides route went near
// it. Generation writes `lessons/<slug>/slides.html` to disk and the
// student reads that same file, so a regeneration silently overwrote a
// tutor's correction and the published/draft distinction decided nothing.
//
// That is the failure Todoist id:6hRhqV8XX5wr4jqq names first:
// «תיקונים ידניים עלולים להיעלם ביצירה מחדש או להיחשף לתלמיד לפני בדיקה».
//
// Same shape as the bugs in storage-inventory.ts, one level up: not a table
// nobody writes, but an invariant nobody enforces, stated in a doc comment
// where it reads as a guarantee.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'mat-')), 'results.db');
const M = await import('../../src/lib/server/materials.ts');
const { recordGenerated, publishableSlides } = await import('../../src/lib/server/materials.ts');

let seq = 0;
const slug = () => `lesson-${++seq}`;

test('generation records its output as a version', () => {
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{"a":1}' });
  const row = M.latest(s, 'slides');
  assert.equal(row.content, '<html>v1</html>');
  assert.equal(row.origin, 'generated');
});

test('a freshly generated lesson is publishable straight away', () => {
  // Nothing has been edited, so there is nothing to protect and no reason
  // to make the tutor press publish before a student can see a lesson she
  // has not touched.
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{}' });
  assert.equal(publishableSlides(s), '<html>v1</html>');
});

test('regeneration does not overwrite a tutor edit', () => {
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{}' });
  M.addMaterial({ slug: s, kind: 'slides', content: '<html>hers</html>', origin: 'edited', publish: true });

  recordGenerated(s, { slides: '<html>v2</html>', plan: '{}' });

  // The new generation is kept — it is not thrown away — but it does not
  // become what the student sees.
  assert.equal(M.latest(s, 'slides').content, '<html>v2</html>');
  assert.equal(publishableSlides(s), '<html>hers</html>',
    "the tutor's published correction must survive a regeneration");
});

test("a tutor's edit is still findable after regeneration", () => {
  // "Restore" has to be a real operation. The version being restored must
  // still be on disk exactly as written.
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{}' });
  M.addMaterial({ slug: s, kind: 'slides', content: '<html>hers</html>', origin: 'edited', publish: true });
  recordGenerated(s, { slides: '<html>v2</html>', plan: '{}' });

  const versions = M.history(s, 'slides');
  assert.ok(versions.some(v => v.content === '<html>hers</html>' && v.origin === 'edited'));
  assert.equal(versions.length, 3, 'nothing is replaced; everything appends');
});

test('an unpublished draft is never what a student would get', () => {
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{}' });
  M.addMaterial({ slug: s, kind: 'slides', content: '<html>draft</html>', origin: 'edited' });
  assert.equal(publishableSlides(s), '<html>v1</html>',
    'a draft is by definition something she has not approved');
});

test('a lesson with no recorded material publishes nothing', () => {
  // Every lesson generated before this existed. The caller falls back to
  // the file on disk rather than 404ing a real lesson.
  assert.equal(publishableSlides('never-generated'), null);
});

test('regeneration after the tutor publishes an edit still protects it', () => {
  // The guard keys on "has she edited", not on "is there a draft" — an
  // edit she already published is the strongest possible statement that she
  // wants it.
  const s = slug();
  recordGenerated(s, { slides: '<html>v1</html>', plan: '{}' });
  M.addMaterial({ slug: s, kind: 'slides', content: '<html>hers</html>', origin: 'edited', publish: true });
  recordGenerated(s, { slides: '<html>v2</html>', plan: '{}' });
  recordGenerated(s, { slides: '<html>v3</html>', plan: '{}' });
  assert.equal(publishableSlides(s), '<html>hers</html>');
});
