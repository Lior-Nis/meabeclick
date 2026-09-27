/**
 * The warning ceiling's own logic.
 *
 * scripts/check-warnings.mjs exists because `npm run check` ignored
 * warnings, so the count drifted (34, then 35) and each new one landed in a
 * pile nobody read. That pile turned out to contain a real bug — the
 * nineteen state_referenced_locally warnings were correctly reporting that
 * every game template captured its data prop once, which let a child open a
 * second game and play the first (#79).
 *
 * The parsing and the verdict are separated from running svelte-check so
 * they can be tested without a 30-second type-check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseSummary, verdict } = await import('../../scripts/check-warnings.mjs');

const line = (errors, warnings) =>
  `1790004428540 COMPLETED 496 FILES ${errors} ERRORS ${warnings} WARNINGS 15 FILES_WITH_PROBLEMS`;

test('reads the summary line svelte-check actually prints', () => {
  assert.deepEqual(parseSummary(line(0, 22)), { files: 496, errors: 0, warnings: 22 });
});

test('reads the human summary too, which is what CI actually printed', () => {
  // The first version of this script only knew the machine line. Locally
  // svelte-check emitted that; the same command on the CI runner emitted
  // the human one, and the gate failed on its own output. It failed closed,
  // which was right — but it should not have had to.
  const humanLine = 'svelte-check found 0 errors and 22 warnings in 15 files';
  assert.deepEqual(parseSummary(humanLine), { files: 15, errors: 0, warnings: 22 });
  assert.equal(verdict(parseSummary(humanLine), 22).ok, true);
});

test('the human form is read with errors too, not just a clean run', () => {
  assert.deepEqual(
    parseSummary('svelte-check found 3 errors and 1 warning in 2 files'),
    { files: 2, errors: 3, warnings: 1 },
  );
});

test('an unrecognised output fails rather than passing by default', () => {
  // If svelte-check changes its format, the ceiling must not silently
  // become "no ceiling" — that is the failure mode this whole file is
  // about.
  assert.equal(parseSummary('something else entirely'), null);
  assert.equal(verdict(null).ok, false);
});

test('errors still fail, as they always did', () => {
  const v = verdict(parseSummary(line(3, 0)), 22);
  assert.equal(v.ok, false);
  assert.match(v.reason, /3 type\/template error/);
});

test('one warning over the baseline fails, and says how to resolve it', () => {
  const v = verdict(parseSummary(line(0, 23)), 22);
  assert.equal(v.ok, false);
  assert.match(v.reason, /23 warnings/);
  // The message has to offer both ways out, or the next person just raises
  // the number without thinking about it.
  assert.match(v.reason, /Fix the new one/);
  assert.match(v.reason, /raise BASELINE/);
});

test('at the baseline passes', () => {
  assert.equal(verdict(parseSummary(line(0, 22)), 22).ok, true);
});

test('under the baseline passes and asks for the floor to be lowered', () => {
  const v = verdict(parseSummary(line(0, 18)), 22);
  assert.equal(v.ok, true);
  // Otherwise the ceiling only ever ratchets one way and slack accumulates
  // as room for the next unread warning.
  assert.match(v.reason, /lower BASELINE to 18/);
});
