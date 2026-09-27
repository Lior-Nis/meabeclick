// tests/characterization/returning-booking.test.mjs
//
// What a family's second booking should cost them. The page's server load
// reads the family session that hooks.server.ts already resolves on every
// request — which booking previously ignored, so a parent who books monthly
// re-typed a name, subject, level, email and phone the server already knew.
//
// These assert on the data the server load puts into the page, not on the
// rendered picker: the details sheet only renders once a slot is tapped, so
// its markup is not in the server response. That makes the negative cases
// the load-bearing ones — they prove another family's children and the
// account's email never reach a page they should not. The rendered picker
// is verified in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const book = (baseUrl, over = {}, headers = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

test('a returning family is offered their own children, with contact details filled in', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    await book(baseUrl, {
      name: 'נועה כהן', subject: 'פיזיקה', level: 'כיתה ז', durationMin: 45,
      start: '2027-03-16T10:00:00+02:00', end: '2027-03-16T10:45:00+02:00',
    });

    const cookie = await familySession(first.portal.link);
    const html = await (await fetch(`${baseUrl}/booking`, { headers: { Cookie: cookie } })).text();

    assert.match(html, /יובל כהן/, 'the first child should reach the page');
    assert.match(html, /נועה כהן/, 'the sibling should reach it too');

    // The contact details the account already holds, so pane 2 has nothing
    // to ask for.
    assert.match(html, /orit@example\.com/);
    assert.match(html, /0501234567/);
  } finally { await stop(); }
});

test('a first-time visitor sees no children and no prefill', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    // Someone else's family exists; a visitor with no session must see
    // nothing of it.
    const theirs = await book(baseUrl, { name: 'ילד אחר', email: 'other@example.com' });

    const html = await (await fetch(`${baseUrl}/booking`)).text();
    assert.doesNotMatch(html, /ילד אחר/, "another family's child appeared on a public page");
    assert.doesNotMatch(html, /other@example\.com/, 'an email address leaked to an anonymous visitor');
    assert.ok(theirs.portal.code);
  } finally { await stop(); }
});

test('a student session gets the ordinary blank form, not a prefilled one', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    const parentCookie = await familySession(first.portal.link);
    const share = await (await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ code: first.portal.code }),
    })).json();
    const childCookie = await familySession(share.link);

    // Booking and paying for lessons is the account holder's action. A
    // self-paying adult holds an account session, so they are unaffected.
    const html = await (await fetch(`${baseUrl}/booking`, { headers: { Cookie: childCookie } })).text();
    assert.doesNotMatch(html, /orit@example\.com/, "a child's device must not carry the account's email");
    assert.doesNotMatch(html, /יובל כהן/, "a student session must not carry the family's roster");
  } finally { await stop(); }
});

test('booking again for a known child reuses the student, and charges the new plan', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);

    // What the accelerated form posts once a child's card is tapped — which
    // only a SIGNED-IN parent sees: the same name, subject and level,
    // carried rather than retyped.
    const session = await familySession(first.portal.link);
    const again = await book(baseUrl, {
      durationMin: 45,
      start: '2027-05-20T10:00:00+02:00', end: '2027-05-20T10:45:00+02:00',
    }, { Cookie: session });

    assert.equal(again.portal.code, first.portal.code, 'the same child, not a second record');
    assert.equal(again.portal.isNewFamily, false);

    const cookie = await familySession(first.portal.link);
    const data = await (await fetch(`${baseUrl}/api/portal/${first.portal.code}?kind=parent`, {
      headers: { Cookie: cookie },
    })).json();

    assert.equal(data.charges.length, 2, 'each booking carries its own charge');
    assert.equal(data.balance.upcomingAgorot, 21500 + 12000, '₪215 + ₪120');
  } finally { await stop(); }
});
