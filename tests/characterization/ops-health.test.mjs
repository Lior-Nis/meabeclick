// /api/health/ops behind the cron key: what the morning ops timer calls.
// The harness blocks Gmail, Drive, the calendar robot and every alert
// channel, and points SITE_URL at the test server itself — so this runs the
// real route with no outside network, and the "unconfigured" answers are
// the ones production must never give quietly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const CRON_KEY = 'test-cron-key';
const call = (baseUrl, method, key) => fetch(`${baseUrl}/api/health/ops`, {
  method, headers: key ? { 'X-Cron-Key': key } : {},
});

test('the ops check refuses anyone without the key, tutor included', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    assert.equal((await call(baseUrl, 'GET', null)).status, 401);
    assert.equal((await call(baseUrl, 'POST', 'wrong')).status, 401);
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/api/health/ops`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await stop(); }
});

test('GET reports all four checks; missing mail and Drive logins are failures; POST with no channel is a 503', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    const got = await call(baseUrl, 'GET', CRON_KEY);
    assert.equal(got.status, 200);
    const report = await got.json();
    assert.deepEqual(report.checks.map(c => c.name), ['uptime', 'backups', 'mail', 'calendar']);
    const by = Object.fromEntries(report.checks.map(c => [c.name, c]));
    assert.equal(by.uptime.ok, true, `the site answered itself: ${by.uptime.problems}`);
    assert.equal(by.backups.ok, false);
    assert.match(by.backups.problems[0], /GOOGLE_OAUTH/);
    assert.equal(by.mail.ok, false);
    assert.match(by.mail.problems[0], /GMAIL_USER/);
    assert.equal(report.ok, false);
    assert.deepEqual(report.alertChannels, []);

    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 503);
    const body = await posted.json();
    assert.match(body.reason, /OPS_SLACK_WEBHOOK_URL/);
    assert.deepEqual(body.sent, []);
  } finally { await stop(); }
});
