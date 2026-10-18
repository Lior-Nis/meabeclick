// tests/unit/per-tutor-migration.test.mjs
//
// Migration 029: each lesson belongs to a tutor
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATIONS } from '../../src/lib/server/migrations/list.ts';

/** A fresh database brought up to `version`, the schema 029 meets in production. */
async function dbAt(version) {
  const db = new DatabaseSync(join(await mkdtemp(join(tmpdir(), 'm029-')), 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  for (const m of MIGRATIONS.filter(m => m.version <= version).sort((a, b) => a.version - b.version)) db.exec(m.sql);
  return db;
}
const m029 = () => MIGRATIONS.find(m => m.version === 29);

test("029 gives each booking its enrollment's tutor, or the default tutor", async () => {
  const db = await dbAt(28);
  const [nikol, lior] = db.prepare(`SELECT id FROM teachers ORDER BY id`).all().map(r => r.id);
  db.prepare(`INSERT INTO accounts (name, phone, credential, is_self, created_at) VALUES ('משפחה', NULL, 'x', 0, '2026-01-01')`).run();
  db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at) VALUES ('s1', 'דנה', 1, 'x', '2026-01-01')`).run();
  db.prepare(`INSERT INTO enrollments (student_id, subject, level, teacher_id) VALUES (1, 'מתמטיקה', 'ח', ?)`).run(lior);
  const booking = db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
                              VALUES (1, ?, ?, ?, 45, '2026-01-01', 'confirmed')`);
  booking.run(1, '2027-01-01T10:00:00Z', '2027-01-01T10:45:00Z');
  booking.run(null, '2027-01-02T10:00:00Z', '2027-01-02T10:45:00Z');
  db.prepare(`INSERT INTO pending_bookings (account_id, body, start, "end", at, expires_at)
              VALUES (1, '{}', '2027-01-03T10:00:00Z', '2027-01-03T10:45:00Z', '2026-01-01', '2027-01-03T10:00:00Z')`).run();

  db.exec(m029().sql);

  assert.deepEqual(db.prepare(`SELECT teacher_id FROM bookings_v2 ORDER BY id`).all().map(r => r.teacher_id), [lior, nikol]);
  assert.equal(db.prepare(`SELECT teacher_id FROM pending_bookings`).get().teacher_id, nikol,
    'every enrollment is Nikol\'s today, so every hold is hers');
});

test('029 leaves every tutor on the default window, with no calendar and no busy address', async () => {
  const db = await dbAt(29);
  for (const t of db.prepare(`SELECT calendar_id, busy_ics, teaching_hours FROM teachers`).all()) {
    assert.deepEqual({ ...t }, { calendar_id: null, busy_ics: null, teaching_hours: null });
  }
});
