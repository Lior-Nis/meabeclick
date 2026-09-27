import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'res-union-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const D = await import('../../src/lib/server/db.ts');
const R = await import('../../src/lib/server/results.ts');

const acct = E.createAccount({ name: 'משפחה', credential: 'x' });
const noga = E.createStudent({ code: 'noga', name: 'נוגה', accountId: acct.id, credential: 'p' });

test('a results_v2 play appears under the student display name', () => {
  R.writeResult({ studentId: noga.id, dataId: 'v2-quiz', template: 'quiz', score: 9, total: 10 });

  const all = D.readResults();
  assert.ok(all['נוגה'], 'expected a summary keyed by the display name');
  assert.equal(all['נוגה'].plays, 1);
  assert.equal(all['נוגה'].score, 9);
});

test('an unattributable legacy play still reaches the tutor', () => {
  // Written straight to the legacy table, as the live endpoint does when a
  // name cannot be resolved. Nothing may become invisible.
  D.writeResult({ student: 'אור', dataId: 'legacy-quiz', template: 'quiz', score: 4, total: 10 });

  const all = D.readResults();
  assert.ok(all['אור'], 'an unresolvable legacy play must still be visible');
  assert.equal(all['אור'].plays, 1);
  assert.equal(all['אור'].score, 4);
});

test('a student with plays in both tables is summarised once, counting both', () => {
  const dan = E.createStudent({ code: 'dan', name: 'דן', accountId: acct.id, credential: 'p' });
  R.writeResult({ studentId: dan.id, dataId: 'both-a', template: 'quiz', score: 5, total: 10 });
  D.writeResult({ student: 'דן', dataId: 'both-b', template: 'quiz', score: 6, total: 10 });

  const all = D.readResults();
  assert.equal(all['דן'].plays, 2, 'one merged history, not two entries');
  assert.equal(all['דן'].score, 11);
});
