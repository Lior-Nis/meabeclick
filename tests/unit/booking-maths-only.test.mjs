// tests/unit/booking-maths-only.test.mjs
//
// Every lesson is maths (Todoist 6hfrX4XvwJRjccRq): the booking form no
// longer asks for a subject, says it is a maths lesson, and sends maths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SUBJ = await import('../../src/lib/subjects.ts');
const page = await readFile(join(process.cwd(), 'src/routes/booking/+page.svelte'), 'utf8');

test('one subject, declared once', () => {
  assert.equal(SUBJ.SUBJECT, 'מתמטיקה');
  assert.equal(SUBJ.SUBJECTS, undefined, 'no list to choose from');
});

test('the form does not ask for a subject, and says the lesson is maths', () => {
  assert.doesNotMatch(page, /id="inp-subject"/);
  assert.doesNotMatch(page, /בחרו מקצוע/);
  assert.doesNotMatch(page, /next\.subject/, 'nothing to validate');
  assert.match(page, /שיעור פרטי במתמטיקה/);
});

test('it always sends maths, whoever is picked', () => {
  assert.match(page, /subject: SUBJECT,/);
  assert.doesNotMatch(page, /subject = kid\.subject/);
  assert.doesNotMatch(page, /subject = '';/);
});
