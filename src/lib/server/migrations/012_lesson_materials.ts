/**
 * Migration 012 — teaching material as versions, with drafts and publishing
 * kept apart.
 *
 * Todoist id:6hRhqV8XX5wr4jqq. The tutor has to be able to correct what the
 * agent produced without regenerating the lesson, and two things have to be
 * true while she does:
 *
 *   1. A correction she has not published is not shown to the student.
 *   2. Regenerating does not destroy a correction she made.
 *
 * Neither is possible against the current storage, which is one
 * `slides.html` per lesson on disk and a `lesson.json` beside it: writing
 * either is both the edit AND the publish, and the previous content is
 * simply gone.
 *
 * ## The shape
 *
 * One row per version, never updated in place. Same principle as
 * plan_events and for the same reason — history you can read is history you
 * can restore from, and an edit that overwrites its predecessor leaves
 * nothing to explain what changed.
 *
 * `published_at` is the whole draft/publish distinction: NULL means the
 * tutor is working on it, a timestamp means the student may see it. The
 * student's route asks for the newest row with a timestamp; the editor asks
 * for the newest row full stop.
 *
 * `origin` records who wrote it, and nothing is overwritten, so a tutor's
 * correction is still there to compare against or return to. Three writers:
 * generation appends 'generated' (recordGenerated() in materials.ts, from
 * publish() in lesson/queue.ts — published only if the tutor never edited
 * that lesson's material), the editor route appends 'edited', and
 * restoreVersion() appends 'restored'. Measure autogeneration from runs in
 * the legacy `lessons` table (scripts/vision-metrics.mjs), using this table
 * only to see whether the tutor stepped in: a lesson generated before
 * recordGenerated() existed has no 'generated' row here at all.
 *
 * `teacher_only` holds solutions and internal notes as a separate column
 * rather than a field inside `content`, so "never send this to a student"
 * is enforced by which column a query selects instead of by remembering to
 * strip a key. A route that forgets it returns less, not more.
 *
 * ## Why the slug, and not a lesson id
 *
 * Because there are two lessons tables and the newer one is empty.
 * Generation writes to the legacy `lessons` (through db.ts), /api/lessons
 * reads it, and `lessons_v2` — created by migration 001 — has never been
 * written to: verified on production 2026-09-21, `lessons` 4 rows,
 * `lessons_v2` 0.
 *
 * A foreign key to either one would be a bet on which wins, and the bet
 * would be invisible until something 404'd. `slug` is what every URL
 * already carries, it is UNIQUE in both tables, and it survives whichever
 * way that is eventually resolved. The cost is no referential integrity
 * here; the alternative was integrity with the wrong table.
 */
export const sql = `
CREATE TABLE lesson_materials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_slug  TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('plan', 'slides')),
  version      INTEGER NOT NULL,
  content      TEXT    NOT NULL,
  /* Solutions and notes for the tutor. A separate column so that not
     sending it to a student is a property of the SELECT, not of a caller
     remembering to delete a key. */
  teacher_only TEXT,
  origin       TEXT    NOT NULL CHECK (origin IN ('generated', 'edited', 'restored')),
  /* NULL while it is a draft. Set once, when the tutor publishes it. */
  published_at TEXT,
  created_at   TEXT    NOT NULL,
  UNIQUE (lesson_slug, kind, version)
);

/* The two questions ever asked of this table: "newest version of this kind
   for this lesson" and "newest PUBLISHED version of this kind". */
CREATE INDEX lesson_materials_latest ON lesson_materials (lesson_slug, kind, version DESC);
CREATE INDEX lesson_materials_published ON lesson_materials (lesson_slug, kind, published_at, version DESC);
`;
