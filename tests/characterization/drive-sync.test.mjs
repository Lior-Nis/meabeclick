// The Drive sync route through the real server. The harness blocks the
// Drive login, so the only answers a test can see are "unauthorized" and
// "not configured" — which is the point: no test reaches the real Drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

test('the Drive sync needs the cron key, and without a Drive login it touches nothing', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY: 'k' } });
  try {
    assert.equal((await fetch(`${baseUrl}/api/drive-sync`)).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/drive-sync`, { headers: { 'X-Cron-Key': 'nope' } })).status, 401);
    const r = await fetch(`${baseUrl}/api/drive-sync`, { headers: { 'X-Cron-Key': 'k' } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { skipped: 'not configured' });
  } finally { await stop(); }
});
