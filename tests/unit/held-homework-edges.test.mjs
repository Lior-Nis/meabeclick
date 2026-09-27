/**
 * Two edges of held homework, deferred from #127's final review.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'held-edges-'));
const { heldUntilFor } = await import('../../src/lib/server/lesson/queue.ts');
const { israelDay } = await import('../../src/lib/dates.ts');

const H = 24 * 3600_000;
const iso = (t) => new Date(t).toISOString();

test('a sane end holds until a day after it', () => {
  const start = '2027-03-15T10:00:00+02:00', end = '2027-03-15T11:30:00+02:00';
  assert.equal(heldUntilFor(end, start), iso(new Date(end).getTime() + H));
});

test('an end that is not after the start, or absurdly far after it, falls back to the start plus the longest plan', () => {
  const start = '2027-03-15T10:00:00+02:00';
  const fallback = iso(new Date(start).getTime() + 135 * 60_000 + H);
  assert.equal(heldUntilFor('2100-01-01T00:00:00Z', start), fallback, 'a far-future end must not hide homework for decades');
  assert.equal(heldUntilFor('2027-03-15T09:00:00+02:00', start), fallback);
  assert.equal(heldUntilFor('garbage', start), fallback);
});

test('with neither usable, nothing is held', () => {
  assert.equal(heldUntilFor(undefined, undefined), null);
  assert.equal(heldUntilFor('x', 'y'), null);
});

test('the tutor sees the release day in Israel, not in UTC', () => {
  // 22:30Z on 15 March is 00:30 on the 16th in Israel (+02:00).
  assert.equal(israelDay('2027-03-15T22:30:00.000Z'), '2027-03-16');
  assert.equal(israelDay('2027-07-15T20:59:00.000Z'), '2027-07-15'); // 23:59 +03:00
  const dash = readFileSync(join(process.cwd(), 'src/routes/app/dashboard/+page.svelte'), 'utf8');
  assert.match(dash, /formatDate\(israelDay\(hw\.heldUntil\)\)/);
  assert.doesNotMatch(dash, /hw\.heldUntil\.slice\(0, 10\)/);
});
