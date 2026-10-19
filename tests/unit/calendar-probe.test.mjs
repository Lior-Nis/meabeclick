/**
 * The calendar probe: proof that a service-account key can write lessons.
 *
 * scripts/connect-calendar.sh swaps the key the site's calendar robot signs
 * in with, and it swaps only after this probe has written and deleted a
 * test event with the new key. So the probe is the gate between "a key
 * file arrived" and "every booking now signs in with it": a probe that
 * passes on a key Google would refuse, or that leaves its test event
 * behind silently, would let a broken swap through or litter the lesson
 * calendar. Google is faked here; nothing touches the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const { probeCalendarWrite, SCOPE } = await import('../../scripts/calendar-probe.mjs');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = {
  type: 'service_account',
  client_email: 'calendar-writer@example-project.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
};
const CALENDAR = 'lessons#1@group.calendar.google.com';
const EVENTS = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR)}/events`;

/** A fake Google. `answers` overrides the reply per step; every call is recorded. */
function fakeGoogle(answers = {}) {
  const calls = [];
  const reply = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url: String(url), method, body: init.body });
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return answers.token ?? reply(200, { access_token: 'tok', expires_in: 3600 });
    }
    if (method === 'POST' && String(url) === EVENTS) {
      return answers.insert ?? reply(200, { id: 'evt123' });
    }
    if (method === 'DELETE' && String(url) === `${EVENTS}/evt123`) {
      return answers.remove ?? reply(204, null);
    }
    return reply(500, { error: `unexpected ${method} ${url}` });
  };
  return { calls, fetchImpl };
}

test('writes one test event and deletes that same event', async () => {
  const g = fakeGoogle();
  const robot = await probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl });
  assert.equal(robot, KEY.client_email);
  assert.deepEqual(g.calls.map(c => `${c.method} ${c.url}`), [
    'POST https://oauth2.googleapis.com/token',
    `POST ${EVENTS}`,
    `DELETE ${EVENTS}/evt123`,
  ]);
  const del = g.calls[2];
  assert.equal(del.body, undefined);
});

test('signs in as the key\'s robot, asking only to write events', async () => {
  const g = fakeGoogle();
  const now = new Date('2026-10-17T10:00:00Z');
  await probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl, now });
  const form = new URLSearchParams(g.calls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, payload, signature] = form.get('assertion').split('.');
  const verify = createVerify('RSA-SHA256');
  verify.update(`${header}.${payload}`);
  assert.ok(verify.verify(publicKey, signature, 'base64url'), 'the assertion is signed with the key');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  assert.equal(claims.iss, KEY.client_email);
  assert.equal(claims.scope, SCOPE);
  assert.equal(SCOPE, 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.iat, Math.floor(now.getTime() / 1000));
  assert.equal(claims.exp, claims.iat + 3600);
});

test('the test event can never block a lesson slot', async () => {
  const g = fakeGoogle();
  await probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl });
  const event = JSON.parse(g.calls[1].body);
  // Dated long before any booking window, and marked free, so even a copy
  // left behind is invisible to availability.
  assert.ok(new Date(event.end.dateTime) < new Date('2001-01-01T00:00:00Z'));
  assert.equal(event.transparency, 'transparent');
  assert.match(event.summary, /אפשר למחוק/);
});

test('a calendar not shared with the robot says so, and deletes nothing', async () => {
  const g = fakeGoogle({ insert: new Response('{"error":{"code":404,"message":"Not Found"}}', { status: 404 }) });
  await assert.rejects(
    probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl }),
    err => /write/.test(err.message)
      && err.message.includes('404')
      && err.message.includes(KEY.client_email)
      && /make changes to events/i.test(err.message),
  );
  assert.equal(g.calls.filter(c => c.method === 'DELETE').length, 0);
});

test('a key Google refuses stops before touching the calendar', async () => {
  const g = fakeGoogle({ token: new Response('{"error":"invalid_grant"}', { status: 400 }) });
  await assert.rejects(
    probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl }),
    /sign-in.*400.*invalid_grant/,
  );
  assert.equal(g.calls.length, 1);
});

test('a test event left behind is reported, not swallowed', async () => {
  const g = fakeGoogle({ remove: new Response('backend error', { status: 503 }) });
  await assert.rejects(
    probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl }),
    err => /delete/.test(err.message) && err.message.includes('503') && err.message.includes('evt123'),
  );
});

test('an event Google already removed counts as deleted', async () => {
  const g = fakeGoogle({ remove: new Response(null, { status: 410 }) });
  assert.equal(await probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl }), KEY.client_email);
});

test('a file that is not a service-account key is refused before any network call', async () => {
  const g = fakeGoogle();
  for (const key of [{}, { client_email: KEY.client_email }, { installed: { client_id: 'x' } }]) {
    await assert.rejects(
      probeCalendarWrite({ key, calendarId: CALENDAR, fetchImpl: g.fetchImpl }),
      /not a service-account key/,
    );
  }
  assert.equal(g.calls.length, 0);
});

test('the key never appears in an error', async () => {
  const g = fakeGoogle({ insert: new Response('{"error":"forbidden"}', { status: 403 }) });
  await assert.rejects(
    probeCalendarWrite({ key: KEY, calendarId: CALENDAR, fetchImpl: g.fetchImpl }),
    err => !err.message.includes('PRIVATE KEY') && !err.message.includes(KEY.private_key.slice(40, 80)),
  );
});
