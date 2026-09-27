// tests/unit/student-profile.test.mjs
//
// Migration 010 gives goals/style/notes a server home, and
// updateStudentProfile() is the one writer for those plus progress/
// progressNote. The important property: a partial update must not blank
// the fields it was not given — that used to be true only of localStorage,
// which never had "some fields" writes at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../../src/lib/server/migrations/index.ts';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'stu-profile-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');

const account = E.createAccount({ name: 'משפחת כהן', credential: 'fam-profile' });

test('migration 010 adds goals/style/notes and existing rows survive with NULLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mig010-'));
  const db = new DatabaseSync(join(dir, 'test.db'));

  // Seed a student BEFORE running migration 010 by stopping the registry one
  // version short of it, the same technique migrations.test.mjs uses for 003.
  const { MIGRATIONS } = await import('../../src/lib/server/migrations/list.ts');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  for (const m of MIGRATIONS.filter(m => m.version < 10).sort((a, b) => a.version - b.version)) {
    db.exec(m.sql);
    db.prepare(`INSERT INTO schema_version (version, applied_at) VALUES (?, ?)`)
      .run(m.version, new Date().toISOString());
  }

  db.exec(`
    INSERT INTO accounts (name, phone, credential, is_self, created_at)
      VALUES ('משפחה', NULL, 'x', 0, '2026-09-01T00:00:00Z');
    INSERT INTO students_v2 (code, name, emoji, account_id, progress, progress_note, credential, created_at)
      VALUES ('pre-mig', 'קדם', '🎓', 1, 40, 'note', 'x', '2026-09-01T00:00:00Z');
  `);

  migrate(db); // brings it up to (and including) 010

  const cols = db.prepare(`PRAGMA table_info(students_v2)`).all().map(c => c.name);
  assert.ok(cols.includes('goals'), `expected a goals column, got ${cols.join(', ')}`);
  assert.ok(cols.includes('style'));
  assert.ok(cols.includes('notes'));

  const row = db.prepare(`SELECT * FROM students_v2 WHERE code = 'pre-mig'`).get();
  assert.equal(row.goals, null, 'a pre-existing row should get NULL, not vanish or error');
  assert.equal(row.style, null);
  assert.equal(row.notes, null);
  // And the row's older data survived the migration untouched.
  assert.equal(row.name, 'קדם');
  assert.equal(row.progress, 40);
  assert.equal(row.progress_note, 'note');
});

test('a fresh student has goals/style/notes as null and they round-trip through StudentRow', () => {
  const s = E.createStudent({ code: 'profile-fresh', name: 'תלמיד', accountId: account.id, credential: 'p1' });
  assert.equal(s.goals, null);
  assert.equal(s.style, null);
  assert.equal(s.notes, null);
});

test('updateStudentProfile updates only the supplied keys — a partial update leaves the rest intact', () => {
  const s = E.createStudent({ code: 'profile-partial', name: 'תלמיד', accountId: account.id, credential: 'p2' });

  E.updateStudentProfile(s.id, { goals: 'להגיע לבגרות', style: 'ויזואלי', notes: 'אוהב משחקים' });
  const afterFirst = E.getStudentById(s.id);
  assert.equal(afterFirst.goals, 'להגיע לבגרות');
  assert.equal(afterFirst.style, 'ויזואלי');
  assert.equal(afterFirst.notes, 'אוהב משחקים');

  // The important assertion: touching only `notes` must not blank goals/style.
  E.updateStudentProfile(s.id, { notes: 'עדכון' });
  const afterSecond = E.getStudentById(s.id);
  assert.equal(afterSecond.goals, 'להגיע לבגרות', 'a partial update blanked a field it was never given');
  assert.equal(afterSecond.style, 'ויזואלי', 'a partial update blanked a field it was never given');
  assert.equal(afterSecond.notes, 'עדכון');
});

test('updateStudentProfile also leaves progress/progress_note alone when not supplied', () => {
  const s = E.createStudent({ code: 'profile-progress-partial', name: 'תלמיד', accountId: account.id, credential: 'p3' });
  E.updateStudentProfile(s.id, { progress: 55, progressNote: 'באמצע הדרך' });

  E.updateStudentProfile(s.id, { goals: 'מטרה חדשה' });
  const after = E.getStudentById(s.id);
  assert.equal(after.progress, 55);
  assert.equal(after.progress_note, 'באמצע הדרך');
  assert.equal(after.goals, 'מטרה חדשה');
});

test('progress clamps below 0 and above 100', () => {
  const s = E.createStudent({ code: 'profile-clamp', name: 'תלמיד', accountId: account.id, credential: 'p4' });

  E.updateStudentProfile(s.id, { progress: -30 });
  assert.equal(E.getStudentById(s.id).progress, 0);

  E.updateStudentProfile(s.id, { progress: 250 });
  assert.equal(E.getStudentById(s.id).progress, 100);

  E.updateStudentProfile(s.id, { progress: 62 });
  assert.equal(E.getStudentById(s.id).progress, 62);
});

test('over-long text is capped at 1000 characters', () => {
  const s = E.createStudent({ code: 'profile-cap', name: 'תלמיד', accountId: account.id, credential: 'p5' });
  const huge = 'א'.repeat(5000);

  E.updateStudentProfile(s.id, { goals: huge, style: huge, notes: huge, progressNote: huge });
  const after = E.getStudentById(s.id);

  assert.equal(after.goals.length, 1000);
  assert.equal(after.style.length, 1000);
  assert.equal(after.notes.length, 1000);
  assert.equal(after.progress_note.length, 1000);
});
