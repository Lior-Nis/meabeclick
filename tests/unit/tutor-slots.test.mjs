// tests/unit/tutor-slots.test.mjs
//
// Free slots per tutor, and which tutor takes one hour. Pure: no database,
// no network. Monday 2027-03-15 and Friday 2027-03-19 are UTC+2 in Israel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tutorSlots, unionSlots, offers, pickTutor, ilMinutesToUTC } from '../../src/lib/server/tutor-slots.ts';
import { DEFAULT_HOURS } from '../../src/lib/teaching-hours.ts';

const SUN = new Date('2027-03-14T00:00:00.000Z');
const MON = new Date('2027-03-15T00:00:00.000Z');
const FRI = new Date('2027-03-19T00:00:00.000Z');
const day = (over = {}) => ({ hours: DEFAULT_HOURS, calendar: [], bookings: [], ...over });
const times = slots => slots.map(s => s.timeLabel);

test('the default window: 08:00 to a 21:00 end, Friday to 16:00', () => {
  const mon = times(tutorSlots([MON], day(), 90));
  assert.equal(mon[0], '08:00');
  assert.equal(mon.at(-1), '19:30');
  assert.equal(times(tutorSlots([FRI], day(), 90)).at(-1), '14:30');
});

test("a tutor's own hours, with a day off and a short day", () => {
  const hours = { 1: ['10:00', '14:00'], 5: ['08:00', '10:00'] };   // Sunday off
  assert.deepEqual(times(tutorSlots([MON], day({ hours }), 90)), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30']);
  assert.deepEqual(tutorSlots([SUN], day({ hours }), 45), [], 'Sunday is a day off');
  assert.deepEqual(times(tutorSlots([FRI], day({ hours }), 45)), ['08:00', '08:30', '09:00']);
});

test('their calendar blocks with a 30-minute buffer, their lessons with a 15-minute break', () => {
  // 10:00–11:00 Israel.
  const busy = [{ start: '2027-03-15T08:00:00.000Z', end: '2027-03-15T09:00:00.000Z' }];
  const afterEvent = times(tutorSlots([MON], day({ calendar: busy }), 45));
  assert.ok(afterEvent.includes('09:00'), 'free right up to the event');
  assert.ok(!afterEvent.includes('09:30'), '09:30–10:15 runs into it');
  assert.ok(!afterEvent.includes('11:00') && afterEvent.includes('11:30'), '30 minutes clear after it');
  const afterLesson = times(tutorSlots([MON], day({ bookings: busy }), 45));
  assert.ok(afterLesson.includes('11:15') && !afterLesson.includes('11:00'), '15 minutes clear after a lesson');
});

test('a slot is offered once, whichever tutors have it, and never says whose', () => {
  const nikol = tutorSlots([MON], day({ hours: { 1: ['08:00', '10:00'] } }), 45);
  const lior = tutorSlots([MON], day({ hours: { 1: ['09:00', '11:00'] } }), 45);
  const both = unionSlots([lior, nikol]);
  assert.deepEqual(times(both), ['08:00', '08:30', '09:00', '09:30', '10:00']);
  assert.deepEqual(Object.keys(both[0]).sort(), ['dateLabel', 'dayOfWeek', 'end', 'start', 'timeLabel']);
});

test('on the day the clocks change, 08:00 is still 08:00 in Israel', () => {
  // Israel moves to summer time on Friday 2027-03-26.
  const dst = new Date('2027-03-26T00:00:00.000Z');
  assert.equal(new Date(ilMinutesToUTC(dst, 8 * 60)).toISOString(), '2027-03-26T05:00:00.000Z');
  assert.equal(tutorSlots([dst], day(), 45)[0].timeLabel, '08:00');
});

test('offers: inside their hours, clear of the buffer, and nothing else', () => {
  // Monday 10:00–14:00 Israel (08:00–12:00Z); busy 11:00–11:30 Israel, clear from 12:00.
  const t = day({ hours: { 1: ['10:00', '14:00'] }, calendar: [{ start: '2027-03-15T09:00:00.000Z', end: '2027-03-15T09:30:00.000Z' }] });
  assert.equal(offers(t, '2027-03-15T08:00:00.000Z', '2027-03-15T08:45:00.000Z'), true, '10:00–10:45');
  assert.equal(offers(t, '2027-03-15T07:30:00.000Z', '2027-03-15T08:15:00.000Z'), false, 'starts before their day');
  assert.equal(offers(t, '2027-03-15T09:45:00.000Z', '2027-03-15T10:30:00.000Z'), false, 'inside the buffer');
  assert.equal(offers(t, '2027-03-15T10:00:00.000Z', '2027-03-15T10:45:00.000Z'), true, '12:00 is clear');
  assert.equal(offers(t, '2027-03-15T11:30:00.000Z', '2027-03-15T12:15:00.000Z'), false, 'ends after their day');
  assert.equal(offers(t, '2027-03-14T08:00:00.000Z', '2027-03-14T08:45:00.000Z'), false, 'Sunday is a day off');
});

// Monday 10:00–11:30 Israel.
const AT = ['2027-03-15T08:00:00.000Z', '2027-03-15T09:30:00.000Z'];
const busyAt = [{ start: AT[0], end: AT[1] }];
const NIKOL = { id: 1 }, LIOR = { id: 2 };
const days = (over) => (t) => day(over[t.id] ?? {});

test('Nikol first when both are free', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({})), NIKOL);
});

test('Lior when Nikol is busy in her calendar, or has a lesson booked then', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { calendar: busyAt } })), LIOR);
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { bookings: busyAt } })), LIOR);
});

test('nobody, when both are busy', () => {
  assert.equal(pickTutor([NIKOL, LIOR], ...AT, days({ 1: { bookings: busyAt }, 2: { calendar: busyAt } })), null);
});

test('the tutor whose hours have the slot, before one whose day has ended', () => {
  // 19:30–21:00 Israel: after Nikol's day ends at 18:00, inside Lior's.
  const late = ['2027-03-15T17:30:00.000Z', '2027-03-15T19:00:00.000Z'];
  assert.equal(pickTutor([NIKOL, LIOR], ...late, days({ 1: { hours: { 1: ['08:00', '18:00'] } } })), LIOR);
});

test("outside everyone's hours, the first tutor with nothing then still gets it, as one tutor always did", () => {
  // Saturday 2027-03-20, 10:00 Israel.
  const sat = ['2027-03-20T08:00:00.000Z', '2027-03-20T09:30:00.000Z'];
  assert.equal(pickTutor([NIKOL, LIOR], ...sat, days({})), NIKOL);
  assert.equal(pickTutor([NIKOL, LIOR], ...sat, days({ 1: { bookings: [{ start: sat[0], end: sat[1] }] } })), LIOR);
});

/* Final review, Important #2: the second pass must not hand a tutor an
   hour outside their own day just because the tutor whose day it is, is
   busy — that is a stale page meeting a taken hour, and the answer is 409. */
test("a tutor is never given an hour outside their own day, even when the tutor whose day it is, is busy", () => {
  // 19:30–21:00 Israel on Monday: Nikol has it booked; Lior's Monday ends at 18:00.
  const late = ['2027-03-15T17:30:00.000Z', '2027-03-15T19:00:00.000Z'];
  const nikolBooked = { bookings: [{ start: late[0], end: late[1] }] };
  assert.equal(pickTutor([NIKOL, LIOR], ...late, days({ 1: nikolBooked, 2: { hours: { 1: ['08:00', '18:00'] } } })), null);
  assert.equal(pickTutor([NIKOL, LIOR], ...late, days({ 1: nikolBooked, 2: { hours: {} } })), null, 'nor when he has no days at all');
});

test('inside their day, a tutor with nothing at that hour still takes it, even inside a buffer', () => {
  // Nikol alone, a calendar event ending exactly at the lesson's start: no clash, inside her hours.
  const at = ['2027-03-15T10:00:00.000Z', '2027-03-15T10:45:00.000Z'];
  assert.equal(pickTutor([NIKOL], ...at, days({ 1: { calendar: [{ start: '2027-03-15T09:00:00.000Z', end: at[0] }] } })), NIKOL);
});
