/**
 * The lesson record a family sees — pre-launch review, 2026-09-28
 * (Todoist 6hfCvVX9fVVmq89H). Generation at BOOKING time added the lesson
 * to the family's page dated today, with the plan's gradeContext — a note
 * for the tutor — as its "summary"; so «שיעורים שנעשו: 1» appeared before
 * the first lesson. And the slides the page promised were never linked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const { toFamilyLesson } = await import('../../src/lib/family-lesson.ts');

test('a generated lesson links its slides and hides the tutor-facing note', () => {
  const l = toFamilyLesson({ date: '2027-04-05', topic: 'שברים', summary: 'נלמד בכיתה ז; נדרש: מכנה משותף', slug: 'noga-mtmtik-x1' }, '2027-04-01');
  assert.equal(l.slidesUrl, '/lessons/noga-mtmtik-x1');
  assert.equal(l.summary, null, 'gradeContext was written for the tutor');
  assert.equal(l.upcoming, true);
});

test('a lesson on or before today has happened; an imported one keeps its summary', () => {
  const l = toFamilyLesson({ date: '2027-04-01', topic: 'אחוזים', summary: 'חזרנו על אחוזים לקראת המבחן' }, '2027-04-01');
  assert.equal(l.upcoming, false);
  assert.equal(l.summary, 'חזרנו על אחוזים לקראת המבחן', 'no slug: written for the family, from the old ledger');
  assert.equal(l.slidesUrl, null);
});

test('an unusable slug is not turned into a link', () => {
  assert.equal(toFamilyLesson({ date: '2027-04-05', topic: 't', slug: '../etc' }, '2027-04-01').slidesUrl, null);
});

test('generation records the LESSON date and no summary', () => {
  const q = read('src/lib/server/lesson/queue.ts');
  assert.match(q, /\{ date: hold\.lessonDate \?\? today\(\), topic: plan\.title, slug: published\.slug \}/);
  assert.match(q, /lessonDate: booking\.start \? israelDay\(booking\.start\) : null/);
});

test('both family pages count only lessons that have happened, and show what is coming', () => {
  const parent = read('src/routes/app/parent/+page.svelte');
  const student = read('src/routes/app/student/+page.svelte');
  assert.match(parent, /filter\(l => !l\.upcoming\)/);
  assert.match(student, /filter\(l => !l\.upcoming\)/);
  assert.match(student, /לקראת השיעור/);
});

test('the parent can open the child\'s board, and the slides, from their page', () => {
  const parent = read('src/routes/app/parent/+page.svelte');
  assert.match(parent, /href="\/app\/student\?s=\{currentId\}"/);
  assert.match(parent, /l\.slidesUrl/);
  assert.match(read('src/routes/api/portal/[code]/+server.ts'), /toFamilyLesson\(/);
});
