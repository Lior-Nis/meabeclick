// tests/characterization/availability-per-tutor.test.mjs
//
// The booking page's hours are the union of the candidates' own free slots
// (docs/superpowers/specs/2026-10-17-per-tutor-booking-design.md). Lior
// "takes bookings" here through the database, with a busy feed on port 1:
// refused at once, so his calendar reads as free. Not a real address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
const liorTakesBookings = (dbPath) => run(dbPath,
  `UPDATE teachers SET calendar_id = 'lior-lessons@example.com', busy_ics = 'https://127.0.0.1:1/lior.ics' WHERE id = 2`);
const hours = async (baseUrl, query = '', headers = {}) =>
  (await fetch(`${baseUrl}/api/availability?duration=45${query}`, { headers })).json();

test("one tutor's lesson leaves the hour open with the other, and a family sees only their tutor's hours", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const slot = (await hours(baseUrl)).slots[0];
    assert.ok(slot, 'the coming week has a free slot');
    const booked = await (await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
        email: 'dana@example.com', durationMin: 45, start: slot.start, end: slot.end }),
    })).json();
    assert.ok(booked.portal, JSON.stringify(booked));
    const cookie = await familySession(booked.portal.link);

    const offered = (r) => r.slots.some(s => s.start === slot.start);
    assert.equal(offered(await hours(baseUrl)), true, 'still open with Lior, for a new family');
    assert.equal(offered(await hours(baseUrl, '', { Cookie: cookie })), false, "Dana's family is offered Nikol's hours, and Nikol teaches Dana then");
    assert.equal(offered(await hours(baseUrl, '&tutor=1')), false);
    assert.equal(offered(await hours(baseUrl, '&tutor=2')), true);
    assert.deepEqual((await hours(baseUrl, '&tutor=99')).slots, []);
  } finally { await stop(); }
});

test('a feed that fails is reported to the dashboard by tutor and position, never by address', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    liorTakesBookings(dbPath);
    const r = await hours(baseUrl);
    assert.deepEqual([r.calendars, r.calendarFailures], [2, 1], "Nikol's feed answered, Lior's did not");
    const issues = await (await fetch(`${baseUrl}/api/calendar-failures`, { headers: { cookie: await login(baseUrl) } })).json();
    assert.deepEqual(issues.sourceIssues.map(s => [s.tutorName, s.index, s.total]), [['ליאור', 1, 1]]);
    assert.doesNotMatch(JSON.stringify(issues), /127\.0\.0\.1|lior\.ics/);
  } finally { await stop(); }
});

test('nobody takes bookings: no hours, said as not connected', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    run(dbPath, `UPDATE teachers SET busy_ics = NULL`);
    const r = await hours(baseUrl);
    assert.deepEqual(r.slots, []);
    assert.equal(r.calendarConnected, false);
  } finally { await stop(); }
});
