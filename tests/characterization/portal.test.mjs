// tests/characterization/portal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startServer, login, familySession } from './harness.mjs';

// The denial body changed with the access model: there is no pin to be
// wrong about any more. See 'family-session-portal' in expected-changes.mjs.
const DENIED = { status: 401, body: { error: 'אין גישה לדף הזה' } };

const SLOT = { start: '2027-05-11T10:00:00+02:00', end: '2027-05-11T10:45:00+02:00' };

/** Books a family in through the front door and returns their handoff. */
async function bookFamily(baseUrl, over = {}) {
  const r = await fetch(`${baseUrl}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'ילד בדיקה', subject: 'מתמטיקה', level: 'כיתה י',
      phone: '0501234567', email: 'kid@example.com', durationMin: 45,
      ...SLOT, ...over,
    }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).portal;
}

async function createStudent(baseUrl, cookie, code = 'testkid') {
  const r = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code, name: 'ילד בדיקה', subject: 'מתמטיקה', level: 'כיתה י' }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).student;
}

test('every failure mode of /api/portal answers identically', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await createStudent(baseUrl, cookie, 'testkid');

    // A real family, so "another family's student" is a case that exists.
    const other = await bookFamily(baseUrl, { name: 'אחר', email: 'other@example.com' });
    const otherCookie = await familySession(other.link);

    const cases = {
      'invalid code format':   [`${baseUrl}/api/portal/BAD_CODE`, {}],
      'nonexistent student':   [`${baseUrl}/api/portal/nosuchkid`, {}],
      'no session at all':     [`${baseUrl}/api/portal/testkid`, {}],
      'a forged cookie':       [`${baseUrl}/api/portal/testkid`, { Cookie: 'maab_family=a.1.99999999999999.forged' }],
      "another family's kid":  [`${baseUrl}/api/portal/testkid`, { Cookie: otherCookie }],
    };

    for (const [label, [url, headers]] of Object.entries(cases)) {
      const r = await fetch(url, { headers });
      assert.equal(r.status, DENIED.status, `${label}: status`);
      assert.deepEqual(await r.json(), DENIED.body, `${label}: body`);
    }
  } finally { await stop(); }
});

test('a student session reaches its own board but not the parent view', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const portal = await bookFamily(baseUrl);
    const parentCookie = await familySession(portal.link);

    // The parent mints the child's own link, exactly as their portal does.
    const shareRes = await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ code: portal.code }),
    });
    assert.equal(shareRes.status, 200);
    const share = await shareRes.json();
    const childCookie = await familySession(share.link);

    const own = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: childCookie } });
    assert.equal(own.status, 200, 'a child must reach their own board');

    // This is the separation the PRD left open ("הפין משותף להורה+תלמיד —
    // זה מכוון או שצריך הפרדה?"). One shared pin could not express it.
    const parentView = await fetch(`${baseUrl}/api/portal/${portal.code}?kind=parent`, { headers: { Cookie: childCookie } });
    assert.equal(parentView.status, 401, 'a child must not reach the parent view of their own record');

    // Nor may a child mint links — including their own, to a wider audience.
    const reshare = await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: childCookie },
      body: JSON.stringify({ code: portal.code }),
    });
    assert.equal(reshare.status, 401);
  } finally { await stop(); }
});

test('a join code admits a child once and never again', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const portal = await bookFamily(baseUrl);
    const parentCookie = await familySession(portal.link);
    const share = await (await fetch(`${baseUrl}/api/student-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: parentCookie },
      body: JSON.stringify({ code: portal.code }),
    })).json();

    const redeem = body => fetch(`${baseUrl}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // Typed the way a child would: lowercase, with the display hyphen.
    const first = await redeem({ code: share.joinCode.toLowerCase() });
    assert.equal(first.status, 200);
    assert.equal((await first.json()).code, portal.code);
    assert.ok(first.headers.getSetCookie().some(c => c.startsWith('maab_family=')));

    const second = await redeem({ code: share.joinCode });
    assert.equal(second.status, 401, 'a spent code must not admit a second device');

    const bogus = await redeem({ code: 'ZZZZZZ' });
    assert.equal(bogus.status, 401);
    // Unknown and spent must be indistinguishable, or the codespace becomes
    // walkable: a different message would say "right code, wrong moment".
    assert.deepEqual(await bogus.json(), await second.json());
  } finally { await stop(); }
});

test('the roster is tutor-only, and never carries a credential', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await createStudent(baseUrl, cookie, 'testkid');

    // It used to be open, and it returned every enrolled child's name with
    // the code that addressed their page — rendered to anonymous visitors
    // on /app/parent. See 'roster-requires-tutor' in expected-changes.mjs.
    const anonymous = await fetch(`${baseUrl}/api/portal-students`);
    assert.equal(anonymous.status, 401);

    const r = await fetch(`${baseUrl}/api/portal-students`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const { students } = await r.json();
    assert.ok(students.length >= 1);
    for (const s of students) {
      assert.deepEqual(Object.keys(s).sort(), ['code', 'name']);
      assert.ok(!('student_pin' in s) && !('parent_pin' in s) && !('password' in s) && !('credential' in s));
    }
  } finally { await stop(); }
});

test('a portal file missing name does not silently drop new-shape entries', async () => {
  const { baseUrl, dataDir, stop } = await startServer();
  try {
    const portal = await bookFamily(baseUrl, { name: 'ללא שם' });
    const cookie = await familySession(portal.link);

    // Overwrite the portal file with one that has no `name` — enroll.ts's
    // writePortalFile always sets one, so this simulates corrupted or
    // hand-edited data, not anything the app itself would ever write.
    const file = join(dataDir, 'portal', `${portal.code}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      subject: 'מתמטיקה', level: 'כיתה י',
      games: [{ title: 'משחק', template: 'memory', dataId: 'x-memory' }],
    }));

    const r = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: cookie } });
    // A portal file with no `name` fails the route's shape contract — there
    // is nothing to render as the child's display name — so it is rejected
    // before the games array is even touched: a visible 500, not a 200 that
    // silently omits or malforms the display. Ruling P13. See the
    // 'nameless-portal-file' entry in expected-changes.mjs.
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'קובץ הדף פגום' });
  } finally { await stop(); }
});

test('a portal game link carries the student code, not the Hebrew display name', async () => {
  const { baseUrl, dataDir, stop } = await startServer();
  try {
    // The name is deliberately distinctive (and would be trivially visible
    // in a URL if it leaked) so an assertion against it cannot pass by
    // accident.
    const displayName = 'ילד עם שם מזוהה';
    const portal = await bookFamily(baseUrl, { name: displayName });
    const cookie = await familySession(portal.link);

    // Same technique as the nameless-portal-file test above: overwrite the
    // portal file enroll.ts wrote with one carrying a new-shape ({title,
    // template, dataId}) game entry, whose url the route derives at read
    // time via urls.ts's gameUrl (see normalizeGameLike in
    // src/routes/api/portal/[code]/+server.ts).
    const file = join(dataDir, 'portal', `${portal.code}.json`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({
      name: displayName,
      subject: 'מתמטיקה', level: 'כיתה י',
      games: [{ title: 'משחק', template: 'memory', dataId: 'x-memory' }],
    }));

    const r = await fetch(`${baseUrl}/api/portal/${portal.code}`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const { games } = await r.json();
    assert.equal(games.length, 1);

    // The headline change this branch makes: links are minted from the
    // student's stable code, never from the Hebrew display name a portal
    // file happens to carry. A revert back to normalizeGameLike(g, data.name)
    // would put the display name here instead, and two children sharing a
    // name would again collide on write — see results.ts's header comment.
    const url = new URL(games[0].url, baseUrl);
    assert.equal(url.searchParams.get('s'), portal.code);
    assert.ok(
      !games[0].url.includes(displayName),
      `game link must not carry the Hebrew display name, got: ${games[0].url}`,
    );
  } finally { await stop(); }
});

test('requesting a link answers the same for a known and an unknown address', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    await bookFamily(baseUrl, { email: 'known@example.com' });

    const ask = email => fetch(`${baseUrl}/api/request-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    const known = await ask('known@example.com');
    const unknown = await ask('nobody@example.com');

    // Any difference here — status, body, or which one errors — turns this
    // endpoint into a way to check whether a given family uses the tutor.
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await known.json(), await unknown.json());

    // A malformed address is about the request, not about who exists, so it
    // may be answered differently.
    const bad = await ask('not-an-address');
    assert.equal(bad.status, 400);
  } finally { await stop(); }
});

test('students list requires a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/students`);
    assert.equal(r.status, 401);
  } finally { await stop(); }
});
