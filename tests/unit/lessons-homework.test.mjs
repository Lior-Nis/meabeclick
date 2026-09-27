import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'les-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const R = await import('../../src/lib/server/results.ts');
const { handle } = await import('../../src/lib/server/db.ts');

/* createLesson/finishLesson still write lessons_v2, which is 'unadopted' in
   storage-inventory.ts: the schema and the code exist, and no production
   path writes it yet. Runtime source is forbidden from READING it — an
   empty answer there is indistinguishable from "no lessons" and cost the
   tutor's card its entire lesson list — so this test reads it directly
   rather than through a helper that must not exist. */
const readLessonsV2 = (studentId) =>
  handle().prepare('SELECT * FROM lessons_v2 WHERE student_id = ? ORDER BY created_at DESC').all(studentId);

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const stu  = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('a generated slug always passes assertPathSegment', async () => {
  const { assertPathSegment } = await import('../../src/lib/server/urls.ts');
  for (let i = 0; i < 200; i++) {
    assertPathSegment('slug', L.newLessonSlug());   // throws on failure
  }
});

test('homework with no result is not submitted', () => {
  const slug = L.newLessonSlug();
  L.createLesson({ slug, studentId: stu.id, topic: 'אינטגרלים' });
  L.addHomework({ studentId: stu.id, task: 'משחק זיכרון', template: 'memory', dataId: 'noga-int-memory' });

  const hw = L.homeworkForStudent(stu.id);
  assert.equal(hw.length, 1);
  assert.equal(hw[0].submitted, false);
  assert.equal(hw[0].graded, false);
});

test('playing the game submits the homework — it does NOT grade it', () => {
  L.addHomework({ studentId: stu.id, task: 'ציד טעויות', template: 'error-hunt', dataId: 'noga-err' });
  R.writeResult({ studentId: stu.id, dataId: 'noga-err', template: 'error-hunt', score: 8, total: 10 });

  const item = L.homeworkForStudent(stu.id).find(h => h.data_id === 'noga-err');
  assert.equal(item.submitted, true, 'the child did the thing that was asked');
  /* And emphatically NOT graded. The score sits in results_v2 and nobody has
     looked at it — which is exactly what automatic grading would read later.
     Collapsing the two turns "she played it" into "it is finished and fine". */
  assert.equal(item.graded, false);
  assert.equal(item.grade, null);
});

test("another student's result does not complete this student's homework", () => {
  const other = E.createStudent({ code: 'other', name: 'אחר', accountId: acct.id, credential: 'q' });
  L.addHomework({ studentId: stu.id, task: 'משותף', template: 'quiz', dataId: 'shared-id' });
  R.writeResult({ studentId: other.id, dataId: 'shared-id', template: 'quiz', score: 10, total: 10 });

  const item = L.homeworkForStudent(stu.id).find(h => h.data_id === 'shared-id');
  // data_id is shared by every child given the same game, so matching on it
  // alone would let one child's play submit another's homework.
  assert.equal(item.submitted, false);
});

test('written work has no result to derive from, so it is submitted by hand', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגילים 1-10 בספר' });
  const find = () => L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(find().submitted, false);

  L.setHomeworkSubmitted(id, true, 'student');
  assert.equal(find().submitted, true);
  assert.equal(find().submitted_by, 'student', 'who said so is part of the claim');
  assert.equal(find().graded, false, 'saying you did it is not a mark');

  // Reversible: a child who taps it by accident has to be able to take it back.
  L.setHomeworkSubmitted(id, false, 'student');
  assert.equal(find().submitted, false);
});

test('grading records the submission too, because looking at work proves it exists', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגילים 11-20 בספר' });
  const find = () => L.homeworkForStudent(stu.id).find(h => h.id === id);

  L.gradeHomework(id, 'partial', 'teacher');
  assert.equal(find().graded, true);
  assert.equal(find().grade, 'partial');
  assert.equal(find().graded_by, 'teacher');
  assert.equal(find().submitted, true, 'she read it, so it was handed in');
});

test('a grade can be taken back without unsubmitting the work', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגיל נוסף' });
  L.setHomeworkSubmitted(id, true, 'student');
  L.gradeHomework(id, 'redo', 'teacher');
  L.gradeHomework(id, null);

  const row = L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(row.graded, false);
  assert.equal(row.grade, null);
  assert.equal(row.submitted, true, 'the child still did it');
});

test('an automatic grade is distinguishable from the tutor\'s', () => {
  // Grading can be machine-filled later. A parent is entitled to tell a mark
  // the tutor gave from one a program produced.
  const id = L.addHomework({ studentId: stu.id, task: 'משחק', template: 'quiz', dataId: 'auto-quiz' });
  L.gradeHomework(id, 'ok', 'auto');
  const row = L.homeworkForStudent(stu.id).find(h => h.id === id);
  assert.equal(row.graded_by, 'auto');
  assert.notEqual(row.graded_by, 'teacher');
});

test('a successful finish clears an earlier problem but keeps the other fields', () => {
  const slug = L.newLessonSlug();
  L.createLesson({ slug, studentId: stu.id, topic: 'אינטגרלים' });

  L.finishLesson(slug, { status: 'held', problem: 'חסרים פרטים על הכיתה' });
  const held = readLessonsV2(stu.id).find(l => l.slug === slug);
  assert.equal(held.problem, 'חסרים פרטים על הכיתה');

  L.finishLesson(slug, { status: 'ready', title: 'אינטגרציה בהצבה' });
  const ready = readLessonsV2(stu.id).find(l => l.slug === slug);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.problem, null, 'a stale problem survived a successful finish');
  assert.equal(ready.title, 'אינטגרציה בהצבה');

  // And the COALESCE'd fields survive a later status-only update.
  L.finishLesson(slug, { status: 'ready' });
  assert.equal(readLessonsV2(stu.id).find(l => l.slug === slug).title, 'אינטגרציה בהצבה',
    'a status-only update blanked a COALESCE-protected field');
});
