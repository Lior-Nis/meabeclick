// tests/characterization/events-endpoint.test.mjs
//
// POST /api/events, end to end through the real built server. It always
// answers 204 — a probe must learn nothing from the status code — so every
// test here proves what happened by reading marketing_events directly
// through the harness's dbPath, never by inspecting the response.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

function post(baseUrl, body, { userAgent, cookie, rawBody } = {}) {
  return fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

async function rowCount(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM marketing_events').get().n;
  } finally {
    db.close();
  }
}

async function allRows(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT * FROM marketing_events ORDER BY id').all();
  } finally {
    db.close();
  }
}

// 36 hex/dash characters — what crypto.randomUUID() (src/lib/marketing.ts's
// initMarketing) actually mints, and the shape VISITOR_ID_RE requires.
const VALID_VISITOR_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

test('a valid event is stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await post(baseUrl, {
      event: 'cta_click',
      target: 'whatsapp',
      path: '/',
      visitorId: VALID_VISITOR_ID,
      utm: { source: 'fb', medium: 'cpc', campaign: 'promo', content: 'ad1' },
    });
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');

    const rows = await allRows(dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event, 'cta_click');
    assert.equal(rows[0].target, 'whatsapp');
    assert.equal(rows[0].visitor_id, VALID_VISITOR_ID);
    assert.equal(rows[0].utm_source, 'fb');
    assert.equal(rows[0].utm_campaign, 'promo');
  } finally { await stop(); }
});

// ── visitorId format (task 4) ────────────────────────────────────────────

test('a visitorId that does not look like a minted uuid is stored as absent, not as given', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await post(baseUrl, { event: 'landing_visit', visitorId: 'not-a-real-visitor-id' });
    assert.equal(r.status, 204);

    const rows = await allRows(dbPath);
    assert.equal(rows.length, 1, 'the event itself is still stored — only the visitorId is dropped');
    assert.equal(rows[0].visitor_id, null, 'a malformed visitorId must not be stored as given');
  } finally { await stop(); }
});

// ── path sanitation (task 3) ─────────────────────────────────────────────

test('path is cut at the first ? or #, and dropped entirely without a leading slash', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await post(baseUrl, { event: 'landing_visit', path: '/booking?utm_source=fb#pane-2' });
    await post(baseUrl, { event: 'landing_visit', path: 'booking' });
    await post(baseUrl, { event: 'landing_visit', path: 'https://evil.example/x' });

    const rows = await allRows(dbPath);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].path, '/booking', 'the query and fragment must be stripped');
    assert.equal(rows[1].path, null, 'a path with no leading slash must be dropped, not stored bare');
    assert.equal(rows[2].path, null, 'an absolute URL has no leading slash either — dropped');
  } finally { await stop(); }
});

test('a bad event returns 204 and is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const before = await rowCount(dbPath);

    // An unknown event name.
    let r = await post(baseUrl, { event: 'page_view' });
    assert.equal(r.status, 204);

    // A non-string field, which recordEvent's own trimming would otherwise
    // coerce into "[object Object]" rather than reject.
    r = await post(baseUrl, { event: 'cta_click', target: 'whatsapp', utm: { source: { nope: true } } });
    assert.equal(r.status, 204);

    r = await post(baseUrl, { event: { toString: () => 'cta_click' } });
    assert.equal(r.status, 204);

    // Malformed JSON entirely.
    r = await post(baseUrl, null, { rawBody: '{not json' });
    assert.equal(r.status, 204);

    assert.equal(await rowCount(dbPath), before, 'nothing must be written for any bad event');
  } finally { await stop(); }
});

test('a bot user-agent is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const before = await rowCount(dbPath);
    const bots = [
      'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0 Safari/537.36',
      'python-requests/2.31 crawler',
    ];
    for (const ua of bots) {
      const r = await post(baseUrl, { event: 'landing_visit', visitorId: 'v-bot' }, { userAgent: ua });
      assert.equal(r.status, 204);
    }
    assert.equal(await rowCount(dbPath), before, 'a bot user-agent must never be stored');
  } finally { await stop(); }
});

test('lesson_scheduled from a client is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const before = await rowCount(dbPath);
    const r = await post(baseUrl, { event: 'lesson_scheduled', bookingId: 1, visitorId: 'v-forge' });
    assert.equal(r.status, 204);
    assert.equal(await rowCount(dbPath), before, 'lesson_scheduled must be server-only, from /api/book');
  } finally { await stop(); }
});

test('a valid admin session is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const before = await rowCount(dbPath);
    const cookie = await login(baseUrl);
    const r = await post(baseUrl, { event: 'landing_visit', visitorId: 'v-tutor' }, { cookie });
    assert.equal(r.status, 204);
    assert.equal(await rowCount(dbPath), before, "the tutor's own admin session must not pollute the funnel");
  } finally { await stop(); }
});

test('a body over 2KB is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const before = await rowCount(dbPath);
    const oversized = { event: 'landing_visit', visitorId: 'v-big', path: 'x'.repeat(3000) };
    const r = await post(baseUrl, oversized);
    assert.equal(r.status, 204);
    assert.equal(await rowCount(dbPath), before);
  } finally { await stop(); }
});

test('the 61st event in the window is not stored', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    for (let i = 0; i < 60; i++) {
      const r = await post(baseUrl, { event: 'landing_visit', visitorId: `v-${i}` });
      assert.equal(r.status, 204);
    }
    assert.equal(await rowCount(dbPath), 60, 'the first 60 events from this IP must all be stored');

    const r61 = await post(baseUrl, { event: 'landing_visit', visitorId: 'v-61' });
    assert.equal(r61.status, 204);
    assert.equal(await rowCount(dbPath), 60, 'the 61st event within the window must not be stored');
  } finally { await stop(); }
});
