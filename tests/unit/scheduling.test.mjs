// The units are the only part of this feature that CI cannot exercise, so
// the test reads them as text: a timer that points at the wrong endpoint or
// forgets the key fails silently in production, at 03:00, forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('the report-prompt unit calls the prompt endpoint with the key', () => {
  const unit = read('server/meabeclick-report-prompt.service');
  assert.match(unit, /\/api\/reports\/prompt/);
  assert.match(unit, /X-Cron-Key/);
  assert.match(unit, /\$\{?CRON_KEY\}?/, 'the key comes from the environment, never inline');
  assert.doesNotMatch(unit, /X-Cron-Key:\s*[A-Za-z0-9]{8,}/, 'no literal secret in a checked-in file');
  // Without --fail, curl exits 0 on a 401 response body — "the timer tells
  // you when it's broken" is only true if a rejected request actually
  // fails the unit.
  assert.match(unit, /curl[^\n]*--fail/, 'curl must fail loudly on a non-2xx response');
});

test('the report-prompt timer runs hourly and survives a reboot', () => {
  const timer = read('server/meabeclick-report-prompt.timer');
  assert.match(timer, /OnCalendar=hourly|OnUnitActiveSec=1h/);
  assert.match(timer, /Persistent=true/, 'a missed run must fire after a reboot');
  assert.match(timer, /WantedBy=timers\.target/);
});

test('the reminder unit calls /api/remind, which had no caller at all', () => {
  const unit = read('server/meabeclick-remind.service');
  assert.match(unit, /\/api\/remind/);
  assert.match(unit, /X-Cron-Key/);
  assert.match(unit, /curl[^\n]*--fail/, 'curl must fail loudly on a non-2xx response here too');
  const timer = read('server/meabeclick-remind.timer');
  assert.match(timer, /Sat/, 'the booking window opens on Saturday evening');
});

test('both units read only the dedicated cron-key file, not the app\'s full .env', () => {
  // .env also holds ADMIN_PASSWORD, SESSION_SECRET and the Gmail
  // credentials — a unit that only needs CRON_KEY has no business loading
  // any of them into an environment `systemctl --user show` prints.
  for (const path of ['server/meabeclick-report-prompt.service', 'server/meabeclick-remind.service']) {
    const unit = read(path);
    assert.match(unit, /EnvironmentFile=%h\/mea-beclick\/\.cron-key\.env/, `${path} must point at the dedicated cron-key file`);
    assert.doesNotMatch(unit, /EnvironmentFile=%h\/mea-beclick\/\.env\b/, `${path} must not load the app's full .env`);
  }
});

test('CRON_KEY is documented where a deployer will look', () => {
  assert.match(read('.env.example'), /CRON_KEY/);
  assert.match(read('server/README.md'), /CRON_KEY/);
  assert.match(read('server/README.md'), /meabeclick-report-prompt\.timer/);
});
