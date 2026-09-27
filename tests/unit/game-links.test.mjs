import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'links-')), 'results.db');
process.env.SESSION_SECRET = 'test-secret-for-signing';

const E = await import('../../src/lib/server/entities.ts');
const U = await import('../../src/lib/server/urls.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

const sOf = (url) => new URL(`http://x${url}`).searchParams.get('s');
const tOf = (url) => new URL(`http://x${url}`).searchParams.get('t');

test('a link built for a known student carries the code, not the display name', () => {
  const ref = R.studentRefById(noga.id);
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: ref.code });
  assert.equal(sOf(url), 'noga');
  assert.notEqual(sOf(url), 'נוגה');
});

test('a code-carrying link verifies', () => {
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'noga' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'noga', t: tOf(url) }), true);
});

test('a link already sent under a display name still verifies', () => {
  // Signatures cover whatever pair is in the URL, so links in WhatsApp
  // threads keep working after this change. If this ever fails, every game
  // link a family already has is dead.
  const old = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'נוגה' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'נוגה', t: tOf(old) }), true);
});

test('a code-signed link does not verify against the display name', () => {
  const url = U.gameUrl({ template: 'quiz', dataId: 'd1', student: 'noga' });
  assert.equal(U.verifyGameSignature({ dataId: 'd1', student: 'נוגה', t: tOf(url) }), false);
});
