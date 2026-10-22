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
    assert.equal(report.alertChannel, 'none');
    assert.equal(report.window.hours, 24);

    const posted = await call(baseUrl, 'POST', CRON_KEY);
    assert.equal(posted.status, 503);
    const body = await posted.json();
    assert.equal(body.sent, false);
    assert.match(body.reason, /OPS_CALLMEBOT_PHONE/);
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
