/**
 * Homework held until the lesson has happened.
 *
 * Spec: docs/superpowers/specs/2026-09-25-homework-from-what-was-taught-design.md
 * (D2, D6). Booking-time homework is written with `held_until`; families
 * never see a held row, and a row becomes visible at `held_until` by
 * itself — the fallback needs no job to run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'hw-held-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const L = await import('../../src/lib/server/lessons.ts');

let seq = 0;
function student() {
  seq += 1;
  const a = E.createAccount({ name: `f${seq}`, phone: null, credential: 'x' });
  return E.createStudent({ code: `held${seq}`, name: `s${seq}`, accountId: a.id, credential: 'x' });
}
const LATER = '2099-01-01T00:00:00.000Z';
const tasks = (s, opts) => L.homeworkForStudent(s.id, opts).map(h => h.task);

test('a held task is invisible to the family and visible to the tutor', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'held', bookingId: 7, heldUntil: LATER });
  L.addHomework({ studentId: s.id, task: 'plain' });
  assert.deepEqual(tasks(s), ['plain']);
  assert.deepEqual(tasks(s, { includeHeld: true }).sort(), ['held', 'plain']);
});

test('a held task shows up by itself once its time has come', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'held', bookingId: 8, heldUntil: '2027-01-02T00:00:00.000Z' });
  assert.deepEqual(tasks(s, { now: '2027-01-01T23:59:59.000Z' }), []);
  assert.deepEqual(tasks(s, { now: '2027-01-02T00:00:00.000Z' }), ['held']);
});

test('only rows still held count as held for a booking', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'a', bookingId: 9, heldUntil: '2027-01-02T00:00:00.000Z' });
  assert.equal(L.heldHomeworkForBooking(9, '2027-01-01T00:00:00.000Z').length, 1);
  assert.equal(L.heldHomeworkForBooking(9, '2027-01-03T00:00:00.000Z').length, 0);
});

test('releasing makes a booking\'s held rows visible now', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'a', bookingId: 10, heldUntil: LATER });
  L.addHomework({ studentId: s.id, task: 'other lesson', bookingId: 11, heldUntil: LATER });
  assert.equal(L.releaseHeld(10), 1);
  assert.deepEqual(tasks(s), ['a']);
});

test('replacing swaps the held rows for visible, skill-linked ones', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'planned', bookingId: 12, heldUntil: LATER });
  L.replaceHeld(12, s.id, [{ task: 'taught 1', nodeId: null }, { task: 'taught 2', nodeId: null }]);
  assert.deepEqual(tasks(s, { includeHeld: true }).sort(), ['taught 1', 'taught 2']);
  assert.ok(L.homeworkForStudent(s.id).every(h => h.booking_id === 12 && h.held_until === null));
});

test('a replace that fails half way leaves the held rows exactly as they were', () => {
  const s = student();
  L.addHomework({ studentId: s.id, task: 'planned', bookingId: 13, heldUntil: LATER });
  // node 999999 does not exist: the FK on homework.node_id refuses it.
  assert.throws(() => L.replaceHeld(13, s.id, [
    { task: 'ok', nodeId: null }, { task: 'bad', nodeId: 999999 },
  ]));
  assert.deepEqual(tasks(s, { includeHeld: true }), ['planned']);
  assert.equal(L.heldHomeworkForBooking(13).length, 1);
});
