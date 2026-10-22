import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

// Derived from the registry rather than written as a literal: these two
// assertions used to hard-code "1", so adding a migration failed them for
// no reason other than that a migration had been added. The property worth
// holding is that migrate() applies every registered migration exactly once.
const LATEST = Math.max(...MIGRATIONS.map(m => m.version));

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

  for (const t of ['accounts', 'enrollments', 'homework', 'payments', 'teachers', 'join_codes', 'game_filler']) {
    assert.ok(tables.includes(t), `expected table ${t}, got ${tables.join(', ')}`);
  }
  assert.equal(db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get().v, LATEST);
});

test('migrate is idempotent', async () => {
  const db = await freshDb();
  migrate(db);
  migrate(db);
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS c FROM schema_version`).get().c,
    MIGRATIONS.length,
  );
});

test('002 backfills a legacy student into an account, student and enrollment', async () => {
  const db = await freshDb();

  // The pre-migration shape: db.ts creates this table on every boot, so on a
  // real deployment it is already populated when 002 runs. 002 re-creates it
  // IF NOT EXISTS for the fresh-database case, which is why this test can
  // write the rows before migrating at all.
  db.exec(`
    CREATE TABLE students (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT, level TEXT,
      student_pin TEXT NOT NULL, parent_pin TEXT NOT NULL,
      phone TEXT, password TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO students VALUES
      ('noga', 'נוגה', 'מתמטיקה', 'כיתה יב', '1234', '5678', '0501111111', 'pw', '2026-04-07T10:00:00Z'),
      ('nikol', 'ניקול ב', '', NULL, '2222', '3333', NULL, NULL, '2026-05-01T10:00:00Z');
  `);

  migrate(db);

  const account = db.prepare(`SELECT * FROM accounts WHERE legacy_code = 'noga'`).get();
  assert.ok(account, 'the legacy student did not become an account');
  assert.equal(account.name, 'נוגה');
  assert.equal(account.phone, '0501111111');
  assert.equal(account.email, null, 'a backfilled account has no email until the family books again');
  assert.equal(account.is_self, 0);

  const student = db.prepare(`SELECT * FROM students_v2 WHERE code = 'noga'`).get();
  assert.equal(student.account_id, account.id);
  assert.equal(student.name, 'נוגה');

  const enrollment = db.prepare(`SELECT * FROM enrollments WHERE student_id = ?`).get(student.id);
  assert.equal(enrollment.subject, 'מתמטיקה');
  assert.equal(enrollment.level, 'כיתה יב');
  assert.ok(enrollment.teacher_id, 'the enrollment should carry the seeded tutor');

  // A legacy row with no subject gets an account and a student but no
  // enrollment named ''.
  const blank = db.prepare(`SELECT * FROM students_v2 WHERE code = 'nikol'`).get();
  assert.ok(blank, 'a subject-less legacy student should still migrate');
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS c FROM enrollments WHERE student_id = ?`).get(blank.id).c,
    0,
  );
});

test('a failing 002 leaves no half-backfilled database behind', async () => {
  const db = await freshDb();
  db.exec(`
    CREATE TABLE students (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT, level TEXT,
      student_pin TEXT NOT NULL, parent_pin TEXT NOT NULL,
      phone TEXT, password TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO students VALUES
      ('noga', 'נוגה', 'מתמטיקה', 'כיתה יב', '1234', '5678', NULL, 'pw', '2026-04-07T10:00:00Z');
  `);

  // Collide on join_codes, the LAST statement in 002 — so the columns, the
  // indexes, the tutor seed and the whole backfill have already succeeded
  // inside the transaction when the failure hits. This is the state an
  // operator would actually be left holding, and a half-migrated family
  // model is far worse than an unmigrated one: accounts would exist with no
  // way to hand a child a code.
  db.exec(`CREATE TABLE join_codes (bogus TEXT)`);
  assert.throws(() => migrate(db));

  // 001 committed in its own transaction and stays; 002 must be entirely gone.
  assert.equal(db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get().v, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM accounts`).get().c, 0,
    'a rolled-back 002 left accounts behind');
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM students_v2`).get().c, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM teachers`).get().c, 0,
    'a rolled-back 002 left the tutor seed behind');

  // And the added columns rolled back with it, which is what makes a later
  // retry of 002 (once the operator clears the collision) possible at all.
  const cols = db.prepare(`PRAGMA table_info(accounts)`).all().map(c => c.name);
  assert.ok(!cols.includes('email'), 'the email column survived a rolled-back migration');
  assert.ok(!cols.includes('legacy_code'));
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

test('003 allows a triple lesson and a void status', async () => {
  const db = await freshDb();
  migrate(db);

  db.exec(`
    INSERT INTO accounts (name, phone, credential, is_self, created_at)
      VALUES ('משפחה', NULL, 'x', 0, '2026-09-01T00:00:00Z');
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
      VALUES ('kid', 'ילד', '🎓', 1, 0, NULL, 'x', '2026-09-01T00:00:00Z');
  `);

  const insert = (kind, status) => db.prepare(`
    INSERT INTO payments (account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
    VALUES (1, 1, NULL, '2026-09-01', ?, 30000, ?, NULL)
  `).run(kind, status);

  // The whole reason for this migration: a 135-minute lesson was
  // unrecordable, and a cancelled lesson had no way to stop being a debt.
  assert.doesNotThrow(() => insert('triple', 'owed'));
  assert.doesNotThrow(() => insert('double', 'void'));

  assert.throws(() => insert('quadruple', 'owed'), /CHECK|constraint/i);
  assert.throws(() => insert('single', 'refunded'), /CHECK|constraint/i);
});

/** Brings a fresh database up to a chosen version WITHOUT running the rest
 *  of the registry — the same statements and the same schema_version stamps
 *  the runner writes. This exists so a migration can be tested against the
 *  schema it will actually meet in production, rather than against one its
 *  own successor has already rebuilt. */
function migrateUpTo(db, version) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const m of MIGRATIONS.filter(m => m.version <= version).sort((a, b) => a.version - b.version)) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`)
      .run(m.version, new Date().toISOString());
  }
}

test('003 preserves existing payment rows exactly', async () => {
  const db = await freshDb();

  // Stop at 002 deliberately. Calling migrate() here would apply 003 too,
  // and any row inserted afterwards would land in the ALREADY-rebuilt
  // table — so the INSERT ... SELECT copy, the one statement on this branch
  // that touches the tutor's real money, would never run against a row at
  // all. This is the production shape: a database carrying 001-era payments
  // that 003 is about to rebuild underneath.
  migrateUpTo(db, 2);

  db.exec(`
    INSERT INTO accounts (name, phone, credential, is_self, created_at)
      VALUES ('משפחה', NULL, 'x', 0, '2026-09-01T00:00:00Z');
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
      VALUES ('kid', 'ילד', '🎓', 1, 0, NULL, 'x', '2026-09-01T00:00:00Z');
    INSERT INTO payments (account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
      VALUES (1, 1, NULL, '2026-08-12', 'double', 21500, 'paid', 'bit');
  `);
  const before = db.prepare(`SELECT * FROM payments`).get();

  // Now 003 runs, and its INSERT ... SELECT has to carry that row across.
  migrate(db);
  assert.equal(db.prepare(`SELECT MAX(version) AS v FROM schema_version`).get().v, LATEST);

  const rows = db.prepare(`SELECT * FROM payments`).all();
  assert.equal(rows.length, 1, 'the rebuild lost or duplicated a payment row');

  // Column by column, not a spot check: the copy lists its columns
  // positionally, so a mismatched list would shift every value one place
  // left and still leave a plausible-looking row behind.
  assert.deepEqual(rows[0], before, 'a value changed across the table rebuild');
  assert.equal(rows[0].id, before.id, 'the id must survive — charges point at it');
  assert.equal(rows[0].amount_agorot, 21500);
  assert.equal(rows[0].kind, 'double');
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].note, 'bit');
  assert.equal(rows[0].student_id, 1);
  assert.equal(rows[0].account_id, 1);
  assert.equal(rows[0].date, '2026-08-12');
  assert.equal(rows[0].booking_id, null);

  // And re-running the whole registry must not disturb what 003 moved.
  migrate(db);
  assert.deepEqual(db.prepare(`SELECT * FROM payments`).all(), rows);
});

function versions(db) {
  return db.prepare(`SELECT version FROM schema_version ORDER BY version`).all().map(r => r.version);
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

/** True once PR #58's migration 030 is in this tree. The merge-order tests
 *  below do not assume either answer: they build the "before 30" registry
 *  by filtering, and they expect `heard_from_detail` only when that
 *  version is actually registered. */
const has30 = () => MIGRATIONS.some(m => m.version === 30);

test('migration versions are unique and game_filler is 31', () => {
  const nums = MIGRATIONS.map(m => m.version);
  assert.equal(new Set(nums).size, nums.length);
  const filler = MIGRATIONS.find(m => m.name === '031_game_filler');
  assert.equal(filler.version, 31);
  assert.doesNotMatch(filler.sql, /bookings_v2|marketing_events|heard_from/);
});

test('a duplicated version is refused before any statement runs', async () => {
  const db = await freshDb();
  const dup = { version: 31, name: '031_other', sql: 'CREATE TABLE should_not_exist (id INTEGER);' };
  assert.throws(
    () => migrate(db, [...MIGRATIONS, dup]),
    /migration version 31 is registered twice \(031_game_filler and 031_other\)/,
  );
  assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'should_not_exist'`).get(), undefined);
  assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'schema_version'`).get(), undefined);
});

test('version 31 applies when 30 is absent, and a later 30 still applies', async () => {
  const db = await freshDb();
  // This PR merged first. Filtering is what makes the same setup true
  // after 030 has landed in MIGRATIONS: the stand-in copy of that
  // migration is not re-added here, so the version cannot be registered twice.
  const before30 = MIGRATIONS.filter(m => m.version !== 30);
  migrate(db, before30);
  assert.equal(versions(db).includes(30), false);
  assert.equal(versions(db).includes(31), true);
  assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM game_filler`).get().c > 0);
  assert.equal(hasColumn(db, 'bookings_v2', 'heard_from_detail'), false);

  // The shipped list, reversed on purpose: pending() sorts by version,
  // not by array order. When 030 is registered this fills the gap under
  // an already-stamped 31. When it is not, nothing is pending.
  const shipped = [...MIGRATIONS].reverse();
  migrate(db, shipped);
  assert.equal(versions(db).includes(30), has30());
  assert.equal(versions(db).includes(31), true);
  assert.equal(hasColumn(db, 'bookings_v2', 'heard_from_detail'), has30());
  const rows = db.prepare(`SELECT COUNT(*) AS c FROM game_filler`).get().c;
  migrate(db, shipped);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM game_filler`).get().c, rows);
});

test('version 31 still applies when every lower version is already recorded', async () => {
  const db = await freshDb();
  // PR #58 merged first, once 030 is in the registry: 30 is stamped and
  // 31 is not. Before that merge the same filter is every version except 31.
  migrate(db, MIGRATIONS.filter(m => m.version !== 31));
  assert.equal(versions(db).includes(30), has30());
  assert.equal(versions(db).includes(31), false);
  assert.equal(hasColumn(db, 'bookings_v2', 'heard_from_detail'), has30());
  assert.equal(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'game_filler'`).get(), undefined);

  migrate(db, [...MIGRATIONS].reverse());
  assert.equal(versions(db).includes(31), true);
  assert.ok(db.prepare(`SELECT COUNT(*) AS c FROM game_filler`).get().c > 0);
  assert.equal(hasColumn(db, 'bookings_v2', 'heard_from_detail'), has30());
});

test('003 leaves the foreign keys biting after the table rebuild', async () => {
  const db = await freshDb();
  db.exec(`PRAGMA foreign_keys = ON`);
  migrate(db);

  // The rebuild drops and renames a table while foreign_keys is on, against
  // SQLite's documented procedure. It is safe only because nothing
  // references payments — this asserts the table's OWN keys survived.
  assert.throws(() => db.prepare(`
    INSERT INTO payments (account_id, student_id, booking_id, date, kind, amount_agorot, status, note)
    VALUES (999, 999, NULL, '2026-09-01', 'single', 12000, 'owed', NULL)
  `).run(), /FOREIGN KEY|constraint/i);
});
