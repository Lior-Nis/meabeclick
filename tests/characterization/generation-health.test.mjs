// /api/health/generation behind the cron key: what the morning timer calls.
// The harness blocks every CALLMEBOT key, so the POST here exercises the
// "no alert channel" path — the one that must never pass quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const CRON_KEY = 'test-cron-key';
const call = (baseUrl, method, key) => fetch(`${baseUrl}/api/health/generation`, {
  method, headers: key ? { 'X-Cron-Key': key } : {},
});

test('the health check refuses anyone without the key, tutor included', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    assert.equal((await call(baseUrl, 'GET', null)).status, 401);
    assert.equal((await call(baseUrl, 'POST', 'wrong')).status, 401);
    const cookie = await login(baseUrl);
    const asTutor = await fetch(`${baseUrl}/api/health/generation`, { headers: { Cookie: cookie } });
    assert.equal(asTutor.status, 401);
  } finally { await stop(); }
});

test('GET reports without sending; POST with no alert channel is a 503, not a quiet 200', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    const got = await call(baseUrl, 'GET', CRON_KEY);
    assert.equal(got.status, 200);
    const report = await got.json();
    assert.equal(report.ok, true, 'an empty database is healthy');
    assert.deepEqual(report.alertChannels, []);
    assert.match(report.alertChannelProblem, /OPS_SLACK_WEBHOOK_URL/);
    assert.equal(report.window.hours, 24);
    assert.equal(report.stale.days, 3);
    assert.deepEqual(report.stale.bookedWithoutLesson, []);
    const wider = await (await fetch(`${baseUrl}/api/health/generation?days=10`, { headers: { 'X-Cron-Key': CRON_KEY } })).json();
    assert.equal(wider.stale.days, 10, '?days= widens the stale window for a look');

    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 503);
    const body = await posted.json();
    assert.match(body.reason, /OPS_SLACK_WEBHOOK_URL/);
    assert.deepEqual(body.sent, []);
  } finally { await stop(); }
});

test('half an OPS pair is a 503 too', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY, OPS_CALLMEBOT_PHONE: '972500000000' } });
  try {
    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 503);
    assert.match((await posted.json()).reason, /only one/);
  } finally { await stop(); }
});

test('a webhook that is not Slack\'s is a 503, and the response never echoes it', async () => {
  const bogus = 'https://example.com/services/T000/B000/secretsecret';
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY, OPS_SLACK_WEBHOOK_URL: bogus } });
  try {
    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 503);
    const text = await posted.text();
    assert.ok(!text.includes('secretsecret'));
    const got = await (await call(baseUrl, 'GET', CRON_KEY)).text();
    assert.ok(!got.includes('secretsecret'));
  } finally { await stop(); }
});

test('a Slack webhook alone is a configured channel: a healthy day is a 200 and sends nothing', async () => {
  const hook = 'https://hooks.slack.com/services/T000/B000/secretsecret';
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY, OPS_SLACK_WEBHOOK_URL: hook } });
  try {
    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 200);
    const text = await posted.text();
    assert.ok(!text.includes('secretsecret'), 'the URL is the credential: never in a response');
    const body = JSON.parse(text);
    assert.deepEqual(body.sent, []);
    assert.deepEqual(body.alertChannels, ['slack (OPS_SLACK_WEBHOOK_URL)']);
  } finally { await stop(); }
});
