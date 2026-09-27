import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'results-backfill-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Apply migrations 1..7, leaving 008 as the pending one migrate() will run. */
function applyThrough7(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of MIGRATIONS.filter(m => m.version <= 7).sort((a, b) => a.version - b.version)) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }
}

/** The legacy table, verbatim from src/lib/server/db.ts. */
function createLegacyResults(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS results (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      student  TEXT    NOT NULL,
      at       TEXT    NOT NULL,
      data_id  TEXT,
      template TEXT,
      score    INTEGER,
      total    INTEGER,
      tries    INTEGER,
      stars    INTEGER,
      seconds  INTEGER,
      missed   TEXT
    );
  `);
}

function seedStudent(db, { code, name }) {
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('משפחה', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES (?, ?, ?, 'x', '2026-01-01T00:00:00.000Z')`).run(code, name, accountId);
  return db.prepare(`SELECT id FROM students_v2 WHERE code = ?`).get(code).id;
}

function seedResult(db, student, dataId, at) {
  db.prepare(`INSERT INTO results (student, at, data_id, template, score, total, tries, stars, seconds, missed)
              VALUES (?, ?, ?, 'quiz', 8, 10, 1, 3, 60, '[]')`).run(student, at, dataId);
}

test('backfill: a result under a unique display name moves to results_v2', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  const lizaId = seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'נוגה', 'noga-quiz', '2026-05-01T10:00:00.000Z');

  migrate(db);

  const moved = db.prepare(`SELECT * FROM results_v2`).all();
  assert.equal(moved.length, 1);
  assert.equal(moved[0].student_id, lizaId);
  assert.equal(moved[0].data_id, 'noga-quiz');
  // The original timestamp survives: a play's date is part of the evidence.
  assert.equal(moved[0].at, '2026-05-01T10:00:00.000Z');

  // Moved, not copied — otherwise the union in readResults double-counts it.
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n, 0);
});

test('backfill: a result under a shared display name stays in the legacy table', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'or-a', name: 'אור' });
  seedStudent(db, { code: 'or-b', name: 'אור' });
  seedResult(db, 'אור', 'or-quiz', '2026-05-02T10:00:00.000Z');

  migrate(db);

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
  const left = db.prepare(`SELECT * FROM results`).all();
  assert.equal(left.length, 1);
  assert.equal(left[0].data_id, 'or-quiz');
});

test('backfill: a result under an unknown name stays in the legacy table', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'מישהו אחר', 'ghost-quiz', '2026-05-03T10:00:00.000Z');

  migrate(db);

  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n, 1);
});

test('backfill: a result under a code moves too', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  const lizaId = seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedResult(db, 'noga', 'by-code', '2026-05-04T10:00:00.000Z');

  migrate(db);

  const moved = db.prepare(`SELECT * FROM results_v2`).all();
  assert.equal(moved.length, 1);
  assert.equal(moved[0].student_id, lizaId);
});

test('backfill: the two tables are disjoint and nothing is lost', async () => {
  const db = await freshDb();
  applyThrough7(db);
  createLegacyResults(db);
  seedStudent(db, { code: 'noga', name: 'נוגה' });
  seedStudent(db, { code: 'or-a', name: 'אור' });
  seedStudent(db, { code: 'or-b', name: 'אור' });

  seedResult(db, 'נוגה', 'a', '2026-05-01T00:00:00.000Z');      // resolves
  seedResult(db, 'noga', 'b', '2026-05-02T00:00:00.000Z');      // resolves by code
  seedResult(db, 'אור', 'c', '2026-05-03T00:00:00.000Z');       // ambiguous
  seedResult(db, 'רפאל', 'd', '2026-05-04T00:00:00.000Z');      // unknown
  const seeded = 4;

  migrate(db);

  const inV2 = db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n;
  const inLegacy = db.prepare(`SELECT COUNT(*) AS n FROM results`).get().n;
  // This is the assertion that catches the INSERT and DELETE resolution
  // expressions drifting apart: drift either duplicates rows across both
  // tables or destroys them without landing.
  assert.equal(inV2, 2);
  assert.equal(inLegacy, 2);
  assert.equal(inV2 + inLegacy, seeded);
});

test('migrate succeeds on a database where the legacy results table never existed', async () => {
  const db = await freshDb();
  applyThrough7(db);
  // Deliberately NO createLegacyResults(db). On a fresh deployment migrate()
  // runs inside db.ts's singleton factory BEFORE the db.exec block that
  // creates the legacy table, so a migration reading `results` without
  // creating it first makes the app refuse to boot.
  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM results_v2`).get().n, 0);
});
