# Real Entity Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Hebrew-display-name linkage with real entities and foreign keys — teachers, accounts, students, enrollments, lessons, homework, results, payments — so the system can express who taught what to whom and who pays for it.

**Architecture:** A versioned migration runner creates the new schema inside `db.ts`'s initialisation. Phase 1 is purely additive: new tables and new accessors land alongside the old ones, and every existing test stays green. Phase 2 switches each consumer over and deletes the old paths. Phase 3 adds the payments UI and performs the production cutover.

**Tech Stack:** SvelteKit 2.70.3 + adapter-node, Svelte 5 runes, TypeScript, `node:sqlite` (`DatabaseSync`), `node:test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-29-data-model-design.md`

## Global Constraints

- **No new dependencies.** No ORM, no query builder, no migration library. `node:sqlite` and `node:test` are Node 22 built-ins.
- **`node --test <dir>` is broken on Node 22.22** — it resolves the directory as a CJS entry point. Always use the quoted glob: `npm test` runs `node --test "tests/**/*.test.mjs"`.
- **Server modules read `process.env` directly**, never `$env/dynamic/private` — that is a Vite virtual module and would make the file unimportable by `node --test` (ruling P2 from the migration).
- **`PRAGMA foreign_keys = ON`** must be set on the connection. SQLite ignores `FOREIGN KEY` declarations without it.
- **Money is `INTEGER` agorot.** Never a float. `10000` = ₪100.
- **Hebrew strings are byte-identical.** Never retype a Hebrew literal by hand — copy it. Hebrew is load-bearing for RTL layout, not decoration.
- **Every test file is its own process.** `node --test` forks per file, so module-level state is not shared across files but *is* shared between tests within one file.
- **Unit tests set `process.env.DB_PATH` to a fresh tmpdir before dynamically importing `db.ts`** — the module opens its handle at load time. Follow `tests/unit/db.test.mjs`.
- **Do not touch `mea-beclick-kb/students/`.** It is the tutor's Obsidian vault and contains real student PII.

---

# Phase 1 — Data layer (purely additive)

At the end of Phase 1 the application behaves exactly as it does today. New tables exist and new accessors are tested, but nothing calls them yet. All 79 existing tests still pass.

---

### Task 1: Migration runner

**Files:**
- Create: `src/lib/server/migrations/index.ts`
- Create: `src/lib/server/migrations/001_entities.sql`
- Modify: `src/lib/server/db.ts:88-92` (the `singleton('db', ...)` factory)
- Test: `tests/unit/migrations.test.mjs`

**Interfaces:**
- Consumes: nothing
- Produces: `migrate(db: DatabaseSync): void` — applies every pending numbered migration inside a transaction, recording each in `schema_version`. Idempotent: a second call is a no-op.

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/migrations.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'mig-'));
  return new DatabaseSync(join(dir, 'test.db'));
}

test('migrate creates the entity tables and records the version', async () => {
  const db = await freshDb();
  migrate(db);

  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all().map(r => r.name);

  for (const t of ['accounts', 'enrollments', 'homework', 'payments', 'teachers']) {
    assert.ok(tables.includes(t), `expected table ${t}, got ${tables.join(', ')}`);
  }
  assert.equal(db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get().v, 1);
});

test('migrate is idempotent', async () => {
  const db = await freshDb();
  migrate(db);
  migrate(db);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get().c, 1);
});

test('a failing migration rolls back the statements that already succeeded', async () => {
  const db = await freshDb();
  // Collide on `payments`, near the END of 001 — so teachers, accounts and
  // students_v2 have already been created inside the transaction when the
  // failure hits. Colliding on the FIRST table would prove nothing: nothing
  // would have succeeded yet, and this would pass even with the
  // BEGIN/COMMIT/ROLLBACK removed from migrate() entirely.
  db.exec(`CREATE TABLE payments (bogus TEXT)`);
  assert.throws(() => migrate(db));

  const tables = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'`
  ).all().map(r => r.name);

  assert.ok(!tables.includes('teachers'),    'teachers survived a rolled-back migration');
  assert.ok(!tables.includes('accounts'),    'accounts survived a rolled-back migration');
  assert.ok(!tables.includes('students_v2'), 'students_v2 survived a rolled-back migration');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get().c, 0);
});
```

Verify this test has teeth before committing: comment out `db.exec('ROLLBACK')` in `migrate()`'s catch block, confirm the test FAILS, then restore it. A rollback test that passes against a runner with no rollback is not a test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/unit/migrations.test.mjs"`
Expected: FAIL — `Cannot find module '.../migrations/index.ts'`

- [ ] **Step 3: Write the migration runner**

```ts
// src/lib/server/migrations/index.ts
/**
 * Versioned schema migrations.
 *
 * Replaces the `try { ALTER TABLE ... } catch {}` pattern this file's
 * predecessor used (db.ts:172 and :180 before this change), which had no
 * version record: it could not tell an already-applied change from a failed
 * one, and could not express anything but an additive column.
 *
 * Each migration runs inside a transaction together with the INSERT that
 * records it, so a migration and its version marker cannot disagree — a
 * half-applied schema is what turns a deploy into a manual repair job.
 */
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `001_entities.sql` -> 1. Files not matching this shape are ignored. */
const NUMBERED = /^(\d+)_.*\.sql$/;

function pending(db: DatabaseSync): { version: number; file: string }[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (db.prepare(`SELECT version FROM schema_version`).all() as { version: number }[])
      .map(r => r.version)
  );
  return readdirSync(HERE)
    .map(file => ({ file, m: NUMBERED.exec(file) }))
    .filter(x => x.m && !applied.has(Number(x.m[1])))
    .map(x => ({ version: Number(x.m![1]), file: x.file }))
    .sort((a, b) => a.version - b.version);
}

export function migrate(db: DatabaseSync): void {
  for (const { version, file } of pending(db)) {
    const sql = readFileSync(join(HERE, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`)
        .run(version, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      // Refuse to continue: a later migration written against the schema
      // this one was meant to produce would fail in a far more confusing way.
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Write the schema**

```sql
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

-- `code` is the URL slug (/portal?s=<code>), deliberately NOT the primary
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
  kind          TEXT    NOT NULL,
  amount_agorot INTEGER NOT NULL,
  status        TEXT    NOT NULL,
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
```

The `_v2` suffixes exist only during Phase 1, so the new tables can live beside the old ones while nothing consumes them. Task 12 renames them once the old tables are dropped.

- [ ] **Step 5: Call the runner from db.ts and enable foreign keys**

In `src/lib/server/db.ts`, replace the `singleton('db', ...)` line (currently line 92) with:

```ts
import { migrate } from './migrations/index.ts';

// Migrations run inside the singleton factory, not in hooks.server.ts,
// because unit tests import this module directly and never execute hooks —
// running them there would leave every test on an unmigrated database.
const db = singleton('db', () => {
  const handle = new DatabaseSync(DB_PATH);
  // SQLite ignores FOREIGN KEY declarations unless this is on, per
  // connection. Without it every constraint in 001_entities.sql is a comment.
  handle.exec(`PRAGMA foreign_keys = ON`);
  migrate(handle);
  return handle;
});
```

Leave the existing `db.exec(...)` CREATE TABLE block and both `ALTER TABLE` lines untouched for now — Phase 1 is additive, and Task 12 removes them.

- [ ] **Step 6: Run the tests**

Run: `node --test "tests/unit/migrations.test.mjs"`
Expected: PASS (3 tests)

Run: `npm test`
Expected: PASS — all 79 existing tests still green, since nothing consumes the new tables yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/migrations tests/unit/migrations.test.mjs src/lib/server/db.ts
git commit -m "Add a versioned migration runner and the entity schema"
```

---

### Task 2: Teacher and account accessors

**Files:**
- Create: `src/lib/server/entities.ts`
- Test: `tests/unit/entities-accounts.test.mjs`

**Interfaces:**
- Consumes: `migrate()` from Task 1 (via `db.ts`'s handle)
- Produces:
  - `type TeacherRow = { id: number; name: string; phone: string | null; active: number }`
  - `type AccountRow = { id: number; name: string; phone: string | null; credential: string; is_self: number; created_at: string }`
  - `createTeacher(t: { name: string; phone?: string | null }): TeacherRow`
  - `listTeachers(): TeacherRow[]`
  - `getTeacher(id: number): TeacherRow | null`
  - `defaultTeacher(): TeacherRow | null` — the lowest-id active teacher; the single seeded tutor until per-teacher auth exists
  - `createAccount(a: { name: string; phone?: string | null; credential: string; isSelf?: boolean }): AccountRow`
  - `getAccount(id: number): AccountRow | null`
  - `findAccountByCredential(name: string, credential: string): AccountRow | null`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/entities-accounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'ent-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');

test('defaultTeacher returns the lowest-id active teacher', () => {
  const nicole = E.createTeacher({ name: 'ניקול', phone: '972546969891' });
  E.createTeacher({ name: 'ניקה', phone: null });
  assert.equal(E.defaultTeacher().id, nicole.id);
  assert.equal(E.defaultTeacher().name, 'ניקול');
});

test('defaultTeacher skips a deactivated teacher', async () => {
  const { handle } = await import('../../src/lib/server/db.ts');
  const first = E.defaultTeacher();
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(first.id);

  const next = E.defaultTeacher();
  assert.notEqual(next.id, first.id, 'a deactivated teacher is still being returned');

  // Restore, so the row state stays as later tests in this file expect —
  // node:test shares one module instance, and therefore one database,
  // across every test in a file.
  handle().prepare(`UPDATE teachers SET active = 1 WHERE id = ?`).run(first.id);
});

test('createAccount round-trips and defaults is_self to 0', () => {
  const a = E.createAccount({ name: 'אמא של נוגה', phone: '0501234567', credential: 'pw1' });
  assert.equal(E.getAccount(a.id).name, 'אמא של נוגה');
  assert.equal(a.is_self, 0);
});

test('is_self marks an adult paying for themselves', () => {
  const a = E.createAccount({ name: 'Lior', credential: 'pw2', isSelf: true });
  assert.equal(a.is_self, 1);
});

test('findAccountByCredential requires both name and credential', () => {
  E.createAccount({ name: 'משפחת כהן', credential: 'secret' });
  assert.ok(E.findAccountByCredential('משפחת כהן', 'secret'));
  assert.equal(E.findAccountByCredential('משפחת כהן', 'wrong'), null);
  assert.equal(E.findAccountByCredential('מישהו אחר', 'secret'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/unit/entities-accounts.test.mjs"`
Expected: FAIL — `Cannot find module '.../entities.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/entities.ts
/**
 * Accessors for the entity model: teachers, accounts, students, enrollments.
 *
 * Separate from db.ts deliberately. db.ts is 508 lines carrying the legacy
 * name-keyed tables; putting the new model there would make a file that is
 * already hard to hold in context harder still, and would blur which
 * accessors are being retired.
 */
import { handle } from './db.ts';

export type TeacherRow = { id: number; name: string; phone: string | null; active: number };
export type AccountRow = {
  id: number; name: string; phone: string | null;
  credential: string; is_self: number; created_at: string;
};

export function createTeacher(t: { name: string; phone?: string | null }): TeacherRow {
  const info = handle().prepare(
    `INSERT INTO teachers (name, phone, active) VALUES (?, ?, 1)`
  ).run(t.name, t.phone ?? null);
  return getTeacher(Number(info.lastInsertRowid))!;
}

export function getTeacher(id: number): TeacherRow | null {
  return (handle().prepare(`SELECT * FROM teachers WHERE id = ?`).get(id) as TeacherRow) ?? null;
}

export function listTeachers(): TeacherRow[] {
  return handle().prepare(`SELECT * FROM teachers ORDER BY id`).all() as TeacherRow[];
}

/** The tutor everything is attributed to until per-teacher auth exists.
 *  Lowest id rather than "the only one" so seeding a second teacher for a
 *  future change cannot silently repoint existing behaviour. */
export function defaultTeacher(): TeacherRow | null {
  return (handle().prepare(
    `SELECT * FROM teachers WHERE active = 1 ORDER BY id LIMIT 1`
  ).get() as TeacherRow) ?? null;
}

export function createAccount(
  a: { name: string; phone?: string | null; credential: string; isSelf?: boolean },
): AccountRow {
  const info = handle().prepare(`
    INSERT INTO accounts (name, phone, credential, is_self, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(a.name, a.phone ?? null, a.credential, a.isSelf ? 1 : 0, new Date().toISOString());
  return getAccount(Number(info.lastInsertRowid))!;
}

export function getAccount(id: number): AccountRow | null {
  return (handle().prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as AccountRow) ?? null;
}

/** Name AND credential, because the credential alone is not unique across
 *  accounts and a family password is short by design. */
export function findAccountByCredential(name: string, credential: string): AccountRow | null {
  return (handle().prepare(
    `SELECT * FROM accounts WHERE name = ? AND credential = ?`
  ).get(String(name).trim(), String(credential).trim()) as AccountRow) ?? null;
}
```

- [ ] **Step 4: Export the handle from db.ts**

`entities.ts` needs the same connection so both see one migrated database. Add to `src/lib/server/db.ts`, just after the `singleton('db', ...)` block:

```ts
/** The shared connection, for src/lib/server/entities.ts. A function rather
 *  than the binding itself so importers cannot capture a handle from before
 *  migrate() ran. */
export function handle(): DatabaseSync {
  return db;
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/unit/entities-accounts.test.mjs"`
Expected: PASS (6 tests)

Run: `npm test`
Expected: PASS — 79 existing + new.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/entities.ts src/lib/server/db.ts tests/unit/entities-accounts.test.mjs
git commit -m "Add teacher and account accessors"
```

---

### Task 3: Student and enrollment accessors

**Files:**
- Modify: `src/lib/server/entities.ts`
- Test: `tests/unit/entities-students.test.mjs`

**Interfaces:**
- Consumes: `createAccount`, `createTeacher` from Task 2
- Produces:
  - `type StudentRow = { id: number; code: string; name: string; emoji: string | null; account_id: number; progress: number; progress_note: string | null; credential: string; created_at: string }`
  - `type EnrollmentRow = { id: number; student_id: number; subject: string; level: string | null; teacher_id: number | null }`
  - `createStudent(s: { code: string; name: string; accountId: number; credential: string; emoji?: string | null }): StudentRow`
  - `getStudentById(id: number): StudentRow | null`
  - `getStudentByCode(code: string): StudentRow | null`
  - `listStudents(): StudentRow[]`
  - `studentsForAccount(accountId: number): StudentRow[]`
  - `renameStudent(id: number, name: string): void`
  - `setStudentCode(id: number, code: string): void`
  - `upsertEnrollment(e: { studentId: number; subject: string; level?: string | null; teacherId?: number | null }): EnrollmentRow`
  - `enrollmentsForStudent(studentId: number): EnrollmentRow[]`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/entities-students.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'stu-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');

const account = E.createAccount({ name: 'משפחת לוי', credential: 'fam' });
const nicole  = E.createTeacher({ name: 'ניקול' });
const nika    = E.createTeacher({ name: 'ניקה' });

test('two siblings share one account and stay distinct', () => {
  const a = E.createStudent({ code: 'dana',  name: 'דנה',  accountId: account.id, credential: 'p1' });
  const b = E.createStudent({ code: 'yossi', name: 'יוסי', accountId: account.id, credential: 'p2' });

  const both = E.studentsForAccount(account.id).map(s => s.code).sort();
  assert.deepEqual(both, ['dana', 'yossi']);
  assert.notEqual(a.id, b.id);
});

test('renaming a student keeps the same id, so history cannot orphan', () => {
  const s = E.createStudent({ code: 'rename-me', name: 'שם ישן', accountId: account.id, credential: 'p3' });
  E.renameStudent(s.id, 'שם חדש');
  assert.equal(E.getStudentById(s.id).name, 'שם חדש');
  assert.equal(E.getStudentById(s.id).code, 'rename-me');
});

test('the code can be rotated without touching the id', () => {
  const s = E.createStudent({ code: 'guessable', name: 'ילדה', accountId: account.id, credential: 'p4' });
  E.setStudentCode(s.id, 'k7m2xq4vp8');
  assert.equal(E.getStudentByCode('k7m2xq4vp8').id, s.id);
  assert.equal(E.getStudentByCode('guessable'), null);
});

test('one student can enroll in two subjects with different teachers', () => {
  const s = E.createStudent({ code: 'multi', name: 'ניקול ניסימוב', accountId: account.id, credential: 'p5' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: nicole.id });
  E.upsertEnrollment({ studentId: s.id, subject: 'עברית',   level: 'כיתה יא', teacherId: nika.id });

  const subjects = E.enrollmentsForStudent(s.id).map(e => e.subject).sort();
  assert.deepEqual(subjects, ['מתמטיקה', 'עברית'].sort());
});

test('upsertEnrollment updates rather than duplicating the same subject', () => {
  const s = E.createStudent({ code: 'up', name: 'עדכון', accountId: account.id, credential: 'p6' });
  E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'כיתה ז', teacherId: nicole.id });
  const again = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', level: 'כיתה ח', teacherId: nika.id });

  assert.equal(E.enrollmentsForStudent(s.id).length, 1);
  assert.equal(again.level, 'כיתה ח');
  assert.equal(again.teacher_id, nika.id);
});

test('a student cannot be created against a nonexistent account', () => {
  assert.throws(
    () => E.createStudent({ code: 'orphan', name: 'יתום', accountId: 99999, credential: 'p7' }),
    /FOREIGN KEY/i,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/unit/entities-students.test.mjs"`
Expected: FAIL — `E.createStudent is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lib/server/entities.ts`:

```ts
export type StudentRow = {
  id: number; code: string; name: string; emoji: string | null;
  account_id: number; progress: number; progress_note: string | null;
  credential: string; created_at: string;
};
export type EnrollmentRow = {
  id: number; student_id: number; subject: string;
  level: string | null; teacher_id: number | null;
};

export function createStudent(
  s: { code: string; name: string; accountId: number; credential: string; emoji?: string | null },
): StudentRow {
  const info = handle().prepare(`
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
    VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
  `).run(s.code, s.name, s.emoji ?? '🎓', s.accountId, s.credential, new Date().toISOString());
  return getStudentById(Number(info.lastInsertRowid))!;
}

export function getStudentById(id: number): StudentRow | null {
  return (handle().prepare(`SELECT * FROM students_v2 WHERE id = ?`).get(id) as StudentRow) ?? null;
}

export function getStudentByCode(code: string): StudentRow | null {
  return (handle().prepare(`SELECT * FROM students_v2 WHERE code = ?`).get(code) as StudentRow) ?? null;
}

export function listStudents(): StudentRow[] {
  return handle().prepare(`SELECT * FROM students_v2 ORDER BY created_at DESC`).all() as StudentRow[];
}

export function studentsForAccount(accountId: number): StudentRow[] {
  return handle().prepare(
    `SELECT * FROM students_v2 WHERE account_id = ? ORDER BY id`
  ).all(accountId) as StudentRow[];
}

/** The display name is now just a label. Nothing joins on it, which is the
 *  entire point: this used to silently orphan every result and lesson. */
export function renameStudent(id: number, name: string): void {
  handle().prepare(`UPDATE students_v2 SET name = ? WHERE id = ?`).run(name, id);
}

/** Rotating the URL slug. One row, because code is not the primary key. */
export function setStudentCode(id: number, code: string): void {
  handle().prepare(`UPDATE students_v2 SET code = ? WHERE id = ?`).run(code, id);
}

/** Keyed on (student_id, subject) by the table's UNIQUE constraint, so
 *  re-booking the same subject updates the level and tutor rather than
 *  accumulating duplicate enrollments. */
export function upsertEnrollment(
  e: { studentId: number; subject: string; level?: string | null; teacherId?: number | null },
): EnrollmentRow {
  handle().prepare(`
    INSERT INTO enrollments (student_id, subject, level, teacher_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (student_id, subject)
    DO UPDATE SET level = excluded.level, teacher_id = excluded.teacher_id
  `).run(e.studentId, e.subject, e.level ?? null, e.teacherId ?? null);

  return handle().prepare(
    `SELECT * FROM enrollments WHERE student_id = ? AND subject = ?`
  ).get(e.studentId, e.subject) as EnrollmentRow;
}

export function enrollmentsForStudent(studentId: number): EnrollmentRow[] {
  return handle().prepare(
    `SELECT * FROM enrollments WHERE student_id = ? ORDER BY id`
  ).all(studentId) as EnrollmentRow[];
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test "tests/unit/entities-students.test.mjs"`
Expected: PASS (6 tests). If the foreign-key test fails with no error thrown, `PRAGMA foreign_keys = ON` did not take effect — check Task 1 Step 5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/entities.ts tests/unit/entities-students.test.mjs
git commit -m "Add student and enrollment accessors"
```

---

### Task 4: Lesson, homework and derived completion

**Files:**
- Create: `src/lib/server/lessons.ts`
- Create: `src/lib/server/results.ts`
- Test: `tests/unit/lessons-homework.test.mjs`

**Interfaces:**
- Consumes: `createStudent`, `upsertEnrollment`, `createTeacher` from Tasks 2-3
- Produces:
  - `writeResult(r: { studentId: number; dataId?: unknown; template?: unknown; score?: unknown; total?: unknown; tries?: unknown; stars?: unknown; durationSec?: unknown; missed?: unknown }): void`
  - `getBest(studentId: number, dataId: string): number | null`
  - `resultsForStudent(studentId: number): ResultRow[]`
  - `newLessonSlug(): string` — 10 random base32 chars, always matching `/^[a-z0-9-]+$/`
  - `createLesson(l: { slug: string; studentId: number; enrollmentId?: number | null; teacherId?: number | null; topic?: string | null; lessonAt?: string | null }): number`
  - `finishLesson(slug: string, f: { status: string; title?: string | null; context?: string | null; summary?: string | null; slidesPath?: string | null; problem?: string | null }): void`
  - `readLessons(studentId?: number): LessonRow[]`
  - `addHomework(h: { lessonId?: number | null; studentId: number; task: string; template?: string | null; dataId?: string | null; dueAt?: string | null }): number`
  - `markHomeworkDone(id: number, done: boolean): void`
  - `homeworkForStudent(studentId: number): (HomeworkRow & { done: boolean })[]`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/lessons-homework.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'les-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const stu  = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('a generated slug always passes assertPathSegment', async () => {
  const { assertPathSegment } = await import('../../src/lib/server/urls.ts');
  for (let i = 0; i < 200; i++) {
    assertPathSegment('slug', L.newLessonSlug());   // throws on failure
  }
});

test('homework with no result is not done', () => {
  const slug = L.newLessonSlug();
  L.createLesson({ slug, studentId: stu.id, topic: 'אינטגרלים' });
  L.addHomework({ studentId: stu.id, task: 'משחק זיכרון', template: 'memory', dataId: 'noga-int-memory' });

  const hw = L.homeworkForStudent(stu.id);
  assert.equal(hw.length, 1);
  assert.equal(hw[0].done, false);
});

test('homework becomes done when a matching result exists', () => {
  L.addHomework({ studentId: stu.id, task: 'ציד טעויות', template: 'error-hunt', dataId: 'noga-err' });
  R.writeResult({ studentId: stu.id, dataId: 'noga-err', template: 'error-hunt', score: 8, total: 10 });

  const item = L.homeworkForStudent(stu.id).find(h => h.data_id === 'noga-err');
  assert.equal(item.done, true);
});

test("another student's result does not complete this student's homework", () => {
  const other = E.createStudent({ code: 'other', name: 'אחר', accountId: acct.id, credential: 'q' });
  L.addHomework({ studentId: stu.id, task: 'משותף', template: 'quiz', dataId: 'shared-id' });
  R.writeResult({ studentId: other.id, dataId: 'shared-id', template: 'quiz', score: 10, total: 10 });

  const item = L.homeworkForStudent(stu.id).find(h => h.data_id === 'shared-id');
  assert.equal(item.done, false);
});

test('a successful finish clears an earlier problem but keeps the other fields', () => {
  const slug = L.newLessonSlug();
  L.createLesson({ slug, studentId: stu.id, topic: 'אינטגרלים' });

  L.finishLesson(slug, { status: 'held', problem: 'חסרים פרטים על הכיתה' });
  const held = L.readLessons(stu.id).find(l => l.slug === slug);
  assert.equal(held.problem, 'חסרים פרטים על הכיתה');

  L.finishLesson(slug, { status: 'ready', title: 'אינטגרציה בהצבה' });
  const ready = L.readLessons(stu.id).find(l => l.slug === slug);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.problem, null, 'a stale problem survived a successful finish');
  assert.equal(ready.title, 'אינטגרציה בהצבה');

  // And the COALESCE'd fields survive a later status-only update.
  L.finishLesson(slug, { status: 'ready' });
  assert.equal(L.readLessons(stu.id).find(l => l.slug === slug).title, 'אינטגרציה בהצבה',
    'a status-only update blanked a COALESCE-protected field');
});

test('homework with no dataId falls back to the manual flag', () => {
  const id = L.addHomework({ studentId: stu.id, task: 'תרגילים 1-10 בספר' });
  assert.equal(L.homeworkForStudent(stu.id).find(h => h.id === id).done, false);
  L.markHomeworkDone(id, true);
  assert.equal(L.homeworkForStudent(stu.id).find(h => h.id === id).done, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/unit/lessons-homework.test.mjs"`
Expected: FAIL — `Cannot find module '.../lessons.ts'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/lessons.ts
/**
 * Lessons and homework.
 *
 * One lessons table holds both halves of a lesson: the generator fills
 * title/context/slides/status, the tutor fills summary, and either may be
 * empty. They describe the same event, and keeping them apart is what
 * produced two sources of truth (the lessons table and portal/<code>.json).
 */
import { randomBytes } from 'node:crypto';
import { handle } from './db.ts';

export type LessonRow = {
  id: number; student_id: number; enrollment_id: number | null;
  teacher_id: number | null; slug: string; topic: string | null;
  title: string | null; context: string | null; summary: string | null;
  status: string; problem: string | null; slides_path: string | null;
  lesson_at: string | null; created_at: string;
};
export type HomeworkRow = {
  id: number; lesson_id: number | null; student_id: number; task: string;
  template: string | null; data_id: string | null;
  assigned_at: string; due_at: string | null; done_manual: number;
};

// Crockford-ish base32 without vowels, so a token cannot spell a word and
// cannot collide with the /^[a-z0-9-]+$/ path-segment rule by construction.
// This replaces slugify(), whose \p{L} class passed Hebrew straight through
// and produced slugs that threw in assertPathSegment — every generated
// lesson 404'd.
const ALPHABET = '0123456789bcdfghjkmnpqrstvwxyz';

export function newLessonSlug(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

export function createLesson(l: {
  slug: string; studentId: number; enrollmentId?: number | null;
  teacherId?: number | null; topic?: string | null; lessonAt?: string | null;
}): number {
  const info = handle().prepare(`
    INSERT INTO lessons_v2
      (slug, student_id, enrollment_id, teacher_id, topic, status, lesson_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'generating', ?, ?)
  `).run(l.slug, l.studentId, l.enrollmentId ?? null, l.teacherId ?? null,
         l.topic ?? null, l.lessonAt ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishLesson(slug: string, f: {
  status: string; title?: string | null; context?: string | null;
  summary?: string | null; slidesPath?: string | null; problem?: string | null;
}): void {
  // `problem` is assigned, NOT COALESCE'd like the fields above it, and that
  // asymmetry is deliberate: it records why a lesson was held or failed, so a
  // later successful finish must clear it. COALESCE here would leave a stale
  // failure message rendered beside a working lesson for good.
  handle().prepare(`
    UPDATE lessons_v2 SET
      status = ?, title = COALESCE(?, title), context = COALESCE(?, context),
      summary = COALESCE(?, summary), slides_path = COALESCE(?, slides_path),
      problem = ?
    WHERE slug = ?
  `).run(f.status, f.title ?? null, f.context ?? null, f.summary ?? null,
         f.slidesPath ?? null, f.problem ?? null, slug);
}

export function readLessons(studentId?: number): LessonRow[] {
  return studentId == null
    ? handle().prepare(`SELECT * FROM lessons_v2 ORDER BY created_at DESC`).all() as LessonRow[]
    : handle().prepare(
        `SELECT * FROM lessons_v2 WHERE student_id = ? ORDER BY created_at DESC`
      ).all(studentId) as LessonRow[];
}

export function addHomework(h: {
  lessonId?: number | null; studentId: number; task: string;
  template?: string | null; dataId?: string | null; dueAt?: string | null;
}): number {
  const info = handle().prepare(`
    INSERT INTO homework (lesson_id, student_id, task, template, data_id, assigned_at, due_at, done_manual)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `).run(h.lessonId ?? null, h.studentId, h.task, h.template ?? null,
         h.dataId ?? null, new Date().toISOString(), h.dueAt ?? null);
  return Number(info.lastInsertRowid);
}

export function markHomeworkDone(id: number, done: boolean): void {
  handle().prepare(`UPDATE homework SET done_manual = ? WHERE id = ?`).run(done ? 1 : 0, id);
}

/**
 * `done` is DERIVED, not stored: the system already recorded that the child
 * played the game, matched by the identical data_id, and never joined the
 * two — so a finished assignment displayed as open forever. done_manual is
 * the fallback for homework with no data_id ("exercises 1-10 in the book"),
 * which has no result to derive from.
 *
 * The result must belong to the SAME student: data_id is shared across every
 * child assigned the same game, so matching on data_id alone would let one
 * child's play complete another's homework.
 */
export function homeworkForStudent(studentId: number): (HomeworkRow & { done: boolean })[] {
  const rows = handle().prepare(`
    SELECT h.*,
           (h.done_manual = 1 OR EXISTS (
              SELECT 1 FROM results_v2 r
              WHERE r.student_id = h.student_id AND r.data_id = h.data_id
           )) AS done_flag
    FROM homework h
    WHERE h.student_id = ?
    ORDER BY h.assigned_at DESC
  `).all(studentId) as (HomeworkRow & { done_flag: number })[];

  return rows.map(({ done_flag, ...row }) => ({ ...row, done: done_flag === 1 }));
}
```

- [ ] **Step 4: Write results.ts**

`homeworkForStudent` derives completion from `results_v2`, so the result writer belongs to this task — without it the derivation cannot be tested at all.

```ts
// src/lib/server/results.ts
/**
 * Game results, keyed on student_id.
 *
 * The retired version keyed on the Hebrew display name taken from the ?s=
 * query parameter, which meant two children sharing a first name shared a
 * results history, and renaming a child orphaned theirs.
 */
import { handle } from './db.ts';

export type ResultRow = {
  id: number; student_id: number; at: string; data_id: string | null;
  template: string | null; score: number | null; total: number | null;
  tries: number | null; stars: number | null; seconds: number | null;
  missed: string | null;
};

const int = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max: number): string | null =>
  v == null ? null : String(v).slice(0, max);

export function writeResult(r: {
  studentId: number; dataId?: unknown; template?: unknown; score?: unknown;
  total?: unknown; tries?: unknown; stars?: unknown; durationSec?: unknown; missed?: unknown;
}): void {
  handle().prepare(`
    INSERT INTO results_v2 (student_id, at, data_id, template, score, total, tries, stars, seconds, missed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    r.studentId, new Date().toISOString(),
    str(r.dataId, 120), str(r.template, 40),
    int(r.score), int(r.total), int(r.tries), int(r.stars), int(r.durationSec),
    JSON.stringify((Array.isArray(r.missed) ? r.missed : []).slice(0, 40).map(m => String(m).slice(0, 200))),
  );
}

export function getBest(studentId: number, dataId: string): number | null {
  const row = handle().prepare(
    `SELECT MAX(score) AS best FROM results_v2 WHERE student_id = ? AND data_id = ?`
  ).get(studentId, dataId) as { best: number | null } | undefined;
  return row?.best ?? null;
}

export function resultsForStudent(studentId: number): ResultRow[] {
  return handle().prepare(
    `SELECT * FROM results_v2 WHERE student_id = ? ORDER BY at DESC`
  ).all(studentId) as ResultRow[];
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test "tests/unit/lessons-homework.test.mjs"`
Expected: PASS (6 tests)

Run: `npm test`
Expected: PASS — all 79 existing tests plus everything added so far.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/lessons.ts src/lib/server/results.ts tests/unit/lessons-homework.test.mjs
git commit -m "Add lesson, homework and result accessors with derived completion"
```

---

### Task 5: Payments

**Files:**
- Create: `src/lib/server/payments.ts`
- Test: `tests/unit/payments.test.mjs`

**Interfaces:**
- Consumes: `createStudent`, `createAccount` from Tasks 2-3
- Produces:
  - `addPayment(p: { accountId: number; studentId: number; bookingId?: number | null; date: string; kind: 'single' | 'double'; amountAgorot: number; status: 'owed' | 'paid'; note?: string | null }): number`
  - `paymentsForAccount(accountId: number): PaymentRow[]`
  - `balanceForAccount(accountId: number): { owedAgorot: number; paidAgorot: number; balanceAgorot: number }`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/payments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'pay-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const P = await import('../../src/lib/server/payments.ts');

const acct = E.createAccount({ name: 'משפחת לוי', credential: 'fam' });
const dana = E.createStudent({ code: 'dana',  name: 'דנה',  accountId: acct.id, credential: 'a' });
const yosi = E.createStudent({ code: 'yossi', name: 'יוסי', accountId: acct.id, credential: 'b' });

test('balance is zero for an account with no payments', () => {
  const empty = E.createAccount({ name: 'חדש', credential: 'n' });
  assert.deepEqual(P.balanceForAccount(empty.id), { owedAgorot: 0, paidAgorot: 0, balanceAgorot: 0 });
});

test('balance sums owed minus paid across every child on the account', () => {
  P.addPayment({ accountId: acct.id, studentId: dana.id, date: '2026-08-01', kind: 'single', amountAgorot: 10000, status: 'paid' });
  P.addPayment({ accountId: acct.id, studentId: yosi.id, date: '2026-08-02', kind: 'double', amountAgorot: 18000, status: 'owed' });

  assert.deepEqual(P.balanceForAccount(acct.id), {
    owedAgorot: 18000, paidAgorot: 10000, balanceAgorot: 8000,
  });
});

test('balance sums exactly over many rows', () => {
  const a = E.createAccount({ name: 'דיוק', credential: 'd' });
  const s = E.createStudent({ code: 'exact', name: 'מדויק', accountId: a.id, credential: 'e' });
  for (let i = 0; i < 100; i++) {
    P.addPayment({ accountId: a.id, studentId: s.id, date: '2026-08-01', kind: 'single', amountAgorot: 3333, status: 'owed' });
  }
  assert.equal(P.balanceForAccount(a.id).balanceAgorot, 333300);
});

test('a payment cannot reference a nonexistent account', () => {
  assert.throws(
    () => P.addPayment({ accountId: 99999, studentId: dana.id, date: '2026-08-01', kind: 'single', amountAgorot: 10000, status: 'owed' }),
    /FOREIGN KEY/i,
  );
});

// Must come last: tests in one file share a database, and the balance
// assertions above depend on exact totals.
test('a non-integer amount is rejected rather than silently rounded', () => {
  const before = P.paymentsForAccount(acct.id).length;

  assert.throws(
    () => P.addPayment({
      accountId: acct.id, studentId: dana.id, date: '2026-08-01',
      kind: 'single', amountAgorot: 33.33, status: 'owed',
    }),
    /integer/,
    'a shekels-shaped amount was accepted',
  );

  assert.equal(P.paymentsForAccount(acct.id).length, before,
    'a rejected payment still wrote a row');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/unit/payments.test.mjs"`
Expected: FAIL — `Cannot find module '.../payments.ts'`

- [ ] **Step 3: Write payments.ts**

```ts
// src/lib/server/payments.ts
/**
 * Payments, replacing the hand-maintained Markdown table that
 * src/lib/server/pricing.ts parsed.
 *
 * That lookup matched a Hebrew display name against a Latin one and returned
 * null every time, so the parent portal's Payments section never rendered in
 * production. Rows keyed on account_id cannot fail that way.
 *
 * Amounts are INTEGER agorot. Currency is never a float: 100 * 0.01 summed
 * a hundred times is not 100 in binary floating point, and a balance a
 * parent reads must be exact.
 */
import { handle } from './db.ts';

export type PaymentRow = {
  id: number; account_id: number; student_id: number; booking_id: number | null;
  date: string; kind: string; amount_agorot: number; status: string; note: string | null;
};

export function addPayment(p: {
  accountId: number; studentId: number; bookingId?: number | null;
  date: string; kind: 'single' | 'double'; amountAgorot: number;
  status: 'owed' | 'paid'; note?: string | null;
}): number {
  // Amounts are agorot and must arrive as integers. Rounding a non-integer
  // here would silently paper over the exact bug this invariant exists to
  // catch: a caller that passed shekels, or botched a shekels-to-agorot
  // conversion. A wrong balance a parent reads is worse than a thrown error
  // a developer reads.
  if (!Number.isInteger(p.amountAgorot)) {
    throw new TypeError(
      `addPayment: amountAgorot must be an integer number of agorot, got ${p.amountAgorot}`,
    );
  }

  const info = handle().prepare(`
    INSERT INTO payments (account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.accountId, p.studentId, p.bookingId ?? null, p.date, p.kind,
         p.amountAgorot, p.status, p.note ?? null);
  return Number(info.lastInsertRowid);
}

export function paymentsForAccount(accountId: number): PaymentRow[] {
  return handle().prepare(
    `SELECT * FROM payments WHERE account_id = ? ORDER BY date DESC, id DESC`
  ).all(accountId) as PaymentRow[];
}

export function balanceForAccount(
  accountId: number,
): { owedAgorot: number; paidAgorot: number; balanceAgorot: number } {
  const row = handle().prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'owed' THEN amount_agorot END), 0) AS owed,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_agorot END), 0) AS paid
    FROM payments WHERE account_id = ?
  `).get(accountId) as { owed: number; paid: number };

  return { owedAgorot: row.owed, paidAgorot: row.paid, balanceAgorot: row.owed - row.paid };
}
```

- [ ] **Step 4: Run every new test**

Run: `node --test "tests/unit/payments.test.mjs"`
Expected: PASS (6 tests)

Run: `npm test`
Expected: PASS — the 79 existing tests plus everything added in Phase 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/payments.ts tests/unit/payments.test.mjs
git commit -m "Add payment accessors with exact integer money"
```

---

**Phase 1 checkpoint.** The entity model exists and is tested; the application still runs entirely on the old tables. Verify before continuing:

```bash
npm test          # all green
npm run check     # svelte-check, 0 errors
npm run build     # adapter-node build succeeds
```

---

# Phases 2 and 3 — scope only, not executable tasks

**Everything below this line is scope for two follow-on plan documents, not a task specification. Do not execute it.**

It is deliberately not expanded into steps yet. Phase 2 rewrites every consumer against the accessors Phase 1 introduces, so its task specs must quote real signatures — and those signatures are only settled once Phase 1 is written and its tests pass. Writing them now would mean inventing names for functions that do not exist, which is how a plan acquires a `clearLayers()` in one task and a `clearFullLayers()` in another.

Write `docs/superpowers/plans/2026-08-30-data-model-phase-2.md` after Task 5's checkpoint is green, using this section as its input.

## Phase 2 — Application cutover

Switches every consumer to the entity model and deletes the old paths. The application is *not* shippable part-way through this phase.

- **Task 6 — Signed URLs move to `student_id`.** `gameUrl` and `verifyGameSignature` sign `{dataId, studentId}` instead of the Hebrew display name, so renaming a child stops invalidating links already sent. `portalLink` keeps taking a code. Record the signature change in `tests/characterization/expected-changes.mjs`; every previously issued game link stops verifying, which is acceptable because `results` is empty in production. Must include the spec §7 test that rotating a student's `code` does *not* invalidate links already issued — that is the property the surrogate key was chosen for, and it is only true if the signature covers `student_id` rather than `code`.
- **Task 7 — `enroll.ts` creates account + student + enrollment.** `enrollFromBooking` resolves or creates the account, then the student, then upserts the enrollment for the booking's subject. `writePortalFile` and `updateNextLesson` are deleted outright: the portal is now rows.
- **Task 8 — The booking transaction.** `reserveBooking` grows into `reserveAndEnroll`, wrapping the overlap check, account, student, enrollment and booking insert in one synchronous `BEGIN`/`COMMIT`. `bookings_v2.student_id` is `NOT NULL`, and the explicit `cancelBooking` call for enrollment failures in `api/book/+server.ts` is removed — the rollback covers it. Test that a duplicate hour still 409s and that a failed enrollment leaves no booking row.
- **Task 9 — `queue.ts` writes rows.** `publish` keeps writing slide and game-data files; `appendToPortal` is replaced by `finishLesson` plus `addHomework` calls. Lesson slugs come from `newLessonSlug()`. Delete `slugify`.
- **Task 10 — Portal API reads the database.** `/api/portal/[code]` composes its response from `entities`/`lessons`/`results` instead of reading JSON, deriving `nextLesson` from bookings, `tutor`/`tutorPhone` from the enrollment's teacher, and `updated` from the newest lesson. Uniform denial is preserved exactly. A new `/api/account` endpoint authenticates the account credential and returns every child on it plus the balance; `kind=parent` is deleted as a client-supplied parameter.
- **Task 11 — The tutor leaves the source.** Replace the seven hardcoded name/phone literals with values read from the enrollment's teacher. Homepage marketing copy stays hardcoded — it is copy, not data.
- **Task 12 — Delete the old paths.** Migration `002_drop_legacy.sql` drops `students`, `results`, `lessons`, `bookings`, `calendar_failures` and renames every `_v2` table to its final name. Delete `pricing.ts`, `portalDir()`, the `PORTAL_DIR` env var, its boot check, the `mea-beclick-kb/pricing` bind mount in `docker-compose.yml`, both `try { ALTER TABLE } catch {}` lines, and the now-unused legacy accessors in `db.ts`. Update the harness (it currently creates `PORTAL_DIR` because the boot check demands it) and `.env.example`. `server/README.md` must additionally state, per spec §4.1, that `results.db` now holds payment records: removing the `mea-beclick-kb/pricing` mount means the deployment no longer enforces the PII separation that mount existed to guarantee, so it becomes a property of the backup policy instead and has to be written down somewhere an operator will read it.

---

# Phase 3 — Payments UI and production cutover

- **Task 13 — Record a session on the dashboard.** A form on `/app/dashboard` posting to a new `/api/payments` endpoint: student, date, kind, amount, status. Guarded by `apiAuthDenied`. Amounts entered in shekels, stored as agorot.
- **Task 14 — Balance on the account view.** `/app/account` renders each child and the account balance from `balanceForAccount`. Verify a student credential is refused here.
- **Task 15 — The seed.** `seed/001_real_records.sql`, checked in so the exact rows entering production are reviewable in the diff: נוגה (account, student, enrollment, three lesson summaries, four homework items, progress 72) and Lior (self-paying account, student, enrollment, one ₪100 payment dated 2026-04-07). Values copied from `portal/noga.json` and `mea-beclick-kb/pricing/Summary.md` — never retyped.
- **Task 16 — Cutover.** Follow spec §6.1 exactly and in order: copy `results.db` and `portal/noga.json` off the VPS and verify the copies are readable; rehearse the seed against the copy locally and diff the resulting rows against §6's enumerated list; stop the container before replacing the database (`node:sqlite` holds an open handle, and swapping the file under a running process leaves it reading a deleted inode); deploy; load נוגה's portal and confirm it against the values in §6; keep the pre-cutover copy until that confirmation passes.

---

## Notes for the executor

**The one-way door is Task 16, not Task 12.** Everything before the cutover is reversible by `git revert`. The cutover discards two `ניקול` student rows and four bookings by decision (spec §6), and there is no undo once the old database is gone.

**`portal/noga.json` is git-tracked *and* live-written.** The VPS working tree is dirty on that path. Never `git checkout -- portal/` on the box, and never seed from the repository's copy — take it from the VPS.

**Phase 1 is safe to ship on its own.** It is purely additive; if the work is interrupted, `main` stays deployable.
