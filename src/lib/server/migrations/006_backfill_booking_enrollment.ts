/**
 * Migration 006 — backfill booking enrollment.
 *
 * The booking endpoint has always had access to enrollment data when it creates
 * a booking (it knows the student, and can query their enrollments), but never
 * populated bookings_v2.enrollment_id. That bug was fixed in commit 9239b6d, so
 * every booking made before that fix has enrollment_id NULL.
 *
 * This migration backfills them using a simple, safe rule:
 *
 * - A student with exactly one enrollment has an unambiguous enrollment: that
 *   enrollment must be the one the lesson was for, even if the booking was made
 *   before the fix. Backfill it.
 *
 * - A student with two or more enrollments is ambiguous: bookings_v2 records
 *   no subject, so we cannot know which enrollment this booking was for.
 *   Guessing and filing a report under the wrong subject would record a false
 *   judgment about a child's work. Leave enrollment_id NULL. The report form
 *   already handles a lesson with no plan by accepting a note-only report.
 *
 * Rows that already have enrollment_id set (pointing to a valid enrollment)
 * are left alone. This migration only touches rows where enrollment_id IS NULL.
 */
export const sql = `
UPDATE bookings_v2
SET enrollment_id = (
  SELECT id FROM enrollments
  WHERE student_id = bookings_v2.student_id
)
WHERE enrollment_id IS NULL
  AND (
    SELECT COUNT(*) FROM enrollments
    WHERE student_id = bookings_v2.student_id
  ) = 1;
`;
