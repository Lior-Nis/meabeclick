import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-id-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('resolveStudent: a code resolves to that student', () => {
  assert.equal(R.resolveStudent('noga'), noga.id);
});

test('resolveStudent: a name unique across students resolves', () => {
  assert.equal(R.resolveStudent('נוגה'), noga.id);
});

test('resolveStudent: a name shared by two students does not resolve', () => {
  const a = E.createStudent({ code: 'or-a', name: 'אור', accountId: acct.id, credential: 'p' });
  const b = E.createStudent({ code: 'or-b', name: 'אור', accountId: acct.id, credential: 'p' });
  assert.notEqual(a.id, b.id);
  assert.equal(R.resolveStudent('אור'), null);
});

test('resolveStudent: an unknown string does not resolve', () => {
  assert.equal(R.resolveStudent('nobody-at-all'), null);
});

test('resolveStudent: code is tried before name', () => {
  // 'dan' is BOTH one student's code and another student's display name.
  // Code must win, or the wrong child gets the play.
  const byCode = E.createStudent({ code: 'dan', name: 'דניאל', accountId: acct.id, credential: 'p' });
  const byName = E.createStudent({ code: 'dani-2', name: 'dan', accountId: acct.id, credential: 'p' });
  assert.equal(R.resolveStudent('dan'), byCode.id);
  assert.notEqual(R.resolveStudent('dan'), byName.id);
});

test('studentRefById: a known id returns both strings', () => {
  assert.deepEqual(R.studentRefById(noga.id), { code: 'noga', name: 'נוגה' });
});

test('studentRefById: an unknown id returns null', () => {
  assert.equal(R.studentRefById(999999), null);
});

test('resolveStudent and studentRefById round-trip a code', () => {
  assert.equal(studentRefByIdCode('noga'), 'noga');
});

function studentRefByIdCode(code) {
  const id = R.resolveStudent(code);
  return id === null ? null : R.studentRefById(id).code;
}
