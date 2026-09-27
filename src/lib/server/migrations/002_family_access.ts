/**
 * Migration 002 — family access, and the v1 → v2 backfill.
 *
 * Two jobs in one migration, because they cannot be separated: the new
 * access model addresses accounts, and until this runs there are no
 * accounts — migration 001 created the entity tables and nothing has ever
 * written a row into them.
 *
 * 1. `accounts` gains `email` (the magic-link destination) and
 *    `legacy_code` (provenance, and the join key the backfill below needs).
 * 2. Every legacy `students` row becomes an account + a students_v2 row +
 *    an enrollment.
 * 3. `join_codes` — short-lived codes a parent hands their child so the
 *    child's own device can claim a student session.
 *
 * ## Why this file re-creates the legacy `students` table
 *
 * `migrate()` runs inside db.ts's singleton factory, BEFORE db.ts's own
 * `CREATE TABLE IF NOT EXISTS students`. On an existing deployment the
 * table is already there from a previous boot and the CREATE below is a
 * no-op; on a fresh database it does not exist yet, and `INSERT ... SELECT
 * FROM students` would fail with "no such table" — which hooks.server.ts
 * deliberately turns into a refusal to boot. Creating it here with the
 * full shape (phone and password included — db.ts adds those by ALTER on
 * older databases, so they are always present by the time this runs on a
 * deployment that has any rows) makes the backfill total: it either copies
 * real rows or copies nothing, and never throws either way.
 *
 * ## What "safe to re-run" does and does not mean here
 *
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the two ALTERs above make
 * this migration replay-hostile by construction: applying it twice fails on
 * `duplicate column name`. That is the normal migration contract —
 * `schema_version` exists precisely so nothing replays — and it is stated
 * rather than papered over, because the NOT EXISTS guards on the INSERTs
 * below look like replay safety and are not.
 *
 * What those guards actually buy is a clean *partial* story. DDL is
 * transactional in SQLite and the runner wraps this whole file in one
 * transaction, so a failure anywhere rolls back the columns, the indexes,
 * the seeds and the backfill together: the database is either fully on 002
 * or fully off it, never half-backfilled. The guards then keep the
 * backfill itself honest about rows that already exist, which matters when
 * this runs against a deployment where some students were created after
 * 001 shipped.
 */
export const sql = `
ALTER TABLE accounts ADD COLUMN email TEXT;
ALTER TABLE accounts ADD COLUMN legacy_code TEXT;

-- Emails identify a returning family, so two accounts must never share one.
-- SQLite treats NULLs as distinct, so every backfilled row (which has no
-- email) coexists under this index without collision.
CREATE UNIQUE INDEX idx_accounts_email ON accounts(email);
CREATE UNIQUE INDEX idx_accounts_legacy_code ON accounts(legacy_code);

-- See the header: present on a real deployment, absent on a fresh database.
CREATE TABLE IF NOT EXISTS students (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT,
  level       TEXT,
  student_pin TEXT NOT NULL,
  parent_pin  TEXT NOT NULL,
  phone       TEXT,
  password    TEXT,
  created_at  TEXT NOT NULL
);

-- The two tutors the landing page sells by name. defaultTeacher() takes the
-- lowest active id, so ניקול is inserted first: she is who every existing
-- portal record and every piece of downstream copy already attributes to.
INSERT INTO teachers (name, phone, active)
SELECT 'ניקול', '972546969891', 1
WHERE NOT EXISTS (SELECT 1 FROM teachers WHERE name = 'ניקול');

INSERT INTO teachers (name, phone, active)
SELECT 'ליאור', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM teachers WHERE name = 'ליאור');

-- One account per existing student. There is no parent name on record —
-- the legacy table only ever stored the child's — so the account carries
-- the same name until the family corrects it. is_self stays 0: an existing
-- record cannot tell us whether the learner is an adult, and guessing 1
-- would hide the child-sharing flow from a family that needs it.
INSERT INTO accounts (name, phone, credential, is_self, created_at, email, legacy_code)
SELECT s.name, s.phone, COALESCE(s.password, s.student_pin), 0, s.created_at, NULL, s.code
FROM students s
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.legacy_code = s.code);

INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
SELECT s.code, s.name, '🎓', a.id, 0, NULL, COALESCE(s.password, s.student_pin), s.created_at
FROM students s
JOIN accounts a ON a.legacy_code = s.code
WHERE NOT EXISTS (SELECT 1 FROM students_v2 v WHERE v.code = s.code);

-- A legacy row carries one subject and one level, which is exactly one
-- enrollment. Rows with no subject recorded get none rather than an
-- enrollment named ''.
INSERT INTO enrollments (student_id, subject, level, teacher_id)
SELECT v.id, s.subject, s.level, (SELECT id FROM teachers WHERE name = 'ניקול')
FROM students s
JOIN students_v2 v ON v.code = s.code
WHERE s.subject IS NOT NULL AND TRIM(s.subject) != ''
  AND NOT EXISTS (
    SELECT 1 FROM enrollments e WHERE e.student_id = v.id AND e.subject = s.subject
  );

-- A parent hands one of these to a child so the child's own device can
-- claim a student session. Short-lived and single-use: used_at is stamped
-- on redemption and a stamped code is never accepted again.
CREATE TABLE join_codes (
  code       TEXT    PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL,
  used_at    TEXT
);
CREATE INDEX idx_join_codes_student ON join_codes(student_id);
`;
