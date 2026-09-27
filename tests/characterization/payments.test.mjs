import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, familySession, login } from './harness.mjs';

const booking = (over = {}) => ({
  name: 'דנה כהן', subject: 'מתמטיקה', level: 'כיתה י',
  phone: '0501234567', email: 'dana@example.com', durationMin: 90,
  start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  ...over,
});

const charges = (dbPath) => {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`SELECT * FROM payments ORDER BY id`).all();
  db.close();
  return rows;
};

test('a booking creates exactly one owed charge at the plan price', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);

    const rows = charges(dbPath);
    assert.equal(rows.length, 1, 'exactly one charge per booking');
    assert.equal(rows[0].amount_agorot, 21500, '₪215 for a 90-minute lesson, in agorot');
    assert.equal(rows[0].kind, 'double');
    assert.equal(rows[0].status, 'owed');
    assert.equal(rows[0].date, '2027-03-15', 'dated to the lesson, not to today');
    assert.ok(rows[0].booking_id, 'the charge must point at its booking');
  } finally { await stop(); }
});

test('a 135-minute lesson is recordable', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        durationMin: 135, end: '2027-03-15T12:15:00+02:00',
      })),
    });
    assert.equal(r.status, 200);

    const rows = charges(dbPath);
    assert.equal(rows[0].kind, 'triple');
    assert.equal(rows[0].amount_agorot, 30000);
  } finally { await stop(); }
});

test('losing the race creates no charge', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const post = email => fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ email })),
    });

    const [a, b] = await Promise.all([post('a@example.com'), post('b@example.com')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);

    assert.equal(charges(dbPath).length, 1, 'the loser must not be charged');
  } finally { await stop(); }
});

test('the parent sees a due balance for a lesson already given', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    // A lesson in the past: booked, given, unpaid.
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        start: '2026-01-05T10:00:00+02:00', end: '2026-01-05T11:30:00+02:00',
      })),
    });
    const { portal } = await r.json();
    const cookie = await familySession(portal.link);

    const res = await fetch(`${baseUrl}/api/portal/${portal.code}?kind=parent`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.balance.dueAgorot, 21500);
    assert.equal(data.balance.upcomingAgorot, 0);
    assert.equal(data.charges.length, 1);
  } finally { await stop(); }
});

test('a future lesson is upcoming, not due', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    const { portal } = await r.json();
    const cookie = await familySession(portal.link);

    const data = await (await fetch(`${baseUrl}/api/portal/${portal.code}?kind=parent`, { headers: { Cookie: cookie } })).json();
    assert.equal(data.balance.dueAgorot, 0, 'a lesson in 2027 is not owed today');
    assert.equal(data.balance.upcomingAgorot, 21500);
  } finally { await stop(); }
});

test('the payment endpoints are tutor-only', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    const { portal } = await r.json();
    const familyCookie = await familySession(portal.link);

    for (const headers of [{}, { Cookie: familyCookie }]) {
      assert.equal((await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers })).status, 401);
      // The widest blast radius on the branch: it aggregates across every
      // family, so one family's session reaching it would leak every other
      // family's totals.
      assert.equal((await fetch(`${baseUrl}/api/payments/all`, { headers })).status, 401);
      assert.equal((await fetch(`${baseUrl}/api/payments/mark`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ ids: [1], status: 'paid' }),
      })).status, 401);
    }
  } finally { await stop(); }
});

test('the tutor marks a charge paid, and can undo it', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ start: '2026-01-05T10:00:00+02:00', end: '2026-01-05T11:30:00+02:00' })),
    });
    const { portal } = await r.json();
    const cookie = await login(baseUrl);

    const listed = await (await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers: { Cookie: cookie } })).json();
    assert.equal(listed.charges.length, 1);
    assert.equal(listed.balance.dueAgorot, 21500);

    const id = listed.charges[0].id;
    const mark = status => fetch(`${baseUrl}/api/payments/mark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids: [id], status }),
    });

    assert.equal((await mark('paid')).status, 200);
    let after = await (await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.balance.dueAgorot, 0);
    assert.equal(after.balance.paidAgorot, 21500);

    // Ticking the wrong row is the common mistake, so it must be reversible.
    assert.equal((await mark('owed')).status, 200);
    after = await (await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.balance.dueAgorot, 21500);
  } finally { await stop(); }
});

test('a batch containing an unknown id writes nothing', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ start: '2026-01-05T10:00:00+02:00', end: '2026-01-05T11:30:00+02:00' })),
    });
    const { portal } = await r.json();
    const cookie = await login(baseUrl);
    const listed = await (await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers: { Cookie: cookie } })).json();

    const res = await fetch(`${baseUrl}/api/payments/mark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids: [listed.charges[0].id, 99999], status: 'paid' }),
    });
    assert.equal(res.status, 400, 'a partially applied batch on money is worse than none');

    const after = await (await fetch(`${baseUrl}/api/payments?student=${portal.code}`, { headers: { Cookie: cookie } })).json();
    assert.equal(after.balance.dueAgorot, 21500, 'nothing may have been written');
  } finally { await stop(); }
});

test('marking one child\'s charge paid does not touch a sibling\'s charge', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    // Same email, different names: one account, two students — the shape
    // the dashboard's picked-across-panels bug needed to prove safe.
    const bookFor = (name, start, end, cookie) => fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(booking({ name, email: 'dana@example.com', start, end })),
    });

    const r1 = await bookFor('דנה כהן', '2026-01-05T10:00:00+02:00', '2026-01-05T11:30:00+02:00');
    const { portal: portal1 } = await r1.json();
    // The second child is booked by the parent, signed in.
    const parent = await familySession(portal1.link);
    const r2 = await bookFor('יובל כהן', '2026-01-06T10:00:00+02:00', '2026-01-06T11:30:00+02:00', parent);
    const { portal: portal2 } = await r2.json();
    assert.notEqual(portal1.code, portal2.code, 'two distinct students');

    const cookie = await login(baseUrl);
    const listed1 = await (await fetch(`${baseUrl}/api/payments?student=${portal1.code}`, { headers: { Cookie: cookie } })).json();

    const res = await fetch(`${baseUrl}/api/payments/mark`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ ids: [listed1.charges[0].id], status: 'paid' }),
    });
    assert.equal(res.status, 200);

    const listed2 = await (await fetch(`${baseUrl}/api/payments?student=${portal2.code}`, { headers: { Cookie: cookie } })).json();
    assert.equal(listed2.charges[0].status, 'owed', 'the sibling charge must be untouched');
  } finally { await stop(); }
});

test('a booking whose duration has no plan is refused before it claims the hour', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    // 60 minutes is not a sold plan (45/90/135). It used to reserve the
    // hour, answer 200 and only console.error the missing price — a free
    // lesson that no screen would ever surface.
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({
        durationMin: 60, end: '2027-03-15T11:00:00+02:00',
      })),
    });
    assert.equal(r.status, 400);

    assert.equal(charges(dbPath).length, 0, 'an unpriceable booking must create no charge');

    const db = new DatabaseSync(dbPath);
    const booked = db.prepare(`SELECT COUNT(*) AS c FROM bookings_v2`).get().c;
    db.close();
    assert.equal(booked, 0, 'the hour must not have been claimed');
  } finally { await stop(); }
});
