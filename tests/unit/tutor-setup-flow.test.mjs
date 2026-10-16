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

function fakeGoogle({ room = { status: 200, body: { meetingUri: ROOM } } } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const pick = u.includes('/token') ? { status: 200, body: { access_token: 'at', id_token: idToken({ email: 'tutor@example.com' }) } }
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
