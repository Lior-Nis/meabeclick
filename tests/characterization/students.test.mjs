// tests/characterization/students.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startServer, login, familySession } from './harness.mjs';

// /api/game-result requires a `t=<hmac>` signature over {dataId, student}
// — see the `todoist-6hJh32VVc5VH2jVq` entry in expected-changes.mjs. The
// pre-migration Express handler (server/app.mjs, deleted in Task 24) never
// checked a signature at all.

// Mirrors the private `sign()` in src/lib/server/urls.ts, keyed with the
// SESSION_SECRET harness.mjs sets for the spawned server.
const SESSION_SECRET = 'test-secret-not-a-real-one';
function signGameResult(dataId, student) {
  const msg = `${dataId.length}:${dataId}|${student.length}:${student}`;
  return createHmac('sha256', SESSION_SECRET).update(msg).digest('base64url');
}

test('creating a student rejects a non-slug code', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'Bad Code', name: 'שם' }),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'הקוד חייב להיות באנגלית קטנה, בלי רווחים' });
  } finally { await stop(); }
});

test('a student added without a code gets one that says nothing about them', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const r = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body: JSON.stringify({ name: 'נועם', email: 'noam2@example.com' }) });
    assert.equal(r.status, 200);
    const { student } = await r.json();
    assert.match(student.code, /^[0-9b-z]{8}$/, 'generated, like a booking\'s: not the child\'s name in a forwarded URL');

    const nameless = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body: JSON.stringify({ code: 'x-y-z' }) });
    assert.equal(nameless.status, 400);
  } finally { await stop(); }
});

test('creating a duplicate code is rejected', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const body = JSON.stringify({ code: 'dana', name: 'דנה' });
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const first = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'הקוד הזה כבר תפוס' });
  } finally { await stop(); }
});

test('a student added by hand is reachable by a link, not a password', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'noam', name: 'נועם', email: 'noam@example.com' }),
    });
    assert.equal(r.status, 200);
    const { student } = await r.json();

    // Nothing has a password any more, so "always gets one so they are not
    // locked out" became "the tutor can always mint a link". See
    // 'no-family-passwords' in expected-changes.mjs.
    assert.ok(!('password' in student), 'a student record must not carry a password');

    const linkRes = await fetch(`${baseUrl}/api/students/${student.code}/link`, {
      method: 'POST', headers: { Cookie: cookie },
    });
    assert.equal(linkRes.status, 200);
    const links = await linkRes.json();
    assert.ok(links.familyLink.includes('/enter?t='), 'the tutor must be able to hand over a family link');
    assert.ok(links.studentLink.includes('/enter?t='));
    assert.match(links.joinCode, /^[A-Z0-9]{3}-[A-Z0-9]{3}$/);

    // And that link actually opens the student's page.
    const cookie2 = await familySession(links.familyLink);
    const portal = await fetch(`${baseUrl}/api/portal/${student.code}`, { headers: { Cookie: cookie2 } });
    assert.equal(portal.status, 200);
  } finally { await stop(); }
});

test('game-result never fails loudly, even on a storage problem', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const dataId = 'x-quiz', student = 'דנה';
    const r = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student, dataId, template: 'quiz', score: 5, total: 6,
        t: signGameResult(dataId, student),
      }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  } finally { await stop(); }
});

test('game-result rejects an empty student name', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: '   ' }),
    });
    assert.equal(r.status, 400);
  } finally { await stop(); }
});

test('game-result rejects a truthy t with a missing dataId as 403, not a 500', async () => {
  // verifyGameSignature (src/lib/server/urls.ts) dereferences
  // dataId.length unconditionally once t is truthy — an anonymous POST
  // that supplies any truthy `t` but omits dataId must still get the same
  // clean 403 a bad signature gets, not an unhandled 500.
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: 'x', t: 'anything' }),
    });
    assert.equal(r.status, 403);
  } finally { await stop(); }
});

// This test used to assert the opposite — "lessons are readable
// unauthenticated but filterable by student" — and it was characterizing a
// leak, not a feature. With no ?student= the route returns the last 200
// lessons for EVERY family (names, subjects, levels, topics, lesson times,
// and the generation failure text) to any anonymous caller. Verified against
// production before changing: an unauthenticated GET returned a real
// student's record. The only consumer was always the tutor dashboard, which
// sends its session already.
test('the lessons feed is tutor-only', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const anon = await fetch(`${baseUrl}/api/lessons`);
    assert.equal(anon.status, 401);
    assert.deepEqual(await anon.json(), { error: 'unauthorized' });

    // A family session is not the tutor's: a parent must not get the roster
    // of every other family either.
    const booked = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'דנה כהן', subject: 'מתמטיקה', level: 'כיתה ט',
        phone: '0501234567', email: 'dana@example.com', durationMin: 90,
        start: '2027-08-02T10:00:00+03:00', end: '2027-08-02T11:30:00+03:00',
      }),
    });
    const family = await familySession((await booked.json()).portal.link);
    const asFamily = await fetch(`${baseUrl}/api/lessons`, { headers: { Cookie: family } });
    assert.equal(asFamily.status, 401, 'a family session must not open the tutor feed');

    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/lessons?student=דנה כהן`, { headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray((await r.json()).lessons));
  } finally { await stop(); }
});

test("an anonymous caller cannot read any family's name from the lessons feed", async () => {
  // The concrete harm, asserted on rather than implied by a status code: a
  // real booking, then a check that nothing about it is reachable without a
  // session — including through the ?student= filter, which was previously
  // the documented way in.
  const { baseUrl, stop } = await startServer();
  try {
    await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'ילד פרטי', subject: 'פיזיקה', level: 'כיתה ז',
        phone: '0509998888', email: 'private@example.com', durationMin: 45,
        start: '2027-08-03T10:00:00+03:00', end: '2027-08-03T10:45:00+03:00',
      }),
    });

    for (const path of ['/api/lessons', '/api/lessons?student=ילד פרטי']) {
      const r = await fetch(`${baseUrl}${path}`);
      assert.equal(r.status, 401, `${path} answered ${r.status}`);
      assert.doesNotMatch(await r.text(), /ילד פרטי/, `${path} leaked a student name`);
    }
  } finally { await stop(); }
});
