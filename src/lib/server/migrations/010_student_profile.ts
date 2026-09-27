/**
 * Migration 010 — a server home for the three fields nothing else ever
 * touched: goals, learning style, and free-text notes.
 *
 * The tutor dashboard's student card has always shown more than the entity
 * model carries. Name, emoji, progress, progress_note, phone, the account
 * name, the subjects — all of that already lives in `students_v2` /
 * `accounts` / `enrollments` and reaches the dashboard through roster()
 * (src/lib/server/entities.ts). `level` lives on `enrollments`. But `goals`,
 * `style` and `notes` were never given a column anywhere: they existed only
 * inside one browser's localStorage, under the key `tutor_dashboard_v2`.
 * That is why the same student could read differently on two devices, or
 * two screens — the "real" data (SQLite) never knew these fields existed,
 * and the browser copy never left the browser it was written in.
 *
 * `ALTER TABLE ... ADD COLUMN` is additive: it does not rewrite existing
 * rows, so every current student simply gains three NULL columns. That is
 * deliberately different from 003_payment_kinds.ts, which had to rebuild
 * `payments` wholesale because a CHECK constraint can't be altered any other
 * way. No constraint is changing here, so a rebuild would only add risk
 * (see that file's header for what a rebuild costs) for no benefit.
 */
export const sql = `
ALTER TABLE students_v2 ADD COLUMN goals TEXT;
ALTER TABLE students_v2 ADD COLUMN style TEXT;
ALTER TABLE students_v2 ADD COLUMN notes TEXT;
`;
