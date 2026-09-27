import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'bk-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const account = E.createAccount({ name: 'משפחה', credential: 'x' });
const student = E.createStudent({ code: 'bk', name: 'תלמיד', accountId: account.id, credential: 'x' });

const SLOT = { start: '2027-06-01T13:00:00.000Z', end: '2027-06-01T13:45:00.000Z' };

test('a booking is reserved against the student, not a name', () => {
  const id = E.reserveBooking({ studentId: student.id, ...SLOT, durationMin: 45 });
  assert.ok(id, 'the first booking of a free hour must succeed');

  const row = handle().prepare(`SELECT * FROM bookings_v2 WHERE id = ?`).get(id);
  assert.equal(row.student_id, student.id);
  assert.equal(row.status, 'confirmed');
});

test('the same hour cannot be reserved twice', () => {
  assert.equal(
    E.reserveBooking({ studentId: student.id, ...SLOT, durationMin: 45 }),
    null,
    'an overlapping hour must be refused',
  );
});

test('a legacy bookings row still blocks its hour', () => {
  // Legacy rows are deliberately not migrated (they carry a name, not a
  // student), so the overlap check has to see both tables or an old lesson
  // silently becomes double-booked.
  handle().exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, subject TEXT,
      level TEXT, topic TEXT, phone TEXT, start TEXT NOT NULL, end TEXT NOT NULL,
      duration INTEGER, at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed'
    );
    INSERT INTO bookings (name, start, end, at, status)
    VALUES ('ישן', '2027-07-01T13:00:00.000Z', '2027-07-01T14:30:00.000Z', '2026-01-01', 'confirmed');
  `);

  assert.equal(
    E.reserveBooking({
      studentId: student.id,
      start: '2027-07-01T13:30:00.000Z',
      end: '2027-07-01T14:15:00.000Z',
      durationMin: 45,
    }),
    null,
    'a legacy booking must still hold its hour',
  );
});

test('readBookings returns rows from both tables', () => {
  const rows = E.readBookings('2027-01-01T00:00:00.000Z', '2028-01-01T00:00:00.000Z');
  assert.ok(rows.some(r => r.start === SLOT.start), 'the v2 booking is missing');
  assert.ok(rows.some(r => r.start === '2027-07-01T13:00:00.000Z'), 'the legacy booking is missing');
});

test('a slot abutting an existing one on either side is not blocked', () => {
  // Availability generates back-to-back 30-min slots, so `finish > ?` (not
  // `>=`) at both ends of the overlap check is what keeps adjacent slots
  // bookable. If that predicate ever became inclusive, capacity would
  // silently halve without any test above catching it.
  const middle = { start: '2027-09-01T13:00:00.000Z', end: '2027-09-01T13:45:00.000Z' };
  assert.ok(
    E.reserveBooking({ studentId: student.id, ...middle, durationMin: 45 }),
    'setup: the middle slot must reserve cleanly',
  );

  assert.ok(
    E.reserveBooking({
      studentId: student.id,
      start: '2027-09-01T12:15:00.000Z', end: middle.start, durationMin: 45,
    }),
    'a slot ending exactly when the next one starts must be bookable',
  );

  assert.ok(
    E.reserveBooking({
      studentId: student.id,
      start: middle.end, end: '2027-09-01T14:30:00.000Z', durationMin: 45,
    }),
    'a slot starting exactly when the previous one ends must be bookable',
  );
});

test('cancelling frees the hour again', () => {
  const id = E.reserveBooking({
    studentId: student.id,
    start: '2027-08-01T13:00:00.000Z', end: '2027-08-01T13:45:00.000Z', durationMin: 45,
  });
  assert.ok(id);
  E.cancelBooking(id);

  assert.ok(
    E.reserveBooking({
      studentId: student.id,
      start: '2027-08-01T13:00:00.000Z', end: '2027-08-01T13:45:00.000Z', durationMin: 45,
    }),
    'the hour must be bookable again after a cancellation',
  );
});

test('slotTaken sees a legacy booking without needing a student to insert', () => {
  // The route calls this before reserveBooking, so that a request whose
  // enrolment failed — and which therefore has no student to write a row
  // for — is still refused an hour someone else holds. A legacy row is the
  // strictest case: it lives in the other table and names no student at all.
  handle().exec(`
    INSERT INTO bookings (name, start, end, at, status)
    VALUES ('ישן', '2027-10-01T13:00:00.000Z', '2027-10-01T14:30:00.000Z', '2026-01-01', 'confirmed');
  `);

  assert.equal(
    E.slotTaken('2027-10-01T13:30:00.000Z', '2027-10-01T14:15:00.000Z'),
    true,
    'an hour held by a legacy booking must read as taken',
  );

  assert.equal(
    E.slotTaken('2027-10-02T13:00:00.000Z', '2027-10-02T13:45:00.000Z'),
    false,
    'a free hour must read as free',
  );
});
