// tests/characterization/availability-degraded.test.mjs
//
// A calendar read that partly failed must not reach the booking page
// looking like a clean one.
//
// The harm is specific. /api/availability subtracts busy time from the
// teaching window, so a feed that fails contributes NO busy intervals and
// its hours come back free. A parent then books an hour the tutor is
// actually teaching someone else, or sitting in a university class. The
// booking write path (reserveBooking) cannot catch it — it only knows about
// bookings made through this site, and the conflict is in Google.
//
// So the endpoint reports how many feeds it could not read, and this file
// holds it to that. `calendarConnected` says iCal is the configured source;
// it has never meant "every feed answered".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

// Port 1 is reserved and nothing listens there, so the fetch fails fast and
// locally. These are not real endpoints and carry no secret.
const DEAD_FEED_A = 'http://127.0.0.1:1/a.ics';
const DEAD_FEED_B = 'http://127.0.0.1:1/b.ics';

test('an availability read with every feed failing says so', async () => {
  const { baseUrl, stop } = await startServer({
    env: { CALENDAR_ICS_URLS: `${DEAD_FEED_A},${DEAD_FEED_B}` },
  });
  try {
    const r = await fetch(`${baseUrl}/api/availability?duration=45`);
    assert.equal(r.status, 200, 'a failed calendar is not a failed request');
    const body = await r.json();

    assert.equal(body.calendarConnected, true,
      'iCal is still the configured source — this flag is about configuration');
    assert.equal(body.calendars, 2, 'both configured feeds must be counted');
    assert.equal(body.calendarFailures, 2,
      'a caller must be able to tell this read apart from a clean one');
  } finally { await stop(); }
});

test('a failed feed does not surface its URL to the browser', async () => {
  const { baseUrl, stop } = await startServer({
    env: { CALENDAR_ICS_URLS: DEAD_FEED_A },
  });
  try {
    const r = await fetch(`${baseUrl}/api/availability?duration=45`);
    const text = await r.text();
    // An iCal address is a secret: anyone holding it reads the whole
    // calendar. It must not travel to an unauthenticated page, not even
    // inside an error string.
    assert.ok(!text.includes('127.0.0.1'), 'no feed host in the response');
    assert.ok(!text.includes('.ics'), 'no feed path in the response');
  } finally { await stop(); }
});

test('slots are still offered when a feed fails, because refusing to book is worse', async () => {
  const { baseUrl, stop } = await startServer({
    env: { CALENDAR_ICS_URLS: DEAD_FEED_A },
  });
  try {
    const r = await fetch(`${baseUrl}/api/availability?duration=45`);
    const body = await r.json();
    // Deliberate: a family that cannot book at all is a lost family. The
    // slots go out, flagged — the page's job is to say they are unconfirmed,
    // not this endpoint's job to withhold them.
    assert.ok(Array.isArray(body.slots), 'slots must still be returned');
    assert.ok(body.slots.length > 0, 'a degraded read still offers times');
  } finally { await stop(); }
});
