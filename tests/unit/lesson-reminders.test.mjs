// tests/unit/lesson-reminders.test.mjs
//
// Reminding the family, once.
//
// Todoist id:6hM24r5hGPvwJQmq: the family gets a booking confirmation and
// then nothing. The only reminder in the system goes to the TUTOR — a
// WhatsApp nudge to update her calendar — so the people who actually have
// to show up are the ones nobody reminds.
//
// The selection rule is pure and tested here rather than inside a route,
// because "which lessons are due a reminder right now" is the decision
// that can quietly go wrong at a timezone boundary, and a route is the
// worst place to read it from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* DB_PATH must be set BEFORE anything that transitively imports db.ts,
   which resolves it once at module load. A static import of reminders.ts
   is hoisted above this line, so it would bind db.ts to the default path
   and these tests would write to a real database — which is exactly what
   happened, and it surfaced as a UNIQUE collision on accounts.email
   against rows an earlier run had left behind. Hence the dynamic imports
   below, the same pattern the other db-backed tests here use. */
process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'remind-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/reminders.ts');
const { handle } = await import('../../src/lib/server/db.ts');
const { dueForReminder } = R;

const NOW = '2026-09-24T09:00:00.000Z';
const at = (h) => new Date(Date.parse(NOW) + h * 3600e3).toISOString();
const booking = (over = {}) => ({ id: 1, start: at(20), status: 'confirmed', ...over });

// ── The window ──────────────────────────────────────────────────────────

test('a lesson tomorrow is due a reminder', () => {
  assert.equal(dueForReminder([booking({ start: at(20) })], NOW).length, 1);
});

test('a lesson further out than a day is not due yet', () => {
  // Reminding on Monday about Friday is not a reminder, it is noise, and
  // noise is how a family learns to ignore the one that matters.
  assert.equal(dueForReminder([booking({ start: at(50) })], NOW).length, 0);
});

test('a lesson within two hours is not reminded', () => {
  // They know. A message arriving as they are leaving the house is not
  // help, and it risks landing after the lesson has started.
  assert.equal(dueForReminder([booking({ start: at(1) })], NOW).length, 0);
});

test('a lesson already past is never reminded', () => {
  assert.equal(dueForReminder([booking({ start: at(-3) })], NOW).length, 0);
});

// ── What cancels it ─────────────────────────────────────────────────────

test('a cancelled lesson is not reminded', () => {
  // The task is explicit: «לבטל או לעדכן תזכורת כאשר השיעור משתנה או
  // מתבטל». Reminding someone about a lesson that is not happening is
  // worse than silence.
  assert.equal(dueForReminder([booking({ status: 'cancelled' })], NOW).length, 0);
});

// ── Idempotency, enforced by the database ───────────────────────────────

let seq = 0;
function seedBooking(startIso) {
  /* A unique email per account: accounts.email is UNIQUE, which is the
     schema doing its job — findAccountByEmail is how a returning family is
     matched, so two accounts sharing an address would be a real bug. */
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x', email: `fam${seq}@example.com` });
  const student = E.createStudent({ code: `s${seq}`, name: 'נועה', accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה ח', teacherId: null });
  const enr = E.enrollmentsForStudent(student.id)[0];
  const r = handle().prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
     VALUES (?, ?, ?, ?, 45, ?, 'confirmed')`
  ).run(student.id, enr.id, startIso, startIso, startIso);
  return Number(r.lastInsertRowid);
}

test('claiming a reminder twice only succeeds once', () => {
  // This is the whole idempotency guarantee, and it is a UNIQUE constraint
  // rather than a check the caller has to remember — a retry inserts, hits
  // the constraint, and sends nothing.
  const id = seedBooking(at(20));
  assert.equal(R.claimReminder(id, 'before-lesson'), true);
  assert.equal(R.claimReminder(id, 'before-lesson'), false, 'a retry must not send again');
});

test('a failed send is recorded as failed, not as never attempted', () => {
  // «לשמור סטטוס ניסיון מסירה». A boolean on the booking could not tell a
  // failure apart from a reminder nobody tried to send, and the tutor
  // needs to know which.
  const id = seedBooking(at(20));
  R.claimReminder(id, 'before-lesson');
  R.finishReminder(id, 'before-lesson', 'failed', 'SMTP refused');
  const row = R.reminderFor(id, 'before-lesson');
  assert.equal(row.status, 'failed');
  assert.equal(row.detail, 'SMTP refused');
});

test('a successful send is recorded as sent', () => {
  const id = seedBooking(at(20));
  R.claimReminder(id, 'before-lesson');
  R.finishReminder(id, 'before-lesson', 'sent', null);
  assert.equal(R.reminderFor(id, 'before-lesson').status, 'sent');
});

test('a reminder already claimed is excluded from the due list', () => {
  const id = seedBooking(at(20));
  R.claimReminder(id, 'before-lesson');
  const due = R.pendingReminders(NOW);
  assert.ok(!due.some(b => b.id === id), 'a claimed reminder must not be picked up again');
});
