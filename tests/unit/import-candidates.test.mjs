// tests/unit/import-candidates.test.mjs
//
// The tutor dashboard's local-import panel builds its review table and its
// POST payload from `computeImportCandidates` / `buildImportPayload`
// (src/lib/import-candidates.ts). Two regressions this guards specifically:
//
//   - Critical 2: progress/progressNote are browser-only exactly like
//     goals/style/notes, but the UI never sent them. A local blob with real
//     progress text must show up in the candidate AND the payload.
//   - Important 3: two roster rows sharing a name must not resolve to
//     either one — that silently cross-writes one child's data onto the
//     other's record. Such an entry must be flagged ambiguous and excluded
//     from the payload entirely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeImportCandidates, buildImportPayload } from '../../src/lib/import-candidates.ts';

test('a local blob with progress and progressNote is detected and carried into the payload', () => {
  const local = [
    { name: 'נועה', goals: '', style: '', notes: '', progress: 63, progressNote: 'מתקדמת יפה בגיאומטריה' },
  ];
  const roster = [{ code: 'noa-1', name: 'נועה' }];

  const candidates = computeImportCandidates(local, roster);
  assert.equal(candidates.length, 1, 'a non-empty progress/progressNote must produce a candidate');
  assert.equal(candidates[0].progress, 63);
  assert.equal(candidates[0].progressNote, 'מתקדמת יפה בגיאומטריה');
  assert.equal(candidates[0].status, 'matched');

  const payload = buildImportPayload(candidates);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].code, 'noa-1');
  assert.equal(payload[0].progress, 63, 'progress must reach the payload');
  assert.equal(payload[0].progressNote, 'מתקדמת יפה בגיאומטריה', 'progressNote must reach the payload');
});

test('a local blob with only goals/style/notes still produces a candidate (no regression)', () => {
  const local = [{ name: 'איתי', goals: 'לסיים 5 יח׳', style: '', notes: '' }];
  const roster = [{ code: 'itai-1', name: 'איתי' }];

  const candidates = computeImportCandidates(local, roster);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].progress, 0);
  assert.equal(candidates[0].progressNote, '');
});

test('a local student with nothing in any of the five fields is not a candidate', () => {
  const local = [{ name: 'דנה', goals: '', style: '', notes: '', progress: 0, progressNote: '' }];
  const roster = [{ code: 'dana-1', name: 'דנה' }];

  assert.deepEqual(computeImportCandidates(local, roster), []);
});

test('two roster rows sharing a name produce an ambiguous, excluded entry', () => {
  const local = [{ name: 'נועם', goals: 'מטרה חשובה', style: '', notes: '' }];
  const roster = [
    { code: 'noam-family-a', name: 'נועם' },
    { code: 'noam-family-b', name: 'נועם' },
  ];

  const candidates = computeImportCandidates(local, roster);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'ambiguous');
  assert.equal(candidates[0].code, null, 'an ambiguous match must not resolve to either code');

  const payload = buildImportPayload(candidates);
  assert.deepEqual(payload, [], 'an ambiguous candidate must never be sent');
});

test('an unmatched local student is excluded from the payload but still reported', () => {
  const local = [{ name: 'מישהו שלא קיים', goals: 'מטרה', style: '', notes: '' }];
  const candidates = computeImportCandidates(local, []);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].status, 'no-match');
  assert.deepEqual(buildImportPayload(candidates), []);
});
