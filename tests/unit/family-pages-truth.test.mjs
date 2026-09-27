/**
 * The family pages read the shapes the server sends. Two had drifted, like
 * the tutor's checkbox did (#126): the parent page read `h.done`, which the
 * portal API never sends, so every task said «פתוח» forever; and it showed
 * a progress note from a file field nothing writes, while the tutor's real
 * note went to the CHILD's page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const parent = read('src/routes/app/parent/+page.svelte');
const student = read('src/routes/app/student/+page.svelte');
const { homeworkState } = await import('../../src/lib/family-homework.ts');
const { lessonWhen } = await import('../../src/lib/dates.ts');

test('homework has three honest states, from the two stages the server sends', () => {
  assert.equal(homeworkState({ submitted: false, graded: false }), 'open');
  assert.equal(homeworkState({ submitted: true, graded: false }), 'submitted');
  assert.equal(homeworkState({ submitted: false, graded: true }), 'graded');
});

test('neither family page reads a `done` field the server never sends', () => {
  for (const [name, src] of [['parent', parent], ['student', student]]) {
    assert.doesNotMatch(src, /\bh\.done\b/, name);
  }
  assert.match(parent, /homeworkState\(h\)/);
});

test('the tutor\'s progress note is the parent\'s to read — not the child\'s', () => {
  assert.match(parent, /CURRENT\.progress\?\.note/);
  assert.doesNotMatch(parent, /\{@html CURRENT\.progressNote\}/);
  assert.doesNotMatch(student, /DATA\.progress\?\.note/);
  assert.match(read('src/routes/app/dashboard/+page.svelte'), /מוצגת להורים בלבד/);
});

test('the dashboard no longer offers a progress percentage nobody sees', () => {
  assert.doesNotMatch(read('src/routes/app/dashboard/+page.svelte'), /<label for="prog-\{s\.code\}">התקדמות \(%\)<\/label>/);
});

test('a lesson time is the Israel clock, winter and summer', () => {
  assert.deepEqual(lessonWhen('2027-04-05T14:00:00.000Z'), { date: '2027-04-05', time: '17:00' }); // IDT
  assert.deepEqual(lessonWhen('2027-01-10T20:30:00.000Z'), { date: '2027-01-10', time: '22:30' }); // IST
  assert.deepEqual(lessonWhen('2027-01-10T22:30:00.000Z'), { date: '2027-01-11', time: '00:30' }); // past midnight
});
