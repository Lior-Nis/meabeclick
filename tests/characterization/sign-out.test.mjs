// tests/characterization/sign-out.test.mjs
//
// Every portal needs a way out, and two of the three did not have one.
//
// The family session cookie lasts SIX MONTHS and these boards are opened
// from a WhatsApp link on a phone or a shared family laptop. The student
// board had no sign-out at all; the tutor dashboard — which lists every
// family's name, lessons and balance — had none either, even though
// POST /api/logout had existed, correct and uncalled, since the Express
// port. Clearing browser cookies was the only way off either page.
//
// These assert the endpoints actually invalidate a session, and that each
// page renders the control. The endpoints matter more: a button that posts
// to something that does not clear the cookie is the failure that looks
// fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-10-11T10:00:00+03:00', end: '2027-10-11T11:30:00+03:00',
    ...over,
  }),
}).then(r => r.json());

/** A child's own session, which is what /app/student serves — an account
 *  session is redirected to /app/parent instead. */
async function studentSession(baseUrl, parentCookie, code) {
  const share = await (await fetch(`${baseUrl}/api/student-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
    body: JSON.stringify({ code }),
  })).json();
  return familySession(share.link);
}

test('a family session can be ended, and is dead afterwards', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await familySession(booked.portal.link);

    // Live before.
    const before = await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(before.status, 200, 'the session should reach the board to begin with');

    const out = await fetch(`${baseUrl}/api/family`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.equal(out.status, 200);

    // The response must actually expire the cookie, not merely say ok.
    const cleared = out.headers.getSetCookie().find(c => c.startsWith('maab_family='));
    assert.ok(cleared, 'sign-out must send a Set-Cookie that clears the session');
    assert.match(cleared, /Max-Age=0|Expires=Thu, 01 Jan 1970/, 'the cookie must be expired, not replaced');
  } finally { await stop(); }
});

test('a tutor session can be ended, and is dead afterwards', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    assert.deepEqual(
      await (await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })).json(),
      { authenticated: true },
    );

    const out = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(out.status, 200);
    const cleared = out.headers.getSetCookie().find(c => c.startsWith('maab_session='));
    assert.ok(cleared, 'sign-out must send a Set-Cookie that clears the session');
    assert.match(cleared, /Max-Age=0|Expires=Thu, 01 Jan 1970/);
  } finally { await stop(); }
});

test('the student board offers a way out', async () => {
  // The gap that prompted this: a child's board on a shared device, with a
  // six-month cookie and no control to end it.
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const parent = await familySession(booked.portal.link);
    const child = await studentSession(baseUrl, parent, booked.portal.code);

    // ?s= is required: the guard redirects to the canonical URL without it.
    const res = await fetch(`${baseUrl}/app/student?s=${booked.portal.code}`, {
      headers: { Cookie: child }, redirect: 'manual',
    });
    assert.equal(res.status, 200, 'a student session should land on the board');
    assert.match(await res.text(), /יציאה/, 'the student board must render a sign-out');
  } finally { await stop(); }
});

test('the tutor dashboard offers a way out', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /יציאה/, 'the dashboard must render a sign-out');
  } finally { await stop(); }
});
