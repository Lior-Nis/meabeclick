import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'plan-schema-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** One account, one student, one enrollment — the rows a plan hangs off. */
function seed(db) {
  db.prepare(
    `INSERT INTO accounts (name, phone, credential, is_self, created_at)
     VALUES ('משפחת כהן', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`
  ).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(
    `INSERT INTO students_v2 (code, name, account_id, credential, created_at)
     VALUES ('yuval', 'יובל', ?, 'x', '2026-01-01T00:00:00.000Z')`
  ).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'yuval'`).get().id;
  db.prepare(
    `INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה יא')`
  ).run(studentId);
  const enrollmentId = db.prepare(`SELECT id FROM enrollments WHERE student_id = ?`).get(studentId).id;
  return { studentId, enrollmentId };
}

function newPlan(db, studentId, enrollmentId) {
  db.prepare(
    `INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, created_at)
     VALUES (?, ?, 'math-5u', 1, 'בגרות 5 יח״ל', '2026-01-02T00:00:00.000Z')`
  ).run(studentId, enrollmentId);
  return db.prepare(`SELECT id FROM plans ORDER BY id DESC LIMIT 1`).get().id;
}

test('the migration creates the four plan tables', async () => {
  const db = await freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['plans', 'plan_nodes', 'plan_prereqs', 'plan_events']) {
    assert.ok(tables.includes(t), `expected table ${t}`);
  }
});

test('one enrollment can hold only one plan', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  newPlan(db, studentId, enrollmentId);
  assert.throws(() => newPlan(db, studentId, enrollmentId), /UNIQUE/i);
});

test('a node key is unique inside its plan, and free across plans', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  const planId = newPlan(db, studentId, enrollmentId);
  const insert = (plan, key) => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
     VALUES (?, ?, NULL, 'topic', 'חקירת פונקציה', 0)`
  ).run(plan, key);

  insert(planId, 'calc');
  assert.throws(() => insert(planId, 'calc'), /UNIQUE/i);

  // A second student's plan may use the same template keys.
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'פיזיקה', NULL)`).run(studentId);
  const other = db.prepare(`SELECT id FROM enrollments WHERE subject = 'פיזיקה'`).get().id;
  const otherPlan = newPlan(db, studentId, other);
  insert(otherPlan, 'calc');
});

test('the constrained columns reject values outside their vocabulary', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  const planId = newPlan(db, studentId, enrollmentId);

  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position) VALUES (?, 'a', 'chapter', 'x', 0)`
  ).run(planId), /CHECK/i, 'kind must be topic|branch|skill');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position, visibility)
     VALUES (?, 'b', 'skill', 'x', 0, 'archived')`
  ).run(planId), /CHECK/i, 'visibility must be active|paused|hidden');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, status, at) VALUES (?, 'status', 'mastered', '2026-01-03')`
  ).run(planId), /CHECK/i, 'status must be one of the six');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, at) VALUES (?, 'deleted', '2026-01-03')`
  ).run(planId), /CHECK/i, 'type must be a known event type');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, status, evidence, at)
     VALUES (?, 'status', 'guided', 'vibes', '2026-01-03')`
  ).run(planId), /CHECK/i, 'evidence must be a known kind');
});

test('a node cannot belong to a plan that does not exist', async () => {
  const db = await freshDb();
  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position) VALUES (9999, 'a', 'topic', 'x', 0)`
  ).run(), /FOREIGN KEY/i);
});
