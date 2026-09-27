/**
 * Migration 003 — a third lesson kind, and a way to cancel a debt.
 *
 * Two constraints in 001 are wrong for the product as sold:
 *
 *   kind   IN ('single', 'double')   — three plans exist (45/90/135), so a
 *                                      משולש lesson could not be recorded.
 *   status IN ('owed', 'paid')       — a booking now creates its own debt
 *                                      (see the 2026-09-05 payments spec),
 *                                      so a cancelled lesson needs a way to
 *                                      stop being owed without vanishing.
 *
 * SQLite cannot alter a CHECK constraint in place, so the table is rebuilt.
 *
 * ## Why this ignores SQLite's documented rebuild procedure
 *
 * That procedure begins by turning `foreign_keys` off, and PRAGMA
 * foreign_keys is a no-op inside a transaction — which is exactly where the
 * migration runner puts this. It is safe here for one specific reason:
 * NOTHING references `payments`, so dropping it orphans no child rows. Do
 * not copy this file as a template for rebuilding a table that IS
 * referenced; there the rebuild has to happen outside the transaction.
 *
 * The INSERT lists its columns rather than using SELECT *, so a column
 * added to one table and not the other fails loudly instead of silently
 * shifting every value one place to the left.
 */
export const sql = `
CREATE TABLE payments_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  booking_id    INTEGER REFERENCES bookings_v2(id),
  date          TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('single', 'double', 'triple')),
  amount_agorot INTEGER NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('owed', 'paid', 'void')),
  note          TEXT
);

INSERT INTO payments_new
  (id, account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
SELECT
  id, account_id, student_id, booking_id, date, kind, amount_agorot, status, note
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_new RENAME TO payments;

CREATE INDEX idx_payments_account ON payments(account_id);
CREATE INDEX idx_payments_student ON payments(student_id, date DESC);
`;
