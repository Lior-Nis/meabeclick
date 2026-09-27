/**
 * How the Drive sync is run: a cron-key endpoint, a 10-minute timer, and a
 * harness that keeps it switched off in tests. Spec D3, D6.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');

test('the endpoint is cron-key only and runs the sync with the real Drive and WhatsApp', () => {
  const s = read('src/routes/api/drive-sync/+server.ts');
  assert.match(s, /authorizedCronRequest\(request\.headers\.get\('x-cron-key'\)\)/);
  assert.match(s, /syncDrive\(\{ api: driveApiFromEnv\(\), notify: sendWhatsApp \}\)/);
});

test('a timer calls it every 10 minutes, the same way as the other timers', () => {
  assert.match(read('server/meabeclick-drive-sync.timer'), /OnCalendar=\*:0\/10/);
  const svc = read('server/meabeclick-drive-sync.service');
  assert.match(svc, /EnvironmentFile=%h\/mea-beclick\/\.cron-key\.env/);
  assert.match(svc, /http:\/\/127\.0\.0\.1:3000\/api\/drive-sync/);
});

test('the characterization harness can never reach the real Drive', () => {
  const h = read('tests/characterization/harness.mjs');
  for (const k of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']) {
    assert.match(h, new RegExp(`'${k}'`), k);
  }
});
