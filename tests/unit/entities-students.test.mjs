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

test('every student_id foreign key is enforced, not merely declared', async () => {
  const { handle } = await import('../../src/lib/server/db.ts');
  const GHOST = 999999;
  const inserts = [
    ['enrollments', `INSERT INTO enrollments (student_id, subject) VALUES (?, 'x')`],
    ['lessons_v2',  `INSERT INTO lessons_v2 (student_id, slug, status, created_at) VALUES (?, 'x', 'ready', '2026-01-01')`],
    ['homework',    `INSERT INTO homework (student_id, task, assigned_at) VALUES (?, 'x', '2026-01-01')`],
    ['results_v2',  `INSERT INTO results_v2 (student_id, at) VALUES (?, '2026-01-01')`],
    ['bookings_v2', `INSERT INTO bookings_v2 (student_id, start, end, at) VALUES (?, 'a', 'b', 'c')`],
  ];
  for (const [table, stmt] of inserts) {
    assert.throws(
      () => handle().prepare(stmt).run(GHOST),
      /FOREIGN KEY/i,
      `${table}.student_id accepted a nonexistent student`,
    );
  }
});
