// tests/unit/enroll-tutor.test.mjs
//
// Enrolment takes the tutor /api/book chose, and the family's page names them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'enroll-tutor-'));
process.env.DB_PATH = join(dir, 'results.db');
process.env.PORTAL_DIR = join(dir, 'portal');
const E = await import('../../src/lib/server/entities.ts');
const { enrollFromBooking } = await import('../../src/lib/server/enroll.ts');
const [nikol, lior] = E.listTeachers();
const booking = (over) => ({ name: 'דנה', email: 'e@example.com', subject: 'מתמטיקה', level: 'ח', start: '2030-01-01T08:00:00Z', ...over });

test('a new family is enrolled with the tutor the booking was given, and their page names them', () => {
  const r = enrollFromBooking(booking({ email: 'one@example.com' }), lior);
  assert.equal(r.enrollment.teacher_id, lior.id);
  assert.equal(r.teacherName, 'ליאור');
  assert.equal(JSON.parse(readFileSync(join(dir, 'portal', `${r.student.code}.json`), 'utf8')).tutor, 'ליאור');
});

test('without one, the default tutor, as before', () => {
  assert.equal(enrollFromBooking(booking({ email: 'two@example.com' })).enrollment.teacher_id, nikol.id);
});

test("booking again with another tutor keeps the student's own", () => {
  enrollFromBooking(booking({ email: 'three@example.com' }), lior);
  assert.equal(enrollFromBooking(booking({ email: 'three@example.com' }), nikol).enrollment.teacher_id, lior.id);
});
