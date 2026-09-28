/**
 * Migration 021 — a booking waiting for its family to confirm it.
 *
 * A booking whose email belongs to an existing account, made without being
 * signed in as that account, is not enrolled: the address on file is asked
 * first (docs/superpowers/specs/2026-09-28-confirm-known-email-booking-design.md).
 * Until then the booking lives here, whole, and holds its hour.
 *
 *   body        the validated booking as /api/book received it (JSON),
 *               attribution included, so confirming books exactly that.
 *   start/end   the hour, copied out so OVERLAP_SOURCE can hold it.
 *   expires_at  a day after the request, or the lesson's start if sooner.
 *               An expired row simply stops holding the hour.
 *   status      'pending' until claimed once, then 'confirmed'.
 */
export const sql = `
CREATE TABLE pending_bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  body        TEXT    NOT NULL,
  start       TEXT    NOT NULL,
  "end"       TEXT    NOT NULL,
  at          TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed'))
);
CREATE INDEX idx_pending_bookings_start ON pending_bookings(start);
`;
