// tests/characterization/booking-signs-in.test.mjs
//
// A family that has just booked is already signed in.
//
// The step this removes: booking collected a name, phone and email, created
// the account from them, and then handed the parent a LINK to click — on the
// same device, seconds later, to prove something they had just proved. It
// was the one piece of friction every new family met, and the reason signing
// up felt like work.
//
// The restriction that comes with it is the load-bearing part.
// enrollFromBooking matches an existing family by EMAIL ALONE, and /api/book
// is unauthenticated and CORS-open — so signing in whoever booked would let
// anyone who knows a family's email address book a lesson and land inside
// that family's portal, reading their children's homework and their
// outstanding balance. A session is issued only when the booking CREATED the
// account, which owns nothing the booker did not just create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

const book = (baseUrl, over = {}, cookie) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2028-01-10T10:00:00+02:00', end: '2028-01-10T11:30:00+02:00',
    ...over,
  }),
});

const familyCookie = (res) =>
  res.headers.getSetCookie().find(c => c.startsWith('maab_family='))?.split(';')[0];

test('a new family is signed in by the act of booking', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const res = await book(baseUrl);
    assert.equal(res.status, 200);

    const cookie = familyCookie(res);
    assert.ok(cookie, 'booking must issue the family session, not defer it to a link');

    // The session must actually open the board — a cookie that does not
    // authorise anything is the failure that looks fixed.
    const board = await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(board.status, 200, 'the issued session must open the parent board');
  } finally { await stop(); }
});

test("booking with a KNOWN family's email does not hand over their account", async () => {
  // THE security test. Accounts are matched by email alone, and this
  // endpoint takes anyone's POST. Without the accountCreated restriction,
  // this is a complete account takeover with no credential at all.
  const { baseUrl, stop } = await startServer();
  try {
    const first = await book(baseUrl);
    assert.ok(familyCookie(first), 'the genuine first booking is signed in');

    // Someone else books, using the same email address and nothing else.
    const attacker = await book(baseUrl, {
      name: 'ילד אחר', phone: '0509998888',
      start: '2028-01-11T10:00:00+02:00', end: '2028-01-11T11:30:00+02:00',
    });
    assert.equal(attacker.status, 200, 'the booking itself is still accepted');
    assert.equal(familyCookie(attacker), undefined,
      'a booking that did NOT create the account must not issue a session');
  } finally { await stop(); }
});

test('the handoff link still works, for the device that did not book', async () => {
  // Signing in the booker does not replace the link: it is how the other
  // parent, or the child, reaches the board from their own phone.
  const { baseUrl, stop } = await startServer();
  try {
    const res = await book(baseUrl);
    const { portal } = await res.json();
    assert.ok(portal?.link, 'the booking response still carries a link to share');

    const entered = await fetch(portal.link, { redirect: 'manual' });
    assert.ok(entered.headers.getSetCookie().some(c => c.startsWith('maab_family=')),
      'the shared link must still establish a session on another device');
  } finally { await stop(); }
});
