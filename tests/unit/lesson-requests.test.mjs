// A parent's, a student's, and a tutor's notes toward a lesson are three
// different kinds of claim (see migration 009_lesson_requests.ts) and must
// never be recorded as the same thing. This exercises the table the
// migration creates and the store module built on top of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Set before importing db.ts (transitively, via entities.ts/requests.ts):
// db.ts reads DB_PATH directly, once, at module load (falling back to
// DATA_DIR only when DB_PATH is unset) — same pattern as
// tests/unit/results-identity.test.mjs.
process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'lesson-requests-')), 'results.db');

const { handle } = await import('../../src/lib/server/db.ts');
const E = await import('../../src/lib/server/entities.ts');
const { addLessonRequest, requestsForStudent } = await import('../../src/lib/server/requests.ts');

const acct = E.createAccount({ name: 'משפחת כהן', credential: 'x' });
const student = E.createStudent({ code: 'req-student', name: 'דנה כהן', accountId: acct.id, credential: 'p' });
const booking = E.reserveBooking({
  studentId: student.id,
  start: '2027-04-01T10:00:00.000Z', end: '2027-04-01T10:45:00.000Z',
  durationMin: 45,
});

test('the migration creates lesson_requests', () => {
  const row = handle().prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'lesson_requests'`
  ).get();
  assert.ok(row, 'migration 009 must create the lesson_requests table');
});

test('addLessonRequest stores the text with its source, linked to booking and student', () => {
  addLessonRequest({
    bookingId: booking, studentId: student.id, source: 'parent',
    text: 'לתרגל משוואות ריבועיות לקראת המבחן',
  });

  const [row] = requestsForStudent(student.id);
  assert.equal(row.text, 'לתרגל משוואות ריבועיות לקראת המבחן');
  assert.equal(row.source, 'parent');
  assert.equal(row.booking_id, booking);
  assert.equal(row.student_id, student.id);
});

test('requestsForStudent returns every request for that student, newest first', () => {
  const other = E.createStudent({ code: 'req-student-2', name: 'יונתן כהן', accountId: acct.id, credential: 'p' });
  addLessonRequest({ studentId: other.id, source: 'student', text: 'לא הבנתי את שיעורי הבית' });
  addLessonRequest({ studentId: other.id, source: 'teacher', text: 'צריך לחזור על שברים' });

  const rows = requestsForStudent(other.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'צריך לחזור על שברים', 'newest first');
  assert.equal(rows[0].source, 'teacher');
  assert.equal(rows[1].source, 'student');

  // Never leaks into another student's history.
  assert.equal(requestsForStudent(student.id).some(r => r.text === 'לא הבנתי את שיעורי הבית'), false);
});

test('an unknown source is rejected by the CHECK constraint, not silently accepted', () => {
  assert.throws(() => addLessonRequest({
    studentId: student.id, source: 'other', text: 'משהו',
  }), /CHECK/i, 'must fail on the source CHECK, not some unrelated error');
});
