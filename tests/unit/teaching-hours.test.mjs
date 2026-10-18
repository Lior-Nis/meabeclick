// tests/unit/teaching-hours.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeachingHours, DEFAULT_HOURS, minutesOf } from '../../src/lib/teaching-hours.ts';

test("the default week is today's window", () => {
  assert.deepEqual(DEFAULT_HOURS[0], ['08:00', '21:00']);
  assert.deepEqual(DEFAULT_HOURS[4], ['08:00', '21:00']);
  assert.deepEqual(DEFAULT_HOURS[5], ['08:00', '16:00']);
  assert.equal(DEFAULT_HOURS[6], undefined, 'Saturday is off');
});

test('a week with a day off and a short day is accepted as written', () => {
  assert.deepEqual(parseTeachingHours({ 0: ['09:00', '18:00'], 5: ['08:00', '12:30'] }),
    { 0: ['09:00', '18:00'], 5: ['08:00', '12:30'] });
  assert.deepEqual(parseTeachingHours({}), {}, 'a week off is a week');
});

test('Saturday, a bad time, or a day that ends before it starts refuses the whole week', () => {
  for (const bad of [
    { 6: ['08:00', '12:00'] }, { 0: ['8:00', '12:00'] }, { 0: ['12:00', '12:00'] },
    { 0: ['13:00', '12:00'] }, { 0: ['08:00'] }, { 0: ['08:00', '25:00'] }, [], null, 'x',
  ]) assert.equal(parseTeachingHours(bad), null, JSON.stringify(bad));
});

test('minutes from midnight', () => {
  assert.equal(minutesOf('08:30'), 510);
  assert.equal(minutesOf('24:00'), 1440);
});
