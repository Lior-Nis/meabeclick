/**
 * Migration 027 — online or in person, and each teacher's Meet room.
 *
 * `bookings_v2.mode` is the family's choice at booking (src/lib/lesson-mode.ts).
 * NULL is every booking made before the choice existed, and stays NULL: a
 * guess would put a family in the wrong place. The CHECK is the last line
 * behind /api/book's refusal of anything but the two.
 *
 * `teachers.meet_url` is the teacher's fixed Google Meet room, set by hand
 * (the repo is public, so it lives here and not in code). NULL means no
 * room yet: the family is told the link comes before the lesson, and the
 * tutor's copy of the booking says it is missing.
 */
export const sql = `
ALTER TABLE bookings_v2 ADD COLUMN mode TEXT CHECK (mode IN ('online', 'in_person'));
ALTER TABLE teachers ADD COLUMN meet_url TEXT;
`;
