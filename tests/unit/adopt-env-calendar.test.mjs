// tests/unit/adopt-env-calendar.test.mjs
//
// On the first boot after migration 029, the default tutor's row takes over
// CALENDAR_ID and CALENDAR_ICS_URLS from .env — once, never overwriting,
// and logging only that it happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'adopt-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/tutor-settings.ts');

const ENV = {
  CALENDAR_ID: 'lessons@group.calendar.google.com',
  CALENDAR_ICS_URLS: 'https://calendar.google.com/calendar/ical/a/private-TOKENA/basic.ics,https://calendar.google.com/calendar/ical/b/private-TOKENB/basic.ics',
};

/** Runs fn with every console line captured. */
function captured(fn) {
  const lines = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(saved)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { return { result: fn(), lines }; } finally { Object.assign(console, saved); }
}

test("the default tutor's row takes over the .env values, and only that it happened is logged", () => {
  const { result, lines } = captured(() => S.adoptEnvCalendar(ENV));
  assert.equal(result, true);
  const nikol = E.defaultTeacher();
  assert.equal(nikol.calendar_id, ENV.CALENDAR_ID);
  assert.deepEqual(S.busyAddresses(nikol), ENV.CALENDAR_ICS_URLS.split(','));
  assert.equal(S.takesBookings(nikol), true);
  assert.equal(S.takesBookings(E.listTeachers()[1]), false, 'Lior is untouched');
  assert.match(lines.join('\n'), /ניקול/);
  assert.doesNotMatch(lines.join('\n'), /TOKENA|TOKENB|lessons@/);
});

test('it never overwrites what the row already has', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: 'changed@group.calendar.google.com' });
  assert.equal(S.adoptEnvCalendar({ CALENDAR_ID: 'other@group.calendar.google.com', CALENDAR_ICS_URLS: 'https://x.example/o.ics' }), false);
  assert.equal(E.defaultTeacher().calendar_id, 'changed@group.calendar.google.com');
});

test('a row with only one of the two set is not touched either', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: null, busyIcs: ['https://x.example/keep.ics'] });
  assert.equal(S.adoptEnvCalendar(ENV), false);
  assert.equal(E.defaultTeacher().calendar_id, null);
});

test('nothing in .env, nothing to take over', () => {
  S.updateTutorSettings(E.defaultTeacher().id, { calendarId: null, busyIcs: [] });
  assert.equal(S.adoptEnvCalendar({}), false);
});

test('boot takes them over once the database is migrated', async () => {
  const hooks = await readFile(new URL('../../src/hooks.server.ts', import.meta.url), 'utf8');
  const db = hooks.indexOf("await import('$server/db.ts')");
  const adopt = hooks.indexOf('adoptEnvCalendar()');
  assert.ok(db > 0 && adopt > db, 'adoptEnvCalendar() runs after the db import');
});
