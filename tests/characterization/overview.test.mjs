// tests/characterization/overview.test.mjs
//
// The family overview is rendered by /app/parent's server load, not fetched
// after mount, so these assert on the server-rendered HTML. That is also
// what makes them meaningful: a parent with siblings sees the overview in
// the first paint, with no spinner in front of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const book = (baseUrl, over = {}, cookie = null) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const sibling = {
  name: 'נועה כהן', subject: 'פיזיקה', level: 'כיתה ז', durationMin: 45,
  start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T10:45:00+02:00',
};

const parentPage = (baseUrl, cookie, query = '') =>
  fetch(`${baseUrl}/app/parent${query}`, { headers: { Cookie: cookie }, redirect: 'manual' });

test('a parent with two children lands on the overview, both children rendered', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    const cookie = await familySession(first.portal.link);
    const second = await book(baseUrl, sibling, cookie); // the parent, signed in
    assert.notEqual(second.portal.code, first.portal.code, 'a sibling is a second student');

    const res = await parentPage(baseUrl, cookie);
    assert.equal(res.status, 200);
    const html = await res.text();

    assert.match(html, /יובל כהן/, 'the first child is missing from the overview');
    assert.match(html, /נועה כהן/, 'the sibling is missing from the overview');
    assert.match(html, /מתמטיקה/);
    assert.match(html, /פיזיקה/);

    // Per-child figures, not the family total repeated: ₪215 for the
    // 90-minute lesson and ₪120 for the 45-minute one, both upcoming.
    assert.match(html, /₪335/, 'the family total should be ₪215 + ₪120');
    assert.match(html, /₪215/);
    assert.match(html, /₪120/);
  } finally { await stop(); }
});

test('a parent with one child skips the overview and opens the board', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const only = await book(baseUrl);
    const cookie = await familySession(only.portal.link);

    const html = await (await parentPage(baseUrl, cookie)).text();
    // An overview of one card is a click that buys nothing, so the board
    // renders instead — its content arrives client-side.
    assert.doesNotMatch(html, /תלמידים בחשבון/, 'a single-child account must not see the overview');
  } finally { await stop(); }
});

test('naming a child opens that board, even when siblings exist', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    // Signed in: a signed-out booking with a known email waits for the
    // family's confirmation (confirm-known-email.test.mjs).
    const cookie = await familySession(first.portal.link);
    await book(baseUrl, sibling, cookie);

    const html = await (await parentPage(baseUrl, cookie, `?s=${first.portal.code}`)).text();
    assert.doesNotMatch(html, /תלמידים בחשבון/, '?s= must open a board, not the overview');
  } finally { await stop(); }
});

test("the overview never carries another family's child", async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await book(baseUrl);
    await book(baseUrl, sibling, await familySession(mine.portal.link));
    const theirs = await book(baseUrl, {
      name: 'ילד של משפחה אחרת', email: 'other@example.com',
      start: '2027-04-01T10:00:00+02:00', end: '2027-04-01T11:30:00+02:00',
    });

    const cookie = await familySession(mine.portal.link);
    const html = await (await parentPage(baseUrl, cookie)).text();

    assert.match(html, /יובל כהן/);
    assert.doesNotMatch(html, /ילד של משפחה אחרת/, "another family's child leaked into the overview");

    // Asserted on the rendered link rather than a bare substring: a student
    // code is a short transliteration ("ילד" → "ild") and collides by chance
    // with hashed class names in the built output.
    const cardLinks = [...html.matchAll(/\/app\/parent\?s=([a-z0-9-]+)/g)].map(m => m[1]);
    assert.ok(cardLinks.length >= 2, 'both of my children should have cards');
    assert.ok(!cardLinks.includes(theirs.portal.code), "another family's child has a card");
    assert.ok(cardLinks.includes(mine.portal.code));
  } finally { await stop(); }
});

test('a student session is sent to its own board, never the overview', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    const parentCookie = await familySession(first.portal.link);
    await book(baseUrl, sibling, parentCookie);

    const share = await (await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ code: first.portal.code }),
    })).json();
    const childCookie = await familySession(share.link);

    // The overview carries balances and every sibling — the same reason a
    // child cannot reach ?kind=parent for their own record.
    const res = await parentPage(baseUrl, childCookie);
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /\/app\/student/);
  } finally { await stop(); }
});

test('no session at all is sent to the door', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/app/parent`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /\/portal/);
  } finally { await stop(); }
});
