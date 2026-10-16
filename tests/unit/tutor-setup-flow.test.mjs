// tests/unit/tutor-setup-flow.test.mjs
//
// The round trip a tutor makes: start (to Google) and finish (back from it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tflow-')), 'results.db');
const F = await import('../../src/lib/server/tutor-setup-flow.ts');
const S = await import('../../src/lib/server/tutor-setup.ts');
const E = await import('../../src/lib/server/entities.ts');

const CLIENT = { clientId: 'cid.example', clientSecret: 'shh', redirectUri: 'https://site.example/app/tutor-setup/callback' };
const ROOM = 'https://meet.google.com/abc-defg-hij';
const NOW = Date.parse('2027-01-10T10:00:00Z');
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

function fakeGoogle({ room = { status: 200, body: { meetingUri: ROOM } }, scope = 'openid https://www.googleapis.com/auth/meetings.space.created' } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const pick = u.includes('/token') ? { status: 200, body: { access_token: 'at', scope, id_token: idToken({ email: 'tutor@example.com' }) } }
      : u.includes('meet.googleapis.com') ? room : { status: 200, body: {} };
    return new Response(JSON.stringify(pick.body), { status: pick.status });
  };
  return { fetchImpl, calls };
}

/** A teacher with a live link, already sent off to Google. */
function started(name) {
  const t = E.createTeacher({ name });
  const code = S.mintSetupCode(t.id, NOW);
  const s = F.startSetup(code, CLIENT, NOW);
  const state = new URL(s.location).searchParams.get('state');
  return { t, code, cookie: s.cookie, state };
}

test('start sends a live code to Google with a cookie whose nonce is the state', () => {
  const { t, code, cookie, state } = started('מורה 1');
  assert.ok(state);
  assert.deepEqual(S.readSetupCookie(cookie, NOW), { kind: 'started', teacherId: t.id, code, nonce: state });
});

test('start sends anything else back to the setup page, with no cookie', () => {
  const t = E.createTeacher({ name: 'מורה 2' });
  const code = S.mintSetupCode(t.id, NOW);
  assert.deepEqual(F.startSetup('not-a-code', CLIENT, NOW), { location: '/app/tutor-setup/not-a-code', cookie: null });
  assert.deepEqual(F.startSetup(code, null, NOW), { location: `/app/tutor-setup/${code}`, cookie: null }, 'client unset');
  assert.deepEqual(F.startSetup(null, CLIENT, NOW), { location: '/app/tutor-setup/', cookie: null });
});

test('finish saves the room and account, uses the code up, and leaves a done cookie', async () => {
  const { t, code, cookie, state } = started('מורה 3');
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.equal(r.location, F.DONE_PATH);
  assert.deepEqual(S.readSetupCookie(r.cookie, NOW), { kind: 'done', teacherId: t.id });
  const row = E.getTeacher(t.id);
  assert.equal(row.meet_url, ROOM);
  assert.equal(row.meet_account, 'tutor@example.com');
  assert.equal(S.teacherForCode(code, NOW), null);
});

test('a finished setup replayed shows success and calls Google no more', async () => {
  const { cookie, state } = started('מורה 4');
  const first = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, fakeGoogle().fetchImpl, NOW);
  const g = fakeGoogle();
  const again = await F.finishSetup({ cookie: first.cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(again, { location: F.DONE_PATH, cookie: first.cookie });
  assert.equal(g.calls.length, 0);
});

test('denied at Google: back to the page with the button; the code still works', async () => {
  const { t, code, cookie, state } = started('מורה 5');
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: null, error: 'access_denied' }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=denied`, cookie: null });
  assert.equal(g.calls.length, 0);
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
});

test('a Google failure keeps the link and saves nothing', async () => {
  const { t, code, cookie, state } = started('מורה 6');
  const g = fakeGoogle({ room: { status: 200, body: { meetingUri: 'https://evil.example/x' } } });
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=google`, cookie: null });
  assert.equal(E.getTeacher(t.id).meet_url, null);
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
});

test('a code replaced mid-flow saves nothing and calls nothing', async () => {
  const { t, code, cookie, state } = started('מורה 7');
  S.mintSetupCode(t.id, NOW); // the owner sends a newer link meanwhile
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}`, cookie: null });
  assert.equal(g.calls.length, 0);
  assert.equal(E.getTeacher(t.id).meet_url, null);
});

test('no cookie, a wrong state, or no client ends on the done page as not completed', async () => {
  const { cookie, state } = started('מורה 8');
  const g = fakeGoogle();
  for (const [input, client] of [
    [{ cookie: undefined, state, authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state: 'other', authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state: null, authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state, authCode: 'ac', error: null }, null],
  ]) {
    assert.deepEqual(await F.finishSetup(input, client, g.fetchImpl, NOW), { location: F.DONE_PATH, cookie: null });
  }
  assert.equal(g.calls.length, 0);
});

test('the Meet box left unticked: back to the page with its own message; the code still works', async () => {
  const { t, code, cookie, state } = started('מורה 9');
  const g = fakeGoogle({ scope: 'openid' });
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=scope`, cookie: null });
  assert.equal(E.getTeacher(t.id).meet_url, null);
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
});

/* ── Races, found by the branch review of #47 ─────────────────────────── */

test('a link re-sent while Google is answering: no room saved, and the newer link keeps working', async () => {
  const { t, code, cookie, state } = started('מורה 10');
  let newer;
  const g = fakeGoogle();
  const racing = async (url, init) => {
    if (String(url).includes('meet.googleapis.com')) newer = S.mintSetupCode(t.id, NOW); // the owner taps again
    return g.fetchImpl(url, init);
  };
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, racing, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}`, cookie: null });
  assert.equal(E.getTeacher(t.id).meet_url, null);
  assert.equal(S.teacherForCode(newer, NOW).id, t.id);
});

test('a second callback after the first saved the room shows success, and calls Google no more', async () => {
  const { t, cookie, state } = started('מורה 11');
  await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, fakeGoogle().fetchImpl, NOW);
  const g = fakeGoogle();
  // The reloaded tab still carries the started cookie: the first answer never reached it.
  const again = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.equal(again.location, F.DONE_PATH);
  assert.deepEqual(S.readSetupCookie(again.cookie, NOW), { kind: 'done', teacherId: t.id });
  assert.equal(g.calls.length, 0);
});

test('a second callback whose code exchange loses the race still ends on success once the first saved', async () => {
  const { t, code, cookie, state } = started('מורה 12');
  const firstSaves = async (url) => {
    // The first request finishes while this one is exchanging the same, now spent, code.
    S.completeSetup(t.id, code, ROOM, 'tutor@example.com');
    return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  };
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, firstSaves, NOW);
  assert.equal(r.location, F.DONE_PATH);
  assert.deepEqual(S.readSetupCookie(r.cookie, NOW), { kind: 'done', teacherId: t.id });
});

test('a failure saving the room is logged as that, not as Google', async (t) => {
  const { t: teacher, code, cookie, state } = started('מורה 13');
  const { handle } = await import('../../src/lib/server/db.ts');
  handle().exec(`CREATE TRIGGER no_save BEFORE UPDATE OF meet_url ON teachers WHEN NEW.id = ${teacher.id}
                 BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  const warn = t.mock.method(console, 'warn', () => {});
  try {
    const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, fakeGoogle().fetchImpl, NOW);
    assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=google`, cookie: null });
    const logged = warn.mock.calls.map((c) => String(c.arguments[0])).join('\n');
    assert.match(logged, /saving the room failed/);
    assert.doesNotMatch(logged, /google unreachable/);
  } finally {
    handle().exec(`DROP TRIGGER no_save`);
  }
});
