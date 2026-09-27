/**
 * Migration 005 — the end-of-lesson report.
 *
 * A report is one row per BOOKING (a lesson's identity is its booking), and
 * the skills it moves are ordinary plan_events carrying source='report' and
 * the report's id. That is why plan_events has to be rebuilt: SQLite cannot
 * alter a CHECK in place, and source was constrained to 'teacher' alone.
 *
 * The rebuild follows 003_payment_kinds.ts and is safe for the same stated
 * reason: NOTHING references plan_events, so dropping it orphans no child
 * rows. Do NOT copy this procedure onto a table that IS referenced — there
 * the rebuild has to happen outside the transaction (003 explains why).
 * The INSERT lists its columns rather than SELECT *, so a column added to
 * one table and not the other fails loudly instead of shifting values.
 *
 * report_prompts is deliberately NOT part of lesson_reports: the queue is
 * defined by the ABSENCE of a report, so recording "she has been emailed
 * about this lesson" must not create one.
 */
export const sql = `
CREATE TABLE lesson_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings_v2(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE report_prompts (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings_v2(id),
  sent_at    TEXT    NOT NULL
);

CREATE TABLE plan_events_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal')),
  status     TEXT    CHECK (status IN ('not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson', 'homework', 'game', 'test', 'other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher', 'report')),
  report_id  INTEGER REFERENCES lesson_reports(id),
  at         TEXT    NOT NULL
);

INSERT INTO plan_events_new (id, plan_id, node_id, type, status, visibility, note, evidence, source, at)
SELECT id, plan_id, node_id, type, status, visibility, note, evidence, source, at FROM plan_events;

DROP TABLE plan_events;
ALTER TABLE plan_events_new RENAME TO plan_events;

CREATE INDEX plan_events_node ON plan_events (node_id, id);
CREATE INDEX lesson_reports_booking ON lesson_reports (booking_id);
`;
