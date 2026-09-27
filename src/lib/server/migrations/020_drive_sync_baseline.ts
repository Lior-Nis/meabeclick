/**
 * Migration 020 — two more facts per Drive file, from the final review of
 * the sync (docs/superpowers/specs/2026-09-25-drive-student-folders-design.md).
 *
 *   synced_hash  sha256 of Drive's own Markdown export right after we last
 *                wrote or read the file. Whether the tutor edited it is
 *                decided against THIS, not by re-parsing our own write —
 *                the round trip is not exact, and re-parsing called our own
 *                writes her edits.
 *   blocked      set when her Drive edit could not be read: her text is the
 *                only copy, so nothing is pushed over it until it parses or
 *                the file is replaced. NULL otherwise.
 *
 * A separate migration because 019 is already applied in production.
 */
export const sql = `
ALTER TABLE drive_items ADD COLUMN synced_hash TEXT;
ALTER TABLE drive_items ADD COLUMN blocked TEXT;
`;
