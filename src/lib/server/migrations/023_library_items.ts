/**
 * Migration 023 — the prepared library: which master lesson belongs to
 * which skill of a plan template.
 * docs/superpowers/specs/2026-09-28-prepared-library-design.md
 *
 * A master is an ordinary lesson (lessons row, lesson_materials versions,
 * slides and game files), so the editor, preview and history work on it
 * unchanged. This table only says which one is the current master for a
 * (template, skill), and where its preparation stands:
 *
 *   queued     waiting its turn — skills are prepared one at a time
 *   preparing  the engine is running
 *   ready      its published plan is what bookings on this skill get
 *   held       generated but failed validation; not used
 *   failed     the engine failed; `problem` says how, in fixed words
 *
 * `slug` is NULL until a preparation has started. Preparing again points it
 * at a new master; the old one stays in `lessons`, as history.
 */
export const sql = `
CREATE TABLE library_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT    NOT NULL,
  skill_key   TEXT    NOT NULL,
  slug        TEXT,
  status      TEXT    NOT NULL CHECK (status IN ('queued', 'preparing', 'ready', 'held', 'failed')),
  problem     TEXT,
  updated_at  TEXT    NOT NULL,
  UNIQUE (template_id, skill_key)
);
`;
