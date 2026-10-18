/**
 * Migration 029 — each lesson belongs to a tutor, and each tutor has their
 * own lesson calendar, busy times and teaching hours.
 *
 * `teachers.calendar_id`: the lesson calendar the robot writes this tutor's
 * lessons into. `busy_ics`: their private iCal addresses, one per line —
 * SECRET, each one reads a whole calendar. `teaching_hours`: JSON, NULL =
 * the default window (src/lib/teaching-hours.ts).
 *
 * `bookings_v2.teacher_id` / `pending_bookings.teacher_id`: who holds the
 * lesson, set when it is booked; moving a student later does not move it.
 * Backfilled: a booking takes its enrollment's tutor, else the default
 * tutor; every hold is the default tutor's (every enrollment is, today).
 * Legacy `bookings` rows get no column: they count as the default tutor's
 * wherever bookings are read (entities.ts, OVERLAP_SOURCE).
 * See docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md.
 */
export const sql = `
ALTER TABLE teachers ADD COLUMN calendar_id TEXT;
ALTER TABLE teachers ADD COLUMN busy_ics TEXT;
ALTER TABLE teachers ADD COLUMN teaching_hours TEXT;
ALTER TABLE bookings_v2 ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);
ALTER TABLE pending_bookings ADD COLUMN teacher_id INTEGER REFERENCES teachers(id);

UPDATE bookings_v2 SET teacher_id = COALESCE(
  (SELECT e.teacher_id FROM enrollments e WHERE e.id = bookings_v2.enrollment_id),
  (SELECT t.id FROM teachers t WHERE t.active = 1 ORDER BY t.id LIMIT 1)
);
UPDATE pending_bookings SET teacher_id =
  (SELECT t.id FROM teachers t WHERE t.active = 1 ORDER BY t.id LIMIT 1);

CREATE INDEX idx_bookings_v2_teacher_start ON bookings_v2(teacher_id, start);
`;
