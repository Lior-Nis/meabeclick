/**
 * Migration 017 — one row per reminder actually attempted.
 *
 * 016 is taken by a concurrent session (marketing_events).
 *
 * Todoist id:6hM24r5hGPvwJQmq: a family gets a booking confirmation and
 * then nothing. The only reminder that exists today goes to the TUTOR, via
 * /api/remind, telling her to update her calendar — so the people who need
 * to show up are the ones nobody reminds.
 *
 * ## Why a table rather than a flag on the booking
 *
 * The task asks for two things a boolean cannot express: «לשמור סטטוס
 * ניסיון מסירה» — keep the delivery ATTEMPT status — and «להבטיח
 * idempotency כדי ש־retry לא ישלח פעמיים». A failed attempt and a
 * never-attempted reminder must be told apart, or a retry cannot know
 * whether it is retrying or duplicating.
 *
 * UNIQUE (booking_id, kind) is the idempotency guarantee itself, enforced
 * by the database rather than by a query the caller has to remember to run.
 * A retry inserts, hits the constraint, and sends nothing. `kind` exists so
 * a second reminder at a different offset can be added later without
 * needing a second table.
 *
 * `status` records what happened, not whether we tried: 'sent' or 'failed'.
 * A row is written BEFORE the send so a crash mid-send cannot produce a
 * second attempt, and updated after — the honest cost is that a crash
 * leaves a 'pending' row that will not retry, which is the right side to
 * fail on. Reminding someone twice about the same lesson is worse than not
 * reminding them, because the second message makes the first one untrusted.
 */
export const sql = `
CREATE TABLE lesson_reminders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings_v2(id),
  kind       TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  detail     TEXT,
  at         TEXT    NOT NULL,
  UNIQUE (booking_id, kind)
);

CREATE INDEX lesson_reminders_booking ON lesson_reminders (booking_id);
`;
