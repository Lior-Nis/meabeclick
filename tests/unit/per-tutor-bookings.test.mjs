// tests/unit/per-tutor-bookings.test.mjs
//
// A booking is its tutor's: another tutor's lesson leaves the hour free
// (migration 029, docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'per-tutor-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/pending-bookings.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const [NIKOL, LIOR] = E.listTeachers().map(t => t.id);
const account = E.createAccount({ name: 'משפחה', credential: 'x', email: 'fam@example.com' });
const student = E.createStudent({ code: 'pt1', name: 'דנה', accountId: account.id, credential: 'x' });
let day = 0;
/** A fresh hour per test, so no test meets another's bookings. */
const hour = () => {
  day += 1;
  const d = String(day).padStart(2, '0');
  return { start: `2030-01-${d}T08:00:00.000Z`, end: `2030-01-${d}T09:30:00.000Z` };
};
const tutorOfBooking = id => handle().prepare(`SELECT teacher_id FROM bookings_v2 WHERE id = ?`).get(id).teacher_id;

test("another tutor's lesson does not take this tutor's hour", () => {
  const h = hour();
  assert.ok(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: NIKOL }));
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), true);
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), false);
  assert.ok(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: LIOR }), 'Lior can teach at the same hour');
  assert.equal(E.reserveBooking({ studentId: student.id, ...h, durationMin: 90, teacherId: LIOR }), null, 'but not twice');
  assert.equal(E.slotTaken(h.start, h.end), true, 'slotTaken still asks about anyone');
});

test('a booking records its tutor; with none given, the default tutor', () => {
  assert.equal(tutorOfBooking(E.reserveBooking({ studentId: student.id, ...hour(), durationMin: 90, teacherId: LIOR })), LIOR);
  assert.equal(tutorOfBooking(E.reserveBooking({ studentId: student.id, ...hour(), durationMin: 90 })), NIKOL);
});

test("legacy bookings count as the default tutor's", () => {
  const h = hour();
  handle().prepare(`INSERT INTO bookings (name, start, "end", at, status) VALUES ('ישן', ?, ?, '2026-01-01', 'confirmed')`).run(h.start, h.end);
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), true);
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), false);
  assert.equal(E.readBookingsFor(NIKOL, h.start, h.end).length, 1);
  assert.deepEqual(E.readBookingsFor(LIOR, h.start, h.end), []);
});

test("a hold is its tutor's", () => {
  const h = hour();
  const id = P.holdBooking({ accountId: account.id, teacherId: LIOR, body: { ...h }, now: new Date('2029-12-31T00:00:00Z') });
  assert.equal(E.slotTakenFor(LIOR, h.start, h.end), true);
  assert.equal(E.slotTakenFor(NIKOL, h.start, h.end), false);
  assert.equal(P.pendingById(id).teacherId, LIOR);
});

test("booking again keeps the student's tutor", () => {
  const s = E.createStudent({ code: 'pt2', name: 'נועה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ח', teacherId: LIOR });
  const again = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'ט', teacherId: NIKOL });
  assert.equal(again.teacher_id, LIOR);
  assert.equal(again.level, 'ט', 'the level still follows the booking');
});

test("an enrollment with no tutor, or a deactivated one, takes the booking's", () => {
  const s = E.createStudent({ code: 'pt3', name: 'יואב', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: null });
  assert.equal(E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: LIOR }).teacher_id, LIOR);
  const gone = E.createTeacher({ name: 'לשעבר' });
  E.setEnrollmentTeacher(enr.id, gone.id);
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(gone.id);
  assert.equal(E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: NIKOL }).teacher_id, NIKOL);
});

test('moving a student changes their enrollment, never a lesson already booked', () => {
  const s = E.createStudent({ code: 'pt4', name: 'אורי', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: NIKOL });
  const booked = E.reserveBooking({ studentId: s.id, enrollmentId: enr.id, ...hour(), durationMin: 90, teacherId: NIKOL });
  assert.equal(E.setEnrollmentTeacher(enr.id, LIOR).teacher_id, LIOR);
  assert.equal(tutorOfBooking(booked), NIKOL);
  assert.equal(E.setEnrollmentTeacher(999999, LIOR), null, 'no such enrollment');
});

test('the next lesson says who teaches it', () => {
  const s = E.createStudent({ code: 'pt5', name: 'מיה', accountId: account.id, credential: 'x' });
  E.reserveBooking({ studentId: s.id, start: '2031-05-01T08:00:00.000Z', end: '2031-05-01T09:00:00.000Z', durationMin: 45, teacherId: LIOR });
  assert.equal(E.nextBookingForStudent(s.id, '2031-01-01T00:00:00.000Z').teacherId, LIOR);
});
