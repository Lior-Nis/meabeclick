/**
 * Teaching material as versions: drafts, publishing, history, restore, and
 * the two rules that make an editor safe to give a tutor.
 *
 *   A student may only ever be shown a version with published_at set.
 *   Generation may never remove or overwrite a version the tutor edited.
 *
 * Both are the point of the table. Before it, one slides.html per lesson
 * meant writing was both the edit AND the publish, and the previous content
 * was gone — so a correction could not be made without being published, and
 * regenerating destroyed it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'materials-')), 'results.db');

const E = await import('../../src/lib/server/entities.ts');
const M = await import('../../src/lib/server/materials.ts');

let seq = 0;
/* Material is keyed on the lesson SLUG, not on a row id — there are two
   lessons tables and the newer one is empty in production, so a foreign key
   would be a bet on which wins. See migration 012. */
function freshLesson() {
  seq += 1;
  return `lesson-${seq}`;
}

const content = (s) => JSON.stringify({ title: s });

test('a new version is a draft unless publishing is asked for', () => {
  const id = freshLesson();
  const row = M.addMaterial({ slug: id, kind: 'plan', content: content('a'), origin: 'generated' });

  assert.equal(row.version, 1);
  assert.equal(row.published_at, null);
  // Forgetting the flag must mean a student sees LESS, never something
  // unreviewed.
  assert.equal(M.latestPublished(id, 'plan'), null);
  assert.equal(M.latest(id, 'plan').version, 1);
});

test('a student only ever sees the newest PUBLISHED version', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('v1'), origin: 'generated', publish: true });
  M.addMaterial({ slug: id, kind: 'plan', content: content('v2-draft'), origin: 'edited' });

  assert.equal(JSON.parse(M.latestPublished(id, 'plan').content).title, 'v1',
    'an unpublished correction must not reach a student');
  assert.equal(JSON.parse(M.latest(id, 'plan').content).title, 'v2-draft',
    'while the tutor keeps working on it');
});

test('publishing the draft is what changes what the student sees', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('v1'), origin: 'generated', publish: true });
  const draft = M.addMaterial({ slug: id, kind: 'plan', content: content('v2'), origin: 'edited' });

  M.publishVersion(id, 'plan', draft.version);
  assert.equal(JSON.parse(M.latestPublished(id, 'plan').content).title, 'v2');
});

test('publishing twice does not rewrite when it went out', () => {
  const id = freshLesson();
  const row = M.addMaterial({ slug: id, kind: 'plan', content: content('v1'), origin: 'generated' });
  const first = M.publishVersion(id, 'plan', row.version);
  const again = M.publishVersion(id, 'plan', row.version);
  // A published version went to a student at a particular moment; moving
  // that timestamp would make the history lie about when.
  assert.equal(again.published_at, first.published_at);
});

test('regenerating never destroys the tutor\'s correction', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('generated-1'), origin: 'generated', publish: true });
  M.addMaterial({ slug: id, kind: 'plan', content: content('her-fix'), origin: 'edited', publish: true });

  // The agent runs again.
  M.addMaterial({ slug: id, kind: 'plan', content: content('generated-2'), origin: 'generated' });

  const versions = M.history(id, 'plan').map(r => JSON.parse(r.content).title);
  assert.deepEqual(versions, ['generated-2', 'her-fix', 'generated-1'],
    'her correction is still there to return to');
  // And the new generation is a draft, so regenerating alone cannot change
  // what the student is looking at.
  assert.equal(JSON.parse(M.latestPublished(id, 'plan').content).title, 'her-fix');
});

test('a caller can ask whether regenerating would land on unpublished work', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('g'), origin: 'generated', publish: true });
  assert.equal(M.hasUnpublishedEdits(id, 'plan'), false);

  M.addMaterial({ slug: id, kind: 'plan', content: content('wip'), origin: 'edited' });
  assert.equal(M.hasUnpublishedEdits(id, 'plan'), true, 'worth telling her before she regenerates');
});

test('restoring copies an old version forward rather than reviving it', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('good'), origin: 'generated', publish: true });
  M.addMaterial({ slug: id, kind: 'plan', content: content('bad'), origin: 'edited', publish: true });

  const restored = M.restoreVersion(id, 'plan', 1, { publish: true });

  assert.equal(restored.version, 3, 'a new version, not a resurrected one');
  assert.equal(restored.origin, 'restored');
  assert.equal(JSON.parse(M.latestPublished(id, 'plan').content).title, 'good');
  // Re-publishing version 1 in place would have changed nothing, because
  // latestPublished takes the highest version number.
  assert.equal(M.history(id, 'plan').length, 3, 'and the bad version is still in the history');
});

test('teacher-only content is not returned by the student-facing read', () => {
  const id = freshLesson();
  M.addMaterial({
    slug: id, kind: 'plan',
    content: content('for the student'),
    teacherOnly: JSON.stringify({ solutions: ['x = 4'], note: 'להזכיר לה לבדוק תחום הגדרה' }),
    origin: 'generated', publish: true,
  });

  const forStudent = M.latestPublished(id, 'plan');
  // Not "it is stripped" — it is never selected, so a route that forgets to
  // remove it returns less rather than more.
  assert.equal('teacher_only' in forStudent, false);
  assert.doesNotMatch(JSON.stringify(forStudent), /x = 4/);
  assert.doesNotMatch(JSON.stringify(forStudent), /תחום הגדרה/);

  assert.match(M.latest(id, 'plan').teacher_only, /x = 4/, 'but the tutor keeps it');
});

test('versions are per kind, so slides and plan do not share a counter', () => {
  const id = freshLesson();
  M.addMaterial({ slug: id, kind: 'plan', content: content('p1'), origin: 'generated' });
  M.addMaterial({ slug: id, kind: 'slides', content: '<h1>s1</h1>', origin: 'generated' });
  M.addMaterial({ slug: id, kind: 'plan', content: content('p2'), origin: 'edited' });

  assert.equal(M.latest(id, 'plan').version, 2);
  assert.equal(M.latest(id, 'slides').version, 1);
});

test('one lesson\'s material never appears under another', () => {
  const a = freshLesson();
  const b = freshLesson();
  M.addMaterial({ slug: a, kind: 'plan', content: content('a-only'), origin: 'generated', publish: true });

  assert.equal(M.latest(b, 'plan'), null);
  assert.equal(M.latestPublished(b, 'plan'), null);
  assert.deepEqual(M.history(b, 'plan'), []);
});

test('publishing or restoring a version that does not exist answers null', () => {
  const id = freshLesson();
  assert.equal(M.publishVersion(id, 'plan', 99), null);
  assert.equal(M.restoreVersion(id, 'plan', 99), null);
});

test('migration 012 names every writer of lesson_materials that exists', async () => {
  // Its comment once said generation never writes here, the day after
  // recordGenerated() started doing exactly that (#106). Pin the writers the
  // comment names against the code, so the next one cannot go stale quietly.
  const { readFileSync } = await import('node:fs');
  const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const doc = src('src/lib/server/migrations/012_lesson_materials.ts');
  assert.match(src('src/lib/server/lesson/queue.ts'), /recordGenerated\(/);
  assert.match(doc, /recordGenerated\(\)/);
  assert.doesNotMatch(doc, /generation does NOT write/i);
});
