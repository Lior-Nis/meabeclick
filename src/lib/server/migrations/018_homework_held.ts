/**
 * Migration 018 — homework held until its lesson has happened.
 *
 * Homework used to be visible the moment it was generated, which is at
 * BOOKING time: a lesson booked a week ahead showed a week of homework for
 * something not yet taught. Now booking-time homework is written held, and
 * the lesson report replaces it with homework from what was actually taught
 * (docs/superpowers/specs/2026-09-25-homework-from-what-was-taught-design.md).
 *
 *   booking_id — which lesson's homework this is. Plain column, no FK, like
 *                lesson_id: a join on lessons.lesson_at = bookings.start is
 *                not safe (two students can share a start time).
 *   held_until — hidden from families until then. NULL = visible, which is
 *                what every existing row gets and exactly what they do now.
 *                Visibility is a read-time comparison, so the 24h fallback
 *                needs no job to run.
 */
export const sql = `
ALTER TABLE homework ADD COLUMN booking_id INTEGER;
ALTER TABLE homework ADD COLUMN held_until TEXT;
CREATE INDEX homework_booking ON homework (booking_id);
`;
