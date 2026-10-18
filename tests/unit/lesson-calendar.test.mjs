// tests/unit/lesson-calendar.test.mjs
//
// The robot writes a lesson into the calendar it is given — each tutor has
// their own (migration 029). Google is faked; the key is made up here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { insertLessonEvent } from '../../src/lib/server/lesson-calendar.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const SA = { email: 'robot@example-project.iam.gserviceaccount.com', privateKey };

function fakeGoogle(answers) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const a = answers.shift();
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status });
  };
  return { calls, fetchImpl };
}

test('the event goes into the calendar it is given, signed in as the robot', async () => {
  const g = fakeGoogle([{ status: 200, body: { access_token: 'tok' } }, { status: 200, body: { id: 'evt1' } }]);
  const event = { summary: 'שיעור' };
  const created = await insertLessonEvent(SA, 'lior-lessons@group.calendar.google.com', event, g.fetchImpl);
  assert.equal(created.id, 'evt1');

  assert.equal(g.calls[0].url, 'https://oauth2.googleapis.com/token');
  const [h, c, sig] = new URLSearchParams(String(g.calls[0].init.body)).get('assertion').split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, SA.email);
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, sig, 'base64url'));

  assert.equal(g.calls[1].url, 'https://www.googleapis.com/calendar/v3/calendars/lior-lessons%40group.calendar.google.com/events');
  assert.equal(g.calls[1].init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(JSON.parse(g.calls[1].init.body), event);
});

test("Google's refusal is the error, so the booking route can flag it", async () => {
  const insert = fakeGoogle([{ status: 200, body: { access_token: 'tok' } }, { status: 404, body: 'Not Found' }]);
  await assert.rejects(insertLessonEvent(SA, 'x@group.calendar.google.com', {}, insert.fetchImpl), /Calendar error 404: Not Found/);
  const token = fakeGoogle([{ status: 400, body: 'invalid_grant' }]);
  await assert.rejects(insertLessonEvent(SA, 'x@group.calendar.google.com', {}, token.fetchImpl), /Token error 400: invalid_grant/);
  assert.equal(token.calls.length, 1, 'no write without a token');
});
