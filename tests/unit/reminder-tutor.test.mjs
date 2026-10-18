// tests/unit/reminder-tutor.test.mjs
//
// A reminder carries the room of the tutor the lesson was booked with —
// moving the student since does not move a booked lesson (spec D6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'reminder-tutor-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/reminders.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const [nikol, lior] = E.listTeachers();
const NIKOL_ROOM = 'https://meet.google.com/aaa-bbbb-ccc';
const LIOR_ROOM = 'https://meet.google.com/ddd-eeee-fff';
handle().prepare(`UPDATE teachers SET meet_url = ? WHERE id = ?`).run(NIKOL_ROOM, nikol.id);
handle().prepare(`UPDATE teachers SET meet_url = ? WHERE id = ?`).run(LIOR_ROOM, lior.id);

test("the reminder carries the room of the lesson's tutor, not the student's tutor today", () => {
  const NOW = '2031-03-01T09:00:00.000Z';
  const start = new Date(Date.parse(NOW) + 20 * 3600e3).toISOString();
  const account = E.createAccount({ name: 'משפחה', credential: 'x', email: 'r@example.com' });
  const s = E.createStudent({ code: 'rt1', name: 'דנה', accountId: account.id, credential: 'x' });
  const enr = E.upsertEnrollment({ studentId: s.id, subject: 'מתמטיקה', teacherId: nikol.id });
  const id = E.reserveBooking({ studentId: s.id, enrollmentId: enr.id, start, end: start, durationMin: 45, mode: 'online', teacherId: nikol.id });
  E.setEnrollmentTeacher(enr.id, lior.id);
  assert.equal(R.pendingReminders(NOW).find(b => b.id === id).meetUrl, NIKOL_ROOM);
});
