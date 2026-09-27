/**
 * Migration 019 — which Google Drive file is which, and what it last held.
 *
 * Spec: docs/superpowers/specs/2026-09-25-drive-student-folders-design.md.
 * Drive ids and sync bookkeeping ONLY: Drive is never the database of
 * student details, permissions or payments.
 *
 *   key             'root' | 'student:<id>' | 'index:<id>' | 'lesson:<slug>'
 *   synced_version  the plan version the file was last written from
 *   synced_modified the file's modifiedTime right after WE last wrote or
 *                   read it — a later modifiedTime means someone edited it
 */
export const sql = `
CREATE TABLE drive_items (
  key             TEXT PRIMARY KEY,
  file_id         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('root', 'student', 'index', 'lesson')),
  synced_version  INTEGER,
  synced_modified TEXT,
  updated_at      TEXT NOT NULL
);
`;
