/**
 * Migration 024 — which booking lessons were copied from the library, and
 * from which master. docs/superpowers/specs/2026-09-28-prepared-library-design.md
 *
 * A copy runs no engine, so it is not a generation run: the gate
 * (scripts/vision-metrics.mjs) counts rows of `lessons` and must leave
 * these out. Kept apart from `lessons` rather than as a column on it,
 * because that table is created outside the migrations (db.ts), after
 * they run.
 */
export const sql = `
CREATE TABLE library_uses (
  lesson_slug TEXT PRIMARY KEY,
  master_slug TEXT NOT NULL,
  template_id TEXT NOT NULL,
  skill_key   TEXT NOT NULL,
  at          TEXT NOT NULL
);
`;
