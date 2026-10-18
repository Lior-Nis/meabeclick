// tests/characterization/tutor-settings.test.mjs
//
// A tutor's booking settings from the "מורים" card. The busy addresses are
// secrets: no response, page or API carries them back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const SECRET_A = 'https://calendar.google.com/calendar/ical/lior/private-DO-NOT-LEAK/basic.ics';
const SECRET_B = 'https://calendar.google.com/calendar/ical/x/private-ALSO-SECRET/basic.ics';
const markup = (h) => h.split(/<script nonce=/)[0];
const patch = (baseUrl, cookie, id, body) => fetch(`${baseUrl}/api/teachers/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body),
});
function lior(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return { ...db.prepare(`SELECT calendar_id, busy_ics, teaching_hours FROM teachers WHERE id = 2`).get() }; } finally { db.close(); }
}

test('only a dashboard session changes a tutor, and only a real one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    assert.equal((await patch(baseUrl, null, 2, { calendarId: 'x@example.com' })).status, 401);
    assert.equal((await patch(baseUrl, await login(baseUrl), 999, { calendarId: 'x@example.com' })).status, 404);
  } finally { await stop(); }
});

test("saving a tutor's settings shows them ready, and never sends an address back", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const before = markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text());
    assert.match(before, /לא מקבל\/ת הזמנות עדיין: אין יומן שיעורים · אין כתובת יומן פרטית/, 'Lior, before');
    assert.match(before, /מקבל\/ת הזמנות ✓/, 'Nikol took over the .env values');

    const r = await patch(baseUrl, cookie, 2, {
      calendarId: 'lior-lessons@group.calendar.google.com',
      busyIcs: `${SECRET_A}\n${SECRET_B}\n`,
      teachingHours: { 0: ['09:00', '18:00'], 5: ['08:00', '12:00'] },
    });
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.doesNotMatch(text, /DO-NOT-LEAK|ALSO-SECRET/);
    const { tutor } = JSON.parse(text);
    assert.equal(tutor.busyCount, 2);
    assert.deepEqual(tutor.missing, []);
    assert.deepEqual(tutor.teachingHours, { 0: ['09:00', '18:00'], 5: ['08:00', '12:00'] });

    for (const path of ['/app/dashboard', '/api/students', '/api/calendar-failures']) {
      const body = await (await fetch(`${baseUrl}${path}`, { headers: { cookie } })).text();
      assert.doesNotMatch(body, /DO-NOT-LEAK|ALSO-SECRET/, path);
    }
    const after = markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie } })).text());
    assert.match(after, /2 כתובות שמורות/);
    assert.doesNotMatch(after, /לא מקבל\/ת הזמנות/);
  } finally { await stop(); }
});

test('a bad address, bad hours or a bad calendar id is refused and nothing is saved', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    for (const [body, error] of [
      [{ busyIcs: 'http://calendar.google.com/x.ics' }, /https/],
      [{ teachingHours: { 6: ['08:00', '12:00'] } }, /שעות/],
      [{ teachingHours: { 0: ['12:00', '09:00'] } }, /שעות/],
      [{ calendarId: 'not a calendar' }, /יומן/],
    ]) {
      const r = await patch(baseUrl, cookie, 2, body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match((await r.json()).error, error);
    }
    assert.deepEqual(lior(dbPath), { calendar_id: null, busy_ics: null, teaching_hours: null });
  } finally { await stop(); }
});

test('leaving the addresses out keeps the ones saved', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await patch(baseUrl, cookie, 2, { busyIcs: SECRET_A });
    await patch(baseUrl, cookie, 2, { calendarId: 'lior-lessons@group.calendar.google.com', teachingHours: null });
    assert.equal(lior(dbPath).busy_ics, SECRET_A);
  } finally { await stop(); }
});
