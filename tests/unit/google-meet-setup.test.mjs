// tests/unit/google-meet-setup.test.mjs
//
// The three Google calls that make a tutor's room, with Google simulated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../../src/lib/server/google-meet-setup.ts');
const CLIENT = { clientId: 'cid.example', clientSecret: 'shh', redirectUri: 'https://site.example/app/tutor-setup/callback' };
const ROOM = 'https://meet.google.com/abc-defg-hij';
// What Google's token response lists when the tutor allowed everything.
const GRANTED = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/meetings.space.created';
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/** A fake Google: one canned answer per endpoint, every call recorded. */
function fakeGoogle({
  token = { status: 200, body: { access_token: 'at-1', scope: GRANTED, id_token: idToken({ email: 'tutor@example.com' }) } },
  room = { status: 200, body: { meetingUri: ROOM, config: { accessType: 'TRUSTED' } } },
  revoke = { status: 200, body: {} },
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const pick = u.startsWith('https://oauth2.googleapis.com/token') ? token
      : u.startsWith('https://meet.googleapis.com/') ? room : revoke;
    if (pick instanceof Error) throw pick;
    return new Response(JSON.stringify(pick.body ?? {}), { status: pick.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

test('webClientFromEnv needs both values and the site', () => {
  const env = { GOOGLE_WEB_CLIENT_ID: 'cid', GOOGLE_WEB_CLIENT_SECRET: 's', SITE_URL: 'https://site.example/' };
  assert.deepEqual(G.webClientFromEnv(env), { clientId: 'cid', clientSecret: 's', redirectUri: 'https://site.example/app/tutor-setup/callback' });
  for (const k of Object.keys(env)) assert.equal(G.webClientFromEnv({ ...env, [k]: '' }), null, k);
});

test('the consent URL asks for the account and the room permission only, online', () => {
  const u = new URL(G.consentUrl(CLIENT, 'nonce-1'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.deepEqual(q, {
    client_id: 'cid.example', redirect_uri: CLIENT.redirectUri, response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/meetings.space.created',
    access_type: 'online', prompt: 'select_account consent', state: 'nonce-1',
  });
});

test('connectRoom exchanges, creates a room with Google\'s default access, revokes, and returns room and account', async () => {
  const g = fakeGoogle();
  assert.deepEqual(await G.connectRoom(CLIENT, 'auth-code', g.fetchImpl), { meetUrl: ROOM, account: 'tutor@example.com' });
  assert.deepEqual(g.calls.map((c) => c.url), [
    'https://oauth2.googleapis.com/token',
    'https://meet.googleapis.com/v2/spaces',
    'https://oauth2.googleapis.com/revoke',
  ]);
  const ex = new URLSearchParams(String(g.calls[0].init.body));
  assert.equal(ex.get('code'), 'auth-code');
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('redirect_uri'), CLIENT.redirectUri);
  assert.equal(g.calls[1].init.headers.Authorization, 'Bearer at-1');
  // A personal account may not set accessType (403 "updateAccessType is not
  // available to the user", spike 2026-10-16); its default is TRUSTED.
  assert.deepEqual(JSON.parse(g.calls[1].init.body), {});
  assert.equal(new URLSearchParams(String(g.calls[2].init.body)).get('token'), 'at-1');
});

test('a failed exchange is a token failure and creates nothing', async () => {
  const g = fakeGoogle({ token: { status: 400, body: { error: 'invalid_grant', error_description: 'echo of secrets' } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) =>
    e instanceof G.GoogleStepError && e.step === 'token' && e.status === 400 && !/echo/.test(e.message));
  assert.equal(g.calls.length, 1);
});

test('a refused room is a room failure, and the permission is still revoked', async () => {
  const g = fakeGoogle({ room: { status: 403, body: { error: { message: 'nope' } } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e.step === 'room' && e.status === 403);
  assert.equal(g.calls.at(-1).url, 'https://oauth2.googleapis.com/revoke');
});

test('a room without a Meet https link is a room failure', async () => {
  for (const meetingUri of [undefined, '', 'http://meet.google.com/abc-defg-hij', 'https://evil.example/abc']) {
    const g = fakeGoogle({ room: { status: 200, body: { meetingUri } } });
    await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e.step === 'room', String(meetingUri));
  }
});

test('revoke failing does not lose the room', async () => {
  for (const revoke of [{ status: 500, body: {} }, new TypeError('fetch failed')]) {
    const g = fakeGoogle({ revoke });
    assert.equal((await G.connectRoom(CLIENT, 'c', g.fetchImpl)).meetUrl, ROOM);
  }
});

test('the account is read from the id_token, and its absence is not an error', () => {
  assert.equal(G.emailFromIdToken(idToken({ email: 'a@example.com' })), 'a@example.com');
  for (const bad of [undefined, '', 'x', 'h.%%%.s', idToken({})]) assert.equal(G.emailFromIdToken(bad), null);
});

test('a token without the Meet permission (box left unticked) is a scope failure: no room, token revoked', async () => {
  const g = fakeGoogle({ token: { status: 200, body: { access_token: 'at-1', scope: 'openid https://www.googleapis.com/auth/userinfo.email' } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e instanceof G.GoogleStepError && e.step === 'scope');
  assert.deepEqual(g.calls.map((c) => c.url), ['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/revoke']);
});

test('a room that comes back open to anyone is refused, so families always knock', async () => {
  const g = fakeGoogle({ room: { status: 200, body: { meetingUri: ROOM, config: { accessType: 'OPEN' } } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e.step === 'room');
  assert.equal(g.calls.at(-1).url, 'https://oauth2.googleapis.com/revoke');
});
