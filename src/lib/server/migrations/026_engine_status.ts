/**
 * Migration 026 — whether an engine is down, and until when.
 *
 * One row per engine while it is unavailable (out of usage, signed out,
 * missing), written by spawnAgent from the engine's own failure and deleted
 * by its next successful run. The dashboard reads it so the tutor learns
 * the engine is down from a notice, not from a booking that failed.
 * `until` is only ever a date parsed from the engine's message
 * (engine-health.ts parseRetryAt) — never the message itself.
 */
export const sql = `
CREATE TABLE engine_status (
  engine TEXT PRIMARY KEY,
  kind   TEXT NOT NULL,
  until  TEXT,
  at     TEXT NOT NULL
);
`;
