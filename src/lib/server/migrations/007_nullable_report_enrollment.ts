/**
 * Migration 007 — an enrollment-less booking can still get a note-only report.
 *
 * Migration 006 deliberately leaves bookings_v2.enrollment_id NULL for a
 * student with more than one enrollment (which one a pre-fix booking was
 * for cannot be known). Those bookings still surface in the report queue
 * and the prompt email, and the controller ruling on this is: let the
 * report land rather than hide the lesson from the queue — recording that
 * a lesson happened is worth having even with no plan behind it. That
 * means lesson_reports.enrollment_id, NOT NULL since migration 005, has to
 * become nullable: fileReport writes NULL there for exactly this case.
 *
 * SQLite cannot drop a NOT NULL constraint in place, so the table is
 * rebuilt, following 003_payment_kinds.ts and 005_lesson_reports.ts.
 *
 * ## Why this is safe despite plan_events.report_id REFERENCES lesson_reports(id)
 *
 * 003 and 005's rebuilds were safe because nothing referenced the table
 * being rebuilt at all. That is not quite true here — plan_events.report_id
 * points at this table — but the FK is only a problem for a rebuild if a
 * live row somewhere actually holds a non-NULL value pointing at it: SQLite
 * refuses to DROP a table that a CHILD ROW currently references (proven
 * empirically — a DROP TABLE with foreign_keys=ON fails once any row's FK
 * column is non-NULL, and succeeds when every such column is NULL or the
 * child table is empty). lesson_reports was created by migration 005 in
 * this SAME deploy (no prior release ever shipped with reports enabled), so
 * by the time 007 runs no lesson_reports row — and therefore no
 * plan_events.report_id — can exist yet. That is what "referenced by
 * nothing" means here: not that no column names this table, but that no
 * row anywhere points at one of its rows at the only time this migration
 * ever executes. **Do not copy this file as a template for rebuilding a
 * table that already has live rows referencing it** — 003's warning holds:
 * that rebuild belongs outside the transaction, with the FK checked instead
 * of reasoned about.
 *
 * The INSERT lists its columns rather than SELECT *, so a column added to
 * one table and not the other fails loudly instead of shifting values.
 *
 * A new table, lesson_report_notes, arrives in the same migration: the
 * note's history (spec §4 — "the note's history lives in plan_events, not
 * in versions of this row" was the plan for skill judgements; a correction
 * to the free-text note itself needs its own log, since it has no plan
 * node to hang a plan_events row on and a note-only report has no status
 * event to carry it). lesson_reports.note keeps the latest note for
 * convenience; lesson_report_notes is the append-only history, one row per
 * filing.
 */
export const sql = `
CREATE TABLE lesson_reports_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings_v2(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER REFERENCES enrollments(id),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

INSERT INTO lesson_reports_new
  (id, booking_id, student_id, enrollment_id, note, created_at, updated_at)
SELECT
  id, booking_id, student_id, enrollment_id, note, created_at, updated_at
FROM lesson_reports;

DROP TABLE lesson_reports;
ALTER TABLE lesson_reports_new RENAME TO lesson_reports;

CREATE INDEX lesson_reports_booking ON lesson_reports (booking_id);

CREATE TABLE lesson_report_notes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES lesson_reports(id),
  note      TEXT,
  at        TEXT    NOT NULL
);

CREATE INDEX lesson_report_notes_report ON lesson_report_notes (report_id, id);
`;
