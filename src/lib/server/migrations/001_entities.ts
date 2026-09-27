/**
 * Migration 001 — the entity model.
 *
 * The SQL lives in a TypeScript module, NOT a .sql file read from disk, and
 * that is load-bearing. A .sql file beside this one survives `node --test`
 * (which loads source) but not `vite build` (which only carries imported
 * modules), so a disk-reading runner finds zero migrations in production and
 * silently creates nothing. A module import is bundler-safe by construction.
 * Do not "tidy" this back into a .sql file.
 */
export const sql = `
-- src/lib/server/migrations/001_entities.sql
--
-- The entity model. Replaces linkage by Hebrew display name with real keys.
-- See docs/superpowers/specs/2026-08-29-data-model-design.md.

CREATE TABLE teachers (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT    NOT NULL,
  phone  TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

-- One account = one billing contact and one login. A family is one account
-- with several students; an adult paying for themselves is one account with
-- one student and is_self = 1. Every student has exactly one account, so
-- balance, login and messaging need no self-payer special case.
CREATE TABLE accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  phone      TEXT,
  credential TEXT    NOT NULL,
  is_self    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

-- \`code\` is the URL slug (/portal?s=<code>), deliberately NOT the primary
-- key: it must stay rotatable, because it is currently the child's
-- transliterated first name guarding a 4-digit PIN.
CREATE TABLE students_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  emoji         TEXT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  progress      INTEGER NOT NULL DEFAULT 0,
  progress_note TEXT,
  credential    TEXT    NOT NULL,
  created_at    TEXT    NOT NULL
);

-- A student enrolls in a subject, and that enrollment carries its own level
-- and its own tutor: two tutors may split one child by subject.
CREATE TABLE enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  subject    TEXT    NOT NULL,
  level      TEXT,
  teacher_id INTEGER REFERENCES teachers(id),
  UNIQUE (student_id, subject)
);

CREATE TABLE bookings_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER REFERENCES enrollments(id),
  start         TEXT    NOT NULL,
  end           TEXT    NOT NULL,
  duration      INTEGER,
  at            TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'confirmed'
);
CREATE INDEX idx_bookings_v2_start ON bookings_v2(start);

-- teacher_id here is the HISTORICAL fact of who taught this lesson, which is
-- why it is not read through the enrollment: reassigning a student must not
-- rewrite the history of lessons someone else gave.
CREATE TABLE lessons_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER REFERENCES enrollments(id),
  teacher_id    INTEGER REFERENCES teachers(id),
  slug          TEXT    NOT NULL UNIQUE,
  topic         TEXT,
  title         TEXT,
  context       TEXT,
  summary       TEXT,
  status        TEXT    NOT NULL,
  problem       TEXT,
  slides_path   TEXT,
  lesson_at     TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX idx_lessons_v2_student ON lessons_v2(student_id, created_at DESC);

-- done_manual covers homework with no data_id (e.g. "exercises 1-10 in the
-- book"), which has no result to derive completion from.
CREATE TABLE homework (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id   INTEGER REFERENCES lessons_v2(id),
  student_id  INTEGER NOT NULL REFERENCES students_v2(id),
  task        TEXT    NOT NULL,
  template    TEXT,
  data_id     TEXT,
  assigned_at TEXT    NOT NULL,
  due_at      TEXT,
  done_manual INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_homework_student ON homework(student_id, assigned_at DESC);

CREATE TABLE results_v2 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  at         TEXT    NOT NULL,
  data_id    TEXT,
  template   TEXT,
  score      INTEGER,
  total      INTEGER,
  tries      INTEGER,
  stars      INTEGER,
  seconds    INTEGER,
  missed     TEXT
);
CREATE INDEX idx_results_v2_student ON results_v2(student_id, at DESC);

-- amount_agorot, never a float. booking_id is nullable so a manually
-- recorded lesson needs no booking to exist.
CREATE TABLE payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  booking_id    INTEGER REFERENCES bookings_v2(id),
  date          TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN ('single', 'double')),
  amount_agorot INTEGER NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('owed', 'paid')),
  note          TEXT
);
CREATE INDEX idx_payments_account ON payments(account_id);

CREATE TABLE calendar_failures_v2 (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings_v2(id),
  message    TEXT,
  at         TEXT    NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 0
);
`;
