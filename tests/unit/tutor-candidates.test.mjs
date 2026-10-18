// tests/unit/tutor-candidates.test.mjs
//
// The spec's rules 1–3: a student's own tutor; else the family's tutors;
// else everyone who takes bookings — then narrowed to those who do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'candidates-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const C = await import('../../src/lib/server/tutor-candidates.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const ready = (t) => S.updateTutorSettings(t.id, { calendarId: `t${t.id}@group.calendar.google.com`, busyIcs: [`https://feeds.example.test/${t.id}.ics`] });
const [nikol, lior] = E.listTeachers();
ready(nikol); ready(lior);
const ids = (list) => list.map(t => t.id);

let n = 0;
/** An account with these children, each enrolled in maths with a tutor. */
function family(children) {
  n += 1;
  const account = E.createAccount({ name: `משפחה ${n}`, credential: 'x', email: `c${n}@example.com` });
  children.forEach((ch, i) => {
    const s = E.createStudent({ code: `c${n}s${i}`, name: ch.name, accountId: account.id, credential: 'x' });
    E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ח', teacherId: ch.tutorId });
  });
  return account;
}

test('rule 3: a new family may go to anyone who takes bookings, Nikol first', () => {
  const c = C.bookingCandidates({ email: 'new@example.com', name: 'חדש', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.returning, false);
  assert.equal(c.familyTutorId, null);
});

test('rule 1: a student with a tutor in this subject gets only that tutor', () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.deepEqual([c.returning, c.familyTutorId], [true, lior.id]);
});

test("rule 2: a new child joins the family's tutor", () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'אח חדש', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.equal(c.returning, true);
});

test('rule 2 with children at both tutors: both, and the family tutor named is the first', () => {
  const a = family([{ name: 'א', tutorId: lior.id }, { name: 'ב', tutorId: nikol.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'ג', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.familyTutorId, nikol.id);
});

test('a deactivated tutor counts as no tutor, and the next rule applies', () => {
  const gone = E.createTeacher({ name: 'לשעבר' });
  ready(gone);
  const a = family([{ name: 'דנה', tutorId: gone.id }]);
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(gone.id);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), [nikol.id, lior.id]);
  assert.equal(c.returning, false);
});

test('a tutor still missing settings yields no candidates: the family is not moved to someone else', () => {
  const fresh = E.createTeacher({ name: 'חדשה' });
  const a = family([{ name: 'דנה', tutorId: fresh.id }]);
  const c = C.bookingCandidates({ email: a.email, name: 'דנה', subject: 'מתמטיקה' });
  assert.deepEqual(ids(c.tutors), []);
  assert.deepEqual([c.returning, c.familyTutorId], [true, fresh.id]);
  assert.deepEqual(C.availabilityCandidates({ accountId: a.id }), [], 'and that family is offered no hours');
});

test("availability: one tutor on ?tutor=, the family's tutors when signed in, else everyone", () => {
  const a = family([{ name: 'דנה', tutorId: lior.id }]);
  assert.deepEqual(ids(C.availabilityCandidates({})), [nikol.id, lior.id]);
  assert.deepEqual(ids(C.availabilityCandidates({ accountId: a.id })), [lior.id]);
  assert.deepEqual(ids(C.availabilityCandidates({ tutorId: nikol.id, accountId: a.id })), [nikol.id]);
  assert.deepEqual(C.availabilityCandidates({ tutorId: 999 }), []);
  const childless = E.createAccount({ name: 'בלי ילדים', credential: 'x', email: 'none@example.com' });
  assert.deepEqual(ids(C.availabilityCandidates({ accountId: childless.id })), [nikol.id, lior.id]);
});

test("a held booking is its tutor's alone", () => {
  const c = C.heldCandidates(lior.id);
  assert.deepEqual(ids(c.tutors), [lior.id]);
  assert.equal(c.returning, false);
});
