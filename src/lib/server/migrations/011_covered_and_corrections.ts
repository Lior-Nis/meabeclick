/**
 * Migration 011 — coverage as its own event, and corrections that say what
 * they replace.
 *
 * From docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md,
 * steps 1 and 2. Both change `plan_events`, so they share one migration
 * rather than rebuilding the same table twice.
 *
 * ## `covered`
 *
 * "This was taught" and "she can do it" are different facts, and the status
 * scale can only express the second. Recording coverage as a status would
 * mean a lesson that went badly still had to be written down as progress —
 * exactly the conflation the task exists to remove. So coverage becomes a
 * fifth event type with no status of its own.
 *
 * It costs nothing at read time: currentStatus() already ignores every
 * event whose type is not 'status', so a `covered` row cannot move a skill.
 *
 * ## `corrects`
 *
 * A correction is not a new opinion. Without saying what it replaces, the
 * log reads as a tutor who changed her mind three times, and "explainable
 * and restorable" is not true of it.
 *
 * `corrects` points at the event being replaced. The log stays append-only
 * — nothing is edited or deleted — so the original is still there to show
 * struck through beneath its replacement, with both dates.
 *
 * ## Why a rebuild
 *
 * SQLite cannot alter a CHECK constraint, and `type` has one. 010 could use
 * ALTER TABLE ADD COLUMN precisely because no constraint changed there; here
 * one does, so the table is rebuilt the way 003_payment_kinds did it. The
 * `corrects` column comes along in the same rebuild rather than as a second
 * migration doing the same expensive thing.
 *
 * Every existing row copies across unchanged, with `corrects` NULL: no
 * event recorded so far was a correction of another.
 */
export const sql = `
CREATE TABLE plan_events_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal', 'covered')),
  status     TEXT    CHECK (status IN ('not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson', 'homework', 'game', 'test', 'other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher', 'report')),
  report_id  INTEGER REFERENCES lesson_reports(id),
  /* The event this one replaces. NULL for an original observation.
     Append-only: the corrected row stays exactly as it was written. */
  corrects   INTEGER REFERENCES plan_events(id),
  at         TEXT    NOT NULL
);

INSERT INTO plan_events_new
  (id, plan_id, node_id, type, status, visibility, note, evidence, source, report_id, at)
SELECT id, plan_id, node_id, type, status, visibility, note, evidence, source, report_id, at
FROM plan_events;

DROP TABLE plan_events;
ALTER TABLE plan_events_new RENAME TO plan_events;

CREATE INDEX plan_events_node ON plan_events (node_id, id);
/* Reading a skill's history means asking "was this superseded?" for each
   event, which is a lookup by the corrected id, not by the correcting one. */
CREATE INDEX plan_events_corrects ON plan_events (corrects);
`;
