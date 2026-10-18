// tests/unit/tutor-settings.test.mjs
//
// A tutor's booking settings (migration 029). busy_ics is a secret: what
// leaves this module is a count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tutor-settings-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');
const { DEFAULT_HOURS } = await import('../../src/lib/teaching-hours.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const LIOR = E.listTeachers()[1].id;
const FEED = 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics';

test('a tutor takes bookings once they have a lesson calendar and a busy address', () => {
  S.updateTutorSettings(LIOR, { calendarId: null, busyIcs: [] });
  assert.deepEqual(S.missingForBookings(E.getTeacher(LIOR)), ['calendar', 'busy']);
  assert.deepEqual(S.missingForBookings(S.updateTutorSettings(LIOR, { calendarId: 'lior@group.calendar.google.com' })), ['busy']);
  assert.equal(S.takesBookings(S.updateTutorSettings(LIOR, { busyIcs: [FEED] })), true);
});

test('a deactivated tutor takes no bookings, whatever is set', () => {
  S.updateTutorSettings(LIOR, { calendarId: 'lior@group.calendar.google.com', busyIcs: [FEED] });
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(LIOR);
  try {
    assert.equal(S.takesBookings(E.getTeacher(LIOR)), false);
  } finally {
    handle().prepare(`UPDATE teachers SET active = 1 WHERE id = ?`).run(LIOR);
  }
});

test('a pasted list splits on lines, commas and spaces, and drops blanks', () => {
  assert.deepEqual(
    S.parseBusyAddresses('https://a.example/1.ics\n\n  https://b.example/2.ics ,https://c.example/3.ics\n'),
    ['https://a.example/1.ics', 'https://b.example/2.ics', 'https://c.example/3.ics'],
  );
  assert.deepEqual(S.parseBusyAddresses(''), [], 'empty clears');
});

test('an address that is not https refuses the whole list', () => {
  assert.equal(S.parseBusyAddresses('https://a.example/1.ics\nhttp://b.example/2.ics'), null);
  assert.equal(S.parseBusyAddresses('webcal://calendar.example/x.ics'), null);
  assert.equal(S.parseBusyAddresses('not a url'), null);
  assert.equal(S.parseBusyAddresses(5), null);
});

test('hours: stored, or the default window', () => {
  assert.deepEqual(S.teachingHours({ teaching_hours: null }), DEFAULT_HOURS);
  assert.deepEqual(S.teachingHours(S.updateTutorSettings(LIOR, { teachingHours: { 0: ['10:00', '14:00'] } })), { 0: ['10:00', '14:00'] });
  assert.deepEqual(S.teachingHours(S.updateTutorSettings(LIOR, { teachingHours: null })), DEFAULT_HOURS);
});

test('a setting left out of the patch is left as it was', () => {
  S.updateTutorSettings(LIOR, { calendarId: 'keep@group.calendar.google.com' });
  const t = S.updateTutorSettings(LIOR, { busyIcs: [FEED] });
  assert.equal(t.calendar_id, 'keep@group.calendar.google.com');
});

test('the card sees a count of addresses, never the addresses', () => {
  const t = S.updateTutorSettings(LIOR, {
    busyIcs: ['https://calendar.google.com/calendar/ical/x/private-SECRET1/basic.ics',
              'https://calendar.google.com/calendar/ical/x/private-SECRET2/basic.ics'],
  });
  const view = S.tutorCardView(t);
  assert.equal(view.busyCount, 2);
  assert.doesNotMatch(JSON.stringify(view), /SECRET|private-/);
});
