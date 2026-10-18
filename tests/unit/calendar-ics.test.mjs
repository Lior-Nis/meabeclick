// Pins the semantics of busyFromIcs against hand-written ICS fixtures, and
// the read-failure recording added alongside it. Never reaches the network —
// fixtures are plain ICS text; fetchTutorBusy's network call is stubbed via
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
// fetchTutorBusy identifies a failing feed only by its tutor and 1-based
// position, never by its URL (the URL is a secret). These fixture URLs are
// not real endpoints; global.fetch is stubbed so no network call is made.

const tutor = (id, name, addresses) => ({ id, name, addresses });

/** Runs fn with the clock moved past the window in which a failed feed is
 *  not asked again (FAILURE_MS in calendar.ts). */
async function afterFailureWindow(fn) {
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 60 * 1000 + 1000;
  try { return await fn(); } finally { Date.now = realNow; }
}

test('a feed that just failed is not asked again for two minutes, and its failure is logged once', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const url = 'https://calendar.google.com/calendar/ical/super-secret-token-fff/basic.ics';
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  let calls = 0;
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  global.fetch = async () => { calls++; return { ok: false, status: 503 }; };
  try {
    const first = await calendar.fetchTutorBusy(tutor(3, 'שלישית', [url]), TIME_MIN, TIME_MAX);
    const second = await calendar.fetchTutorBusy(tutor(3, 'שלישית', [url]), TIME_MIN, TIME_MAX);
    assert.equal(calls, 1, 'the second read did not wait on the feed');
    assert.deepEqual([first.failed, second.failed], [1, 1], 'it still counts as failed');
    assert.equal(logged.length, 1, 'logged once, not on every read');
    assert.equal(calendar.calendarSourceIssues().filter(i => i.tutorId === 3).length, 1, 'the dashboard still warns');
    await afterFailureWindow(() => calendar.fetchTutorBusy(tutor(3, 'שלישית', [url]), TIME_MIN, TIME_MAX));
    assert.equal(calls, 2, 'after two minutes it is asked again');
  } finally {
    calendar.clearSourceIssues(3);
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

test('a feed that throws is recorded by tutor, position and reason, and a later success clears it', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretA = 'https://calendar.google.com/calendar/ical/super-secret-token-aaa/basic.ics';
  const secretB = 'https://calendar.google.com/calendar/ical/super-secret-token-bbb/basic.ics';
  const originalFetch = global.fetch;
  let firstFeedShouldFail = true;
  global.fetch = async (url) => (url === secretA && firstFeedShouldFail
    ? { ok: false, status: 404 }
    : { ok: true, text: async () => '' });

  try {
    const read = await calendar.fetchTutorBusy(tutor(2, 'ליאור', [secretA, secretB]), TIME_MIN, TIME_MAX);
    assert.deepEqual({ failed: read.failed, total: read.total }, { failed: 1, total: 2 });
    const [issue, ...rest] = calendar.calendarSourceIssues();
    assert.equal(rest.length, 0);
    assert.deepEqual({ ...issue, at: 'x' }, { tutorId: 2, tutorName: 'ליאור', index: 1, total: 2, at: 'x', reason: 'HTTP 404' });
    assert.ok(typeof issue.at === 'string' && issue.at.length > 0);

    firstFeedShouldFail = false;
    await afterFailureWindow(() => calendar.fetchTutorBusy(tutor(2, 'ליאור', [secretA, secretB]), TIME_MIN, TIME_MAX));
    assert.equal(calendar.calendarSourceIssues().length, 0, 'a recovered feed must stop warning');
  } finally {
    global.fetch = originalFetch;
  }
});

test("one tutor's new addresses clear only that tutor's warnings", async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const url = 'https://calendar.google.com/calendar/ical/super-secret-token-eee/basic.ics';
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 500 });
  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [url]), TIME_MIN, TIME_MAX);
    await calendar.fetchTutorBusy(tutor(2, 'ליאור', [url]), TIME_MIN, TIME_MAX);
    assert.deepEqual(calendar.calendarSourceIssues().map(i => i.tutorName), ['ניקול', 'ליאור']);
    calendar.clearSourceIssues(2);
    assert.deepEqual(calendar.calendarSourceIssues().map(i => i.tutorName), ['ניקול']);
  } finally {
    calendar.clearSourceIssues(1);
    global.fetch = originalFetch;
  }
});

test('no fixture URL or secret appears in any surfaced string', async () => {
  const calendar = await import('../../src/lib/server/calendar.ts');
  const secretUrl = 'https://calendar.google.com/calendar/ical/super-secret-token-ccc/basic.ics';
  const secretToken = 'super-secret-token-ccc';

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => (shouldFail ? { ok: false, status: 500 } : { ok: true, text: async () => '' });

  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    const surfaced = JSON.stringify(calendar.calendarSourceIssues()) + '\n' + logged.join('\n');
    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes(secretToken), 'no part of the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');

    // clean up: let the feed succeed so it doesn't leak state into other tests
    shouldFail = false;
    await afterFailureWindow(() => calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX));
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
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

  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => { logged.push(args.map(String).join(' ')); };
  let shouldFail = true;
  global.fetch = async () => {
    if (shouldFail) throw new Error(`request to ${secretUrl} failed, reason: ECONNREFUSED`);
    return { ok: true, text: async () => '' };
  };

  try {
    await calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX);
    const surfaced = JSON.stringify(calendar.calendarSourceIssues()) + '\n' + logged.join('\n');
    assert.ok(!surfaced.includes(secretUrl), 'the full URL must never be surfaced');
    assert.ok(!surfaced.includes('super-secret-token-ddd'), 'no token from the URL may be surfaced');
    assert.ok(!surfaced.includes('calendar.google.com'), 'no host derived from the URL may be surfaced');
    assert.ok(!surfaced.includes('ECONNREFUSED'), 'the raw error message must not be echoed');

    shouldFail = false;
    await afterFailureWindow(() => calendar.fetchTutorBusy(tutor(1, 'ניקול', [secretUrl]), TIME_MIN, TIME_MAX));
    assert.equal(calendar.calendarSourceIssues().length, 0);
  } finally {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});
