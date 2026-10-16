/**
 * Migration 028 — a tutor connects their own Meet room from a setup link.
 *
 * `setup_hash` / `setup_expires`: the SHA-256 of the newest setup link's
 * code and when it stops working. The code itself is never stored, so the
 * database never holds a working link. NULL means no link is out.
 *
 * `meet_account`: the Google account that owns `meet_url` (027). The tutor
 * must be signed into Meet with it to admit families, so it is shown back
 * to them and on the dashboard.
 * See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 */
export const sql = `
ALTER TABLE teachers ADD COLUMN setup_hash TEXT;
ALTER TABLE teachers ADD COLUMN setup_expires TEXT;
ALTER TABLE teachers ADD COLUMN meet_account TEXT;
`;
