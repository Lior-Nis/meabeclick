import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'backfill-booking-enrollment-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

test('backfill: a student with one enrollment has their NULL booking filled', async () => {
  const db = await freshDb();

  // Apply migrations 1-5 manually
  const upTo5 = MIGRATIONS.filter(m => m.version <= 5).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo5) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }

  // Seed: one student, one enrollment, one booking with NULL enrollment_id
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('שם משפחה', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;

  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES ('student1', 'סטודנט אחד', ?, 'x', '2026-01-01T00:00:00.000Z')`).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'student1'`).get().id;

  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה י')`).run(studentId);
  const enrollmentId = db.prepare(`SELECT id FROM enrollments WHERE student_id = ?`).get(studentId).id;

  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, NULL, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId);
  const bookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;

  // Before migration: enrollment_id is NULL
  const beforeBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(beforeBackfill.enrollment_id, null);

  // Run migration 006
  migrate(db);

  // After migration: enrollment_id should be filled
  const afterBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(afterBackfill.enrollment_id, enrollmentId);
});

test('backfill: a student with two enrollments has their NULL booking left alone', async () => {
  const db = await freshDb();

  // Apply migrations 1-5 manually
  const upTo5 = MIGRATIONS.filter(m => m.version <= 5).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo5) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }

  // Seed: one student, TWO enrollments, one booking with NULL enrollment_id
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('שם משפחה', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;

  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES ('student2', 'סטודנט שני', ?, 'x', '2026-01-01T00:00:00.000Z')`).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'student2'`).get().id;

  // Two different enrollments (different subjects)
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה י')`).run(studentId);
  const enrollment1 = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'מתמטיקה'`).get(studentId).id;

  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'אנגלית', 'כיתה י')`).run(studentId);
  const enrollment2 = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'אנגלית'`).get(studentId).id;

  // Booking with NULL enrollment_id
  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, NULL, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId);
  const bookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;

  // Before migration: enrollment_id is NULL
  const beforeBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(beforeBackfill.enrollment_id, null);

  // Run migration 006
  migrate(db);

  // After migration: enrollment_id should STILL be NULL (ambiguous, so left alone)
  const afterBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(afterBackfill.enrollment_id, null);
});

test('backfill: a booking with existing enrollment_id is not touched', async () => {
  const db = await freshDb();

  // Apply migrations 1-5 manually
  const upTo5 = MIGRATIONS.filter(m => m.version <= 5).sort((a, b) => a.version - b.version);
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  for (const m of upTo5) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`).run(m.version, '2026-01-01');
  }

  // Seed: one student, TWO enrollments, one booking already pointing to enrollment 1
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at)
              VALUES ('שם משפחה', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;

  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at)
              VALUES ('student3', 'סטודנט שלישי', ?, 'x', '2026-01-01T00:00:00.000Z')`).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'student3'`).get().id;

  // Two different enrollments
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה י')`).run(studentId);
  const enrollment1 = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'מתמטיקה'`).get(studentId).id;

  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'אנגלית', 'כיתה י')`).run(studentId);
  const enrollment2 = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'אנגלית'`).get(studentId).id;

  // Booking already pointing to enrollment 1
  db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
              VALUES (?, ?, '2026-06-01T14:00:00.000Z', '2026-06-01T15:30:00.000Z', 90, '2026-05-01T00:00:00.000Z', 'confirmed')`)
    .run(studentId, enrollment1);
  const bookingId = db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id;

  // Before migration: enrollment_id is enrollment1
  const beforeBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(beforeBackfill.enrollment_id, enrollment1);

  // Run migration 006
  migrate(db);

  // After migration: enrollment_id should STILL be enrollment1 (unchanged)
  const afterBackfill = db.prepare(`SELECT enrollment_id FROM bookings_v2 WHERE id = ?`).get(bookingId);
  assert.equal(afterBackfill.enrollment_id, enrollment1);
});
