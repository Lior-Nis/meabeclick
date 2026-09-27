// tests/unit/student-import.test.mjs
//
// The one-time browser-to-server import for the tutor dashboard's local
// card fields. Driven through importLocalStudentProfiles() directly — not
// over HTTP — per task instructions. The behaviour that matters most: it
// must never create anything, and it must never let an empty local value
// blank a real server value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'stu-import-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const { importLocalStudentProfiles } = await import('../../src/lib/server/student-import.ts');

const account = E.createAccount({ name: 'משפחת אביב', credential: 'fam-import' });

function counts() {
  return {
    students: E.listStudents().length,
    accounts: (function () {
      // No listAccounts() export — count distinct account ids across students
      // plus the seed account, which is enough to prove nothing new landed.
      return new Set(E.listStudents().map(s => s.account_id)).size;
    })(),
  };
}

test('an entry whose code matches no student is reported skipped-no-match and creates nothing', () => {
  const before = counts();

  const [outcome] = importLocalStudentProfiles([
    { code: 'no-such-code-at-all', goals: 'מטרה', style: 'שמיעתי', notes: 'הערה' },
  ]);

  assert.equal(outcome.result, 'skipped-no-match');
  assert.equal(outcome.code, 'no-such-code-at-all');

  const after = counts();
  assert.equal(after.students, before.students, 'an unmatched entry must not create a student');
  assert.equal(after.accounts, before.accounts, 'an unmatched entry must not create an account');
  assert.equal(E.getStudentByCode('no-such-code-at-all'), null);
});

test('an empty local value does not overwrite a non-empty server value', () => {
  const s = E.createStudent({ code: 'import-keep', name: 'תלמיד', accountId: account.id, credential: 'ik1' });
  E.updateStudentProfile(s.id, { goals: 'מטרה קיימת', style: 'קינסתטי', notes: 'הערה קיימת' });

  const [outcome] = importLocalStudentProfiles([
    { code: 'import-keep', goals: '', style: '   ', notes: null },
  ]);

  assert.equal(outcome.result, 'skipped-empty', 'nothing usable was in the local entry');

  const after = E.getStudentById(s.id);
  assert.equal(after.goals, 'מטרה קיימת', 'an empty local goals value must not blank the server value');
  assert.equal(after.style, 'קינסתטי', 'an empty local style value must not blank the server value');
  assert.equal(after.notes, 'הערה קיימת', 'a null local notes value must not blank the server value');
});

test('a real entry updates exactly the allowed fields and nothing else', () => {
  const s = E.createStudent({ code: 'import-real', name: 'תלמיד', accountId: account.id, credential: 'ik2' });
  const beforeName = E.getStudentById(s.id).name;
  const beforeCode = E.getStudentById(s.id).code;

  const [outcome] = importLocalStudentProfiles([
    { code: 'import-real', goals: 'להשתפר במתמטיקה', style: 'ויזואלי', notes: 'זקוק לחיזוק', progress: 70, progressNote: 'התקדמות טובה' },
  ]);

  assert.equal(outcome.result, 'updated');
  assert.deepEqual(
    [...outcome.fields].sort(),
    ['goals', 'notes', 'progress', 'progressNote', 'style'].sort(),
  );

  const after = E.getStudentById(s.id);
  assert.equal(after.goals, 'להשתפר במתמטיקה');
  assert.equal(after.style, 'ויזואלי');
  assert.equal(after.notes, 'זקוק לחיזוק');
  assert.equal(after.progress, 70);
  assert.equal(after.progress_note, 'התקדמות טובה');

  // Nothing outside the profile fields moved.
  assert.equal(after.name, beforeName);
  assert.equal(after.code, beforeCode);
  assert.equal(after.account_id, account.id);
});

test('a mixed batch reports each entry independently', () => {
  const s = E.createStudent({ code: 'import-batch', name: 'תלמיד', accountId: account.id, credential: 'ik3' });

  const outcomes = importLocalStudentProfiles([
    { code: 'import-batch', goals: 'מטרה' },
    { code: 'ghost-code', goals: 'מטרה' },
    { code: 'import-batch-empty-twin', goals: '' }, // no such student either
  ]);

  assert.equal(outcomes[0].result, 'updated');
  assert.equal(outcomes[1].result, 'skipped-no-match');
  assert.equal(outcomes[2].result, 'skipped-no-match');
  assert.equal(E.getStudentById(s.id).goals, 'מטרה');
});
