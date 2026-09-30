/**
 * Migration 025 — which lessons were made by an engine other than Codex.
 *
 * A library lesson can be generated on the tutor's machine with Claude Code
 * or opencode and imported (/api/library/import, scripts/library-local.mjs).
 * The gate (scripts/vision-metrics.mjs) measures Codex runs in production,
 * so it leaves these out. No row means Codex, in production: every lesson
 * before 2026-10-01, and every one the server generates itself. Kept apart
 * from `lessons` for the reason 024 gives.
 */
export const sql = `
CREATE TABLE lesson_engines (
  lesson_slug TEXT PRIMARY KEY,
  engine      TEXT NOT NULL,
  at          TEXT NOT NULL
);
`;
