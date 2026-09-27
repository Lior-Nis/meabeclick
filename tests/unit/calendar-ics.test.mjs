// Pins the semantics of busyFromIcs against hand-written ICS fixtures, and
// the read-failure recording added alongside it. Never reaches the network —
// fixtures are plain ICS text; fetchBusy's network call is stubbed via
// global.fetch where needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const TIME_MIN = '2026-01-01T00:00:00.000Z';
const TIME_MAX = '2026-01-31T00:00:00.000Z';

test('a one-off timed event inside the window is busy', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:oneoff-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260110T100000Z
DTEND:20260110T110000Z
SUMMARY:One-off
END:VEVENT
END:VCALENDAR
`;
  const busy = busyFromIcs(ics, TIME_MIN, TIME_MAX);
  assert.deepEqual(busy, [{ start: '2026-01-10T10:00:00.000Z', end: '2026-01-10T11:00:00.000Z' }]);
});

test('a recurring weekly event is busy on every occurrence in the window', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:recur-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Weekly
END:VEVENT
END:VCALENDAR
`;
  const busy = busyFromIcs(ics, TIME_MIN, TIME_MAX);
  assert.deepEqual(busy.map(b => b.start), [
    '2026-01-05T10:00:00.000Z',
    '2026-01-12T10:00:00.000Z',
    '2026-01-19T10:00:00.000Z',
    '2026-01-26T10:00:00.000Z',
  ]);
});

test('a cancelled instance (EXDATE) is not busy while its siblings still are', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:recur-2@test
DTSTAMP:20260101T000000Z
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE:20260112T100000Z
SUMMARY:Weekly minus one
END:VEVENT
END:VCALENDAR
`;
  const busy = busyFromIcs(ics, TIME_MIN, TIME_MAX);
  const starts = busy.map(b => b.start);
  assert.ok(!starts.includes('2026-01-12T10:00:00.000Z'), 'the cancelled instance must not be busy');
  assert.deepEqual(starts, [
    '2026-01-05T10:00:00.000Z',
    '2026-01-19T10:00:00.000Z',
    '2026-01-26T10:00:00.000Z',
  ]);
});

test('a moved instance (RECURRENCE-ID) is busy at the new time, not the old one', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:recur-3@test
DTSTAMP:20260101T000000Z
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Weekly moved one
END:VEVENT
BEGIN:VEVENT
UID:recur-3@test
DTSTAMP:20260101T000000Z
RECURRENCE-ID:20260112T100000Z
DTSTART:20260112T150000Z
DTEND:20260112T160000Z
SUMMARY:Weekly moved one (moved)
END:VEVENT
END:VCALENDAR
`;
  const busy = busyFromIcs(ics, TIME_MIN, TIME_MAX);
  const starts = busy.map(b => b.start);
  assert.ok(!starts.includes('2026-01-12T10:00:00.000Z'), 'the old slot must be free');
  assert.ok(starts.includes('2026-01-12T15:00:00.000Z'), 'the new slot must be busy');
});

test('an event marked free (TRANSP:TRANSPARENT) is not busy', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:transparent-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260110T100000Z
DTEND:20260110T110000Z
TRANSP:TRANSPARENT
SUMMARY:Free
END:VEVENT
END:VCALENDAR
`;
  assert.deepEqual(busyFromIcs(ics, TIME_MIN, TIME_MAX), []);
});

test('a cancelled event (STATUS:CANCELLED) is not busy', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:cancelled-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260110T100000Z
DTEND:20260110T110000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR
`;
  assert.deepEqual(busyFromIcs(ics, TIME_MIN, TIME_MAX), []);
});

test('an all-day event (DTSTART;VALUE=DATE) is not busy', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:allday-1@test
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260115
DTEND;VALUE=DATE:20260116
SUMMARY:All day
END:VEVENT
END:VCALENDAR
`;
  assert.deepEqual(busyFromIcs(ics, TIME_MIN, TIME_MAX), []);
});

test('an event entirely outside the window is not busy', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:outside-1@test
DTSTAMP:20260101T000000Z
DTSTART:20260305T100000Z
DTEND:20260305T110000Z
SUMMARY:Outside
END:VEVENT
END:VCALENDAR
`;
  assert.deepEqual(busyFromIcs(ics, TIME_MIN, TIME_MAX), []);
});

test('the same occurrence arriving twice (series + instance) is counted once', async () => {
  const { busyFromIcs } = await import('../../src/lib/server/calendar.ts');
  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//test//EN
BEGIN:VEVENT
UID:recur-4@test
DTSTAMP:20260101T000000Z
DTSTART:20260105T100000Z
DTEND:20260105T110000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Weekly dup
END:VEVENT
BEGIN:VEVENT
UID:recur-4@test
DTSTAMP:20260101T000000Z
RECURRENCE-ID:20260112T100000Z
DTSTART:20260112T100000Z
DTEND:20260112T110000Z
SUMMARY:Weekly dup (unmoved override)
END:VEVENT
END:VCALENDAR
`;
  const busy = busyFromIcs(ics, TIME_MIN, TIME_MAX);
  const jan12 = busy.filter(b => b.start === '2026-01-12T10:00:00.000Z');
  assert.equal(jan12.length, 1, 'the duplicated occurrence must appear exactly once');
  assert.equal(busy.length, 4);
});

// ── Read-failure recording ──────────────────────────────────────────────
// fetchBusy identifies a failing feed only by its 1-based position, never
// by its URL (the URL is a secret). These fixture URLs are not real
// endpoints; global.fetch is stubbed so no network call is made.

test('a feed that throws is recorded by index/reason, and a later success clears it', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretA = 'https://calendar.google.com/calendar/ical/super-secret-token-aaa/basic.ics';
  const secretB = 'https://calendar.google.com/calendar/ical/super-secret-token-bbb/basic.ics';
  process.env.CALENDAR_ICS_URLS = `${secretA},${secretB}`;

  const originalFetch = global.fetch;
  let firstFeedShouldFail = true;
  global.fetch = async (url) => {
    if (url === secretA && firstFeedShouldFail) {
      return { ok: false, status: 404 };
    }
    return { ok: true, text: async () => '' };
  };

  try {
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    let issues = calendar.calendarSourceIssues();
    assert.equal(issues.length, 1);
    assert.equal(issues[0].index, 1);
    assert.equal(issues[0].total, 2);
    assert.equal(issues[0].reason, 'HTTP 404');
    assert.ok(typeof issues[0].at === 'string' && issues[0].at.length > 0);

    firstFeedShouldFail = false;
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    issues = calendar.calendarSourceIssues();
    assert.equal(issues.length, 0, 'a recovered feed must stop warning');
  } finally {
    global.fetch = originalFetch;
    delete process.env.CALENDAR_ICS_URLS;
  }
});

test('no fixture URL or secret appears in any surfaced string', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretUrl = 'https://calendar.google.com/calendar/ical/super-secret-token-ccc/basic.ics';
  const secretToken = 'super-secret-token-ccc';
  process.env.CALENDAR_ICS_URLS = secretUrl;

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => {
    if (shouldFail) return { ok: false, status: 500 };
    return { ok: true, text: async () => '' };
  };

  try {
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    const issues = calendar.calendarSourceIssues();
    const surfaced = JSON.stringify(issues) + '\n' + logged.join('\n');

    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes(secretToken), 'no part of the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');

    // clean up: let the feed succeed so it doesn't leak state into other tests
    shouldFail = false;
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    delete process.env.CALENDAR_ICS_URLS;
  }
});

/* The leak test above only ever exercises our OWN `HTTP nnn` error, which
   cannot carry a URL. The realistic vector is different: undici rejects with
   a message that embeds the request URL ("request to https://... failed"),
   and that error reaches classifyReadError as an UNCLASSIFIED one — the
   branch that must never echo the raw message. Without this case, replacing
   that branch's fixed string with `message` passes the whole suite. */
test('a fetch rejection carrying the URL still surfaces nothing derived from it', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretUrl = 'https://calendar.google.com/calendar/ical/super-secret-token-ddd/basic.ics';
  process.env.CALENDAR_ICS_URLS = secretUrl;

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => {
    if (shouldFail) {
      // The shape undici actually throws, URL and all.
      throw new Error(`request to ${secretUrl} failed, reason: ECONNREFUSED`);
    }
    return { ok: true, text: async () => '' };
  };

  try {
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    const surfaced = JSON.stringify(calendar.calendarSourceIssues()) + '\n' + logged.join('\n');

    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes('super-secret-token-ddd'), 'no token from the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');
    assert.ok(!surfaced.includes('ECONNREFUSED'), 'the raw error message must not be echoed');

    shouldFail = false;
    await calendar.fetchBusy(TIME_MIN, TIME_MAX);
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
    delete process.env.CALENDAR_ICS_URLS;
  }
});
