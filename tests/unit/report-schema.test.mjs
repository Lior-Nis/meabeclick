import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'report-schema-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** Account → student → enrollment → booking → plan → one skill node. */
function seed(db) {
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('משפחת כהן', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES ('yuval', 'יובל', ?, 'x', '2026-01-01T00:00:00.000Z')`).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'yuval'`).get().id;
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה יא')`).run(studentId);
  const enrollmentId = db.prepare(`SELECT id FROM enrollments WHERE student_id = ?`).get(studentId).id;
  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, ?, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId, enrollmentId);
  const bookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, created_at)
              VALUES (?, ?, 'math-5u', 1, 'בגרות', '2026-05-02T00:00:00.000Z')`).run(studentId, enrollmentId);
  const planId = db.prepare(`SELECT id FROM plans ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(`INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
              VALUES (?, 'calc.rules.power', NULL, 'skill', 'חוקי חזקות', 0)`).run(planId);
  const nodeId = db.prepare(`SELECT id FROM plan_nodes ORDER BY id DESC LIMIT 1`).get().id;
  return { studentId, enrollmentId, bookingId, planId, nodeId };
}

test('migration 005 adds the report tables', async () => {
  const db = await freshDb();
  migrate(db);
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['lesson_reports', 'report_prompts']) assert.ok(tables.includes(t), `expected ${t}`);
});

test('a booking can be reported once', async () => {
  const db = await freshDb();
  migrate(db);
  const { studentId, enrollmentId, bookingId } = seed(db);
  const file = () => db.prepare(
    `INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
     VALUES (?, ?, ?, 'הערה', '2026-06-01T16:00:00.000Z', '2026-06-01T16:00:00.000Z')`
  ).run(bookingId, studentId, enrollmentId);
  file();
  assert.throws(file, /UNIQUE/i, 'a second report for the same lesson must be refused');
});

test('a lesson is prompted at most once', async () => {
  const db = await freshDb();
  migrate(db);
  const { bookingId } = seed(db);
  const mark = () => db.prepare(`INSERT INTO report_prompts (booking_id, sent_at) VALUES (?, '2026-06-01T16:00:00.000Z')`).run(bookingId);
  mark();
  assert.throws(mark, /UNIQUE|PRIMARY/i);
});

test('plan_events accepts the report source and rejects anything else', async () => {
  const db = await freshDb();
  migrate(db);
  const { studentId, enrollmentId, bookingId, planId, nodeId } = seed(db);
  db.prepare(`INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, created_at, updated_at)
              VALUES (?, ?, ?, '2026-06-01T16:00:00.000Z', '2026-06-01T16:00:00.000Z')`).run(bookingId, studentId, enrollmentId);
  const reportId = db.prepare(`SELECT id FROM lesson_reports ORDER BY id DESC LIMIT 1`).get().id;

  db.prepare(`INSERT INTO plan_events (plan_id, node_id, type, status, source, report_id, at)
              VALUES (?, ?, 'status', 'guided', 'report', ?, '2026-06-01T16:00:00.000Z')`).run(planId, nodeId, reportId);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM plan_events WHERE source = 'report'`).get().n, 1);

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, node_id, type, status, source, at)
     VALUES (?, ?, 'status', 'guided', 'robot', '2026-06-01T16:00:00.000Z')`
  ).run(planId, nodeId), /CHECK/i, 'an unknown source must still be rejected');
});

test('the rebuild preserves events written before it', async () => {
  // Apply everything up to 004, write an event, then apply 005 and read it back.
  const db = await freshDb();
  const upTo4 = MIGRATIONS.filter(m => m.version <= 4).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo4) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }
  const { planId, nodeId } = seed(db);
  db.prepare(`INSERT INTO plan_events (plan_id, node_id, type, status, note, evidence, source, at)
              VALUES (?, ?, 'status', 'independent', 'לפני המיגרציה', 'lesson', 'teacher', '2026-05-05T00:00:00.000Z')`)
    .run(planId, nodeId);
  // The rebuild's INSERT ... SELECT preserves rowids by copying `id`
  // explicitly (rather than letting AUTOINCREMENT assign a fresh one), so
  // anything that already refers to this event by id — a UI link, a test
  // fixture, a future report_id — must still resolve after the rebuild.
  const idBefore = db.prepare(`SELECT id FROM plan_events WHERE note = 'לפני המיגרציה'`).get().id;

  migrate(db); // applies 005 only

  const row = db.prepare(`SELECT * FROM plan_events WHERE note = 'לפני המיגרציה'`).get();
  assert.ok(row, 'the pre-existing event survived the rebuild');
  assert.equal(row.id, idBefore, 'the event\'s id is unchanged by the rebuild');
  assert.equal(row.status, 'independent');
  assert.equal(row.evidence, 'lesson');
  assert.equal(row.source, 'teacher');
  assert.equal(row.at, '2026-05-05T00:00:00.000Z');
  assert.equal(row.report_id, null);
});

test('migration 007 preserves existing lesson_reports rows and makes enrollment_id nullable', async () => {
  // Apply everything up to 006, file a report the old (NOT NULL
  // enrollment_id) way, then apply 007 and read it back.
  const db = await freshDb();
  const upTo6 = MIGRATIONS.filter(m => m.version <= 6).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo6) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }
  const { studentId, enrollmentId, bookingId } = seed(db);
  db.prepare(`INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
              VALUES (?, ?, ?, 'לפני המיגרציה', '2026-06-01T16:00:00.000Z', '2026-06-01T16:00:00.000Z')`)
    .run(bookingId, studentId, enrollmentId);
  const idBefore = db.prepare(`SELECT id FROM lesson_reports WHERE note = 'לפני המיגרציה'`).get().id;

  migrate(db); // applies 007 only

  const row = db.prepare(`SELECT * FROM lesson_reports WHERE note = 'לפני המיגרציה'`).get();
  assert.ok(row, 'the pre-existing report survived the rebuild');
  assert.equal(row.id, idBefore, 'the report\'s id is unchanged by the rebuild');
  assert.equal(row.booking_id, bookingId);
  assert.equal(row.student_id, studentId);
  assert.equal(row.enrollment_id, enrollmentId);
  assert.equal(row.created_at, '2026-06-01T16:00:00.000Z');

  // The column that was NOT NULL before this migration must now accept NULL
  // — a second booking with no enrollment at all (migration 006's shape).
  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, NULL, '2026-07-01T14:00:00.000Z', '2026-07-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId);
  const secondBookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;
  assert.doesNotThrow(() => db.prepare(
    `INSERT INTO lesson_reports (booking_id, student_id, enrollment_id, note, created_at, updated_at)
     VALUES (?, ?, NULL, 'הערה בלבד', '2026-07-01T16:00:00.000Z', '2026-07-01T16:00:00.000Z')`
  ).run(secondBookingId, studentId), 'enrollment_id must be nullable after migration 007');

  // lesson_report_notes — the note's own history — exists and takes a row.
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  assert.ok(tables.includes('lesson_report_notes'));
  db.prepare(`INSERT INTO lesson_report_notes (report_id, note, at) VALUES (?, ?, ?)`)
    .run(idBefore, 'לפני המיגרציה', '2026-06-01T16:00:00.000Z');
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS n FROM lesson_report_notes WHERE report_id = ?`).get(idBefore).n,
    1,
  );
});
