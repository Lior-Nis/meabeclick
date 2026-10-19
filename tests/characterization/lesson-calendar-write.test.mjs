// tests/characterization/lesson-calendar-write.test.mjs
//
// Each lesson is written into its own tutor's lesson calendar, end to end:
// the real booking route, the real service-account sign-in, and a fake
// Google that only the test server loads (fake-google.mjs) — it answers
// the sign-in and the event write and records each request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer } from './harness.mjs';

const HOUR = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' };
const NIKOL_ROOM = 'https://meet.google.com/aaa-bbbb-ccc';
const LIOR_ROOM = 'https://meet.google.com/ddd-eeee-fff';

function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
const book = (baseUrl, over) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    durationMin: 90, mode: 'online', ...HOUR, ...over }),
}).then(r => r.json());

test("each lesson is written into its own tutor's lesson calendar, with that tutor's room", async () => {
  const { baseUrl, dbPath, googleRequests, stop } = await startServer({ fakeGoogle: true });
  try {
    run(dbPath, `UPDATE teachers SET meet_url = ? WHERE id = 1`, NIKOL_ROOM);
    run(dbPath, `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics', meet_url = ? WHERE id = 2`, LIOR_ROOM);

    const first = await book(baseUrl, { email: 'a@example.com' });
    const second = await book(baseUrl, { email: 'b@example.com', name: 'יואב' });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));

    const writes = googleRequests().filter(r => r.method === 'POST' && r.url.includes('/calendar/v3/calendars/'));
    const calendarOf = (r) => decodeURIComponent(r.url.split('/calendars/')[1].split('/')[0]);
    assert.deepEqual(writes.map(calendarOf), ['test-calendar@example.com', 'lior-lessons@example.com'],
      "Nikol's lesson into her calendar, Lior's into his");
    assert.equal(JSON.parse(writes[0].body).location, NIKOL_ROOM);
    assert.equal(JSON.parse(writes[1].body).location, LIOR_ROOM);
    assert.ok(googleRequests().every(r => !r.url.includes('/calendars/') || r.headers.authorization === 'Bearer fake-token'),
      'every write signed in as the robot');
  } finally { await stop(); }
});
