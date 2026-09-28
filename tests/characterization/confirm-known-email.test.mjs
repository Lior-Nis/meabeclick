// tests/characterization/confirm-known-email.test.mjs
//
// A booking with a known family's email, made without being signed in as
// that family, waits for the family to confirm it from their inbox — Todoist
// 6hfCvXjvFw5RJgmq, designed in
// docs/superpowers/specs/2026-09-28-confirm-known-email-booking-design.md.
// Before this, anyone who knew a parent's email could put a child, a lesson
// and a charge on that family's page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login, familySession } from './harness.mjs';

const SECRET = 'test-secret-not-a-real-one';
const confirmToken = (id, expMs) => {
  const payload = `p.${id}.${expMs}`;
  return `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};

const book = (baseUrl, { name, email, day, cookie }) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify({
    name, subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567', email, durationMin: 90,
    start: `2027-11-${day}T10:00:00+02:00`, end: `2027-11-${day}T11:30:00+02:00`,
  }),
});

function db(dbPath) { return new DatabaseSync(dbPath); }
const childrenOf = (dbPath, email) => db(dbPath).prepare(
  'SELECT s.name FROM students_v2 s JOIN accounts a ON a.id = s.account_id WHERE a.email = ? ORDER BY s.id',
).all(email).map(r => r.name);
const lastHold = (dbPath) => db(dbPath).prepare('SELECT id, expires_at, status FROM pending_bookings ORDER BY id DESC LIMIT 1').get();

async function familyAndStranger(baseUrl, dbPath) {
  const first = await (await book(baseUrl, { name: 'נוגה', email: 'cohen@example.com', day: '01' })).json();
  const parent = await familySession(first.portal.link);
  const res = await book(baseUrl, { name: 'זר', email: 'cohen@example.com', day: '02' });
  return { parent, res, body: await res.json() };
}

test("a booking with a known family's email, not signed in, is held — nothing lands on their page", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const { res, body } = await familyAndStranger(baseUrl, dbPath);
    assert.equal(res.status, 200);
    assert.equal(body.awaitingConfirmation, true);
    assert.equal(body.portal, undefined, 'no way into the family');
    assert.deepEqual(childrenOf(dbPath, 'cohen@example.com'), ['נוגה'], 'no stranger in the family');
    assert.equal(lastHold(dbPath).status, 'pending');

    const again = await book(baseUrl, { name: 'אחר', email: 'other@example.com', day: '02' });
    assert.equal(again.status, 409, 'the held hour is taken');
  } finally { await stop(); }
});

test('the family confirms from the email: opening the link shows it, the button books it', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await familyAndStranger(baseUrl, dbPath);
    const hold = lastHold(dbPath);
    const t = confirmToken(hold.id, Date.parse(hold.expires_at));

    const page = await fetch(`${baseUrl}/confirm-booking?t=${encodeURIComponent(t)}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /זר/, 'names the child');
    assert.equal(lastHold(dbPath).status, 'pending', 'opening the link confirms nothing: mail scanners open links');

    const confirmed = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: t }),
    });
    assert.equal(confirmed.status, 200);
    const cookie = confirmed.headers.getSetCookie().find(c => c.startsWith('maab_family='));
    assert.ok(cookie, 'the confirming device is signed in to the family');
    assert.deepEqual(childrenOf(dbPath, 'cohen@example.com'), ['נוגה', 'זר']);
    assert.equal(lastHold(dbPath).status, 'confirmed');

    const twice = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: t }),
    });
    assert.equal(twice.status, 410, 'once only');
  } finally { await stop(); }
});

test('a forged or unknown confirmation is refused, and its page says so', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'p.1.9999999999999.forged' }),
    });
    assert.equal(r.status, 410);
    const page = await fetch(`${baseUrl}/confirm-booking?t=nope`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /הקישור לא תקף/);
  } finally { await stop(); }
});

test('signed in as that family, or as the tutor, a booking books at once', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const first = await (await book(baseUrl, { name: 'נוגה', email: 'levi@example.com', day: '03' })).json();
    const parent = await familySession(first.portal.link);
    const own = await (await book(baseUrl, { name: 'אלון', email: 'levi@example.com', day: '04', cookie: parent })).json();
    assert.equal(own.awaitingConfirmation, undefined);
    assert.ok(own.portal, 'the family itself gets its link, as before');

    const tutor = await login(baseUrl);
    const byTutor = await (await book(baseUrl, { name: 'מאיה', email: 'levi@example.com', day: '05', cookie: tutor })).json();
    assert.equal(byTutor.awaitingConfirmation, undefined);
    assert.deepEqual(childrenOf(dbPath, 'levi@example.com'), ['נוגה', 'אלון', 'מאיה']);
  } finally { await stop(); }
});
