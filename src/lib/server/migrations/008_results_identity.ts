/**
 * Migration 008 — game results get a real identity.
 *
 * The legacy `results` table is keyed on a child's Hebrew display name, so
 * two children sharing a first name share one history and renaming a child
 * orphans theirs (src/lib/server/results.ts:3 documents the defect). The
 * student_id-keyed replacement, results_v2, has existed since migration 001
 * and has never been written to.
 *
 * Rows whose `student` resolves unambiguously MOVE here: inserted into
 * results_v2, then deleted from `results`. A move, not a copy, because
 * readResults() reads the union of both tables — a row left in both would be
 * counted twice on the tutor dashboard. The invariant this establishes:
 *
 *   `results` holds exactly the plays that could not be attributed;
 *   `results_v2` holds exactly the plays that could.
 *
 * The alternative (copy, and have the union skip legacy rows that resolve)
 * is wrong in a case that will occur: a student created AFTER this migration
 * whose name matches an orphaned row makes that row newly resolvable, so the
 * union would skip it while results_v2 still does not contain it, and a real
 * play silently vanishes. Moving has no such state.
 *
 * Ambiguous and unknown rows are left alone, undeleted — the judgement
 * migration 006 made for bookings it could not attribute. Guessing files one
 * child's work under another's name, which cannot be undone by hand.
 *
 * ## Why this creates the legacy table
 *
 * `migrate()` is called from inside db.ts's singleton factory (db.ts:97),
 * and the `db.exec` block that creates the legacy `results` table runs
 * AFTER it (db.ts:108). On a fresh database this migration therefore
 * executes before that table exists, and migrate() rethrows on failure
 * (migrations/index.ts:50), so a bare `SELECT ... FROM results` here would
 * make the app refuse to boot. Restating the frozen legacy definition is the
 * price of not reordering module-level side effects in db.ts. On a fresh
 * database the table is then empty and this migration is a no-op.
 *
 * The INSERT lists its columns rather than SELECT *, so a column added to
 * one table and not the other fails loudly instead of shifting values
 * (005_lesson_reports.ts:13). No table is rebuilt and nothing is dropped, so
 * none of the foreign-key hazards 003, 005 and 007 document apply here.
 *
 * The DELETE repeats the resolution expression rather than sharing the
 * subquery, because SQLite cannot delete from a table through a subquery
 * alias. The two MUST stay identical; tests/unit/results-backfill.test.mjs
 * asserts the tables are disjoint and lossless, which is what catches drift.
 */
export const sql = `
CREATE TABLE IF NOT EXISTS results (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  student  TEXT    NOT NULL,
  at       TEXT    NOT NULL,
  data_id  TEXT,
  template TEXT,
  score    INTEGER,
  total    INTEGER,
  tries    INTEGER,
  stars    INTEGER,
  seconds  INTEGER,
  missed   TEXT
);

INSERT INTO results_v2
  (student_id, at, data_id, template, score, total, tries, stars, seconds, missed)
SELECT sid, at, data_id, template, score, total, tries, stars, seconds, missed
FROM (
  SELECT r.*, COALESCE(
    (SELECT s.id FROM students_v2 s WHERE s.code = r.student),
    (SELECT s.id FROM students_v2 s WHERE s.name = r.student
       AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = r.student) = 1)
  ) AS sid
  FROM results r
)
WHERE sid IS NOT NULL;

DELETE FROM results
WHERE COALESCE(
  (SELECT s.id FROM students_v2 s WHERE s.code = results.student),
  (SELECT s.id FROM students_v2 s WHERE s.name = results.student
     AND (SELECT COUNT(*) FROM students_v2 s2 WHERE s2.name = results.student) = 1)
) IS NOT NULL;
`;
