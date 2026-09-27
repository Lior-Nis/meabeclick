/**
 * Migration 009 — the lesson request gets its own table, with a source.
 *
 * The booking form's optional note used to do two jobs it had no business
 * doing. It travelled as `body.topic`, and src/lib/server/lesson/queue.ts
 * fed the same string into the lesson generator twice: once as `topic` (the
 * chosen subject of the lesson, guessed from `booking.subject` when the
 * field was empty) and once as `notUnderstood` ("what wasn't understood in
 * the previous lesson"). For a brand-new student there is no previous
 * lesson, so a parent's forward-looking note was read backward as a claim
 * about the student's history — and it was never persisted anywhere: the
 * text survived only in the tutor's email and a transient generation job.
 *
 * `lesson_requests` fixes both. `source` is CHECKed to distinguish a
 * parent's booking-time note from a student's own note and a tutor's
 * observation — three different kinds of claim about a lesson that must
 * never be merged into one. Only 'parent' is written today, from the
 * booking route (src/routes/api/book/+server.ts); 'student' and 'teacher'
 * are here for callers this task does not add, so adding one later is a
 * caller change, not a schema change.
 *
 * `booking_id` is nullable — REFERENCES bookings_v2(id) rather than NOT
 * NULL — because a student's own request or a tutor's observation need not
 * be tied to one specific booking, and forcing one would be exactly the
 * kind of guess this table exists to stop making. `student_id` is NOT
 * NULL: every request is about a specific, known student.
 *
 * This table is deliberately outside plan_events/plans (migration 004) and
 * every other progress/mastery surface: a request is what someone asked
 * for, not evidence of what a student has mastered, and the two must never
 * be readable as the same kind of fact.
 */
export const sql = `
CREATE TABLE lesson_requests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings_v2(id),
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  source     TEXT    NOT NULL CHECK (source IN ('parent', 'student', 'teacher')),
  text       TEXT    NOT NULL,
  at         TEXT    NOT NULL
);

CREATE INDEX lesson_requests_student ON lesson_requests (student_id, id);
`;
