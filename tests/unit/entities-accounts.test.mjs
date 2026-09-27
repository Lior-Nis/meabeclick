import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'ent-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');

test('defaultTeacher returns the lowest-id active teacher', () => {
  // Migration 002 seeds the two real tutors, so this table is never empty by
  // the time any caller sees it. That is the state to assert against — the
  // seed is what makes enrollments able to carry a real teacher_id at all.
  const seeded = E.listTeachers();
  assert.ok(seeded.length >= 2, `expected the seeded tutors, got ${seeded.length}`);

  const lowest = seeded[0];
  assert.equal(E.defaultTeacher().id, lowest.id);
  assert.equal(E.defaultTeacher().name, 'ניקול');

  // A teacher added afterwards must not displace one that already existed.
  E.createTeacher({ name: 'ניקה', phone: null });
  assert.equal(E.defaultTeacher().id, lowest.id);
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
