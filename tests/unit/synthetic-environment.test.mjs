import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const compose = read('docker-compose.synthetic.yml');
const productionCompose = read('docker-compose.yml');
const entrypoint = read('synthetic/entrypoint.mjs');
const seed = read('synthetic/seed.mjs');
const lifecycle = read('scripts/synthetic-vps.sh');
const dockerfile = read('Dockerfile');
const docs = read('docs/synthetic-vps.md');

const appBlock = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  gateway:'));
const gatewayBlock = compose.slice(compose.indexOf('\n  gateway:'), compose.indexOf('\n  seed:'));
const networkBlock = compose.slice(compose.indexOf('\nnetworks:'), compose.indexOf('\nvolumes:'));

const forbiddenExternalConfig = [
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY',
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN',
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_WEB_CLIENT_SECRET',
  'CALLMEBOT_API_KEY',
  'OPS_CALLMEBOT_API_KEY',
  'OPS_SLACK_WEBHOOK_URL',
  'OPENAI_API_KEY',
  'CALENDAR_ID',
  'CALENDAR_ICS_URLS',
];

test('synthetic Compose has a fixed project identity distinct from production', () => {
  assert.match(compose, /^name:\s*meabeclick-synthetic\s*$/m);
  assert.doesNotMatch(productionCompose, /^name:\s*meabeclick-synthetic\s*$/m);
  assert.match(lifecycle, /--project-name meabeclick-synthetic/);
  assert.match(lifecycle, /--file docker-compose\.synthetic\.yml/);
});

test('synthetic access is loopback-only on a non-production port', () => {
  assert.doesNotMatch(appBlock, /ports:/, 'the no-egress app must not publish a port directly');
  assert.match(gatewayBlock, /127\.0\.0\.1:\$\{SYNTHETIC_PORT:-4173\}:3000/);
  assert.doesNotMatch(gatewayBlock, /(?:0\.0\.0\.0|80:80|443:443|3000:3000)/);
  assert.doesNotMatch(gatewayBlock, /volumes:|DB_PATH|SESSION_SECRET|ADMIN_PASSWORD/,
    'the loopback gateway must have neither application data nor credentials');
});

test('synthetic runtime has no external network route', () => {
  assert.match(appBlock, /networks:\s*\n\s*- synthetic_internal/);
  assert.doesNotMatch(appBlock, /synthetic_access/);
  assert.match(networkBlock, /synthetic_internal:\s*\n\s*internal:\s*true/);
  assert.match(gatewayBlock, /SYNTHETIC_PROXY_TARGET:\s*http:\/\/app:3000/);
  assert.doesNotMatch(compose, /caddy/i);
});

test('synthetic app uses only its own named data volume and no secret sources', () => {
  assert.match(appBlock, /synthetic_data:\/synthetic-data/);
  assert.doesNotMatch(appBlock, /env_file|service-account|codex-home|\.env|\.\/data:|mea-beclick-kb/);
  assert.match(appBlock, /DB_PATH:\s*\/synthetic-data\/synthetic\.db/);
  assert.doesNotMatch(compose, /external:\s*true/);
});

test('external integrations and lesson-engine credentials are absent and guarded', () => {
  for (const key of forbiddenExternalConfig) {
    assert.doesNotMatch(appBlock, new RegExp(`^\\s*${key}:`, 'm'), `${key} must not be passed to the app`);
    assert.match(entrypoint, new RegExp(`['\"]${key}['\"]`), `${key} must be rejected if injected`);
  }
  assert.match(entrypoint, /SYNTHETIC_TEST_MODE/);
  assert.match(entrypoint, /\/synthetic-data\/synthetic\.db/);
  assert.match(dockerfile, /COPY --chown=node:node synthetic \.\/synthetic/);
});

test('deterministic seed is visibly fictional and covers the release-test model', () => {
  assert.match(seed, /example\.invalid/);
  assert.match(seed, /הורה בדיקה/);
  assert.match(seed, /תלמידת בדיקה/);
  assert.match(seed, /מורה בדיקה/);
  assert.match(seed, /INSERT INTO bookings_v2/);
  assert.match(seed, /INSERT INTO lessons/);
  assert.match(seed, /INSERT INTO homework/);
  assert.match(seed, /INSERT INTO game_filler/);
  assert.match(seed, /INSERT INTO results_v2/);
  assert.match(seed, /submitted_at/);
  assert.match(seed, /x²|x\^2/);
  assert.match(seed, /refusing to seed a database containing non-synthetic/);
});

test('teardown is hard-scoped to only the synthetic project and volume', () => {
  assert.match(lifecycle, /down --volumes --remove-orphans/);
  assert.doesNotMatch(lifecycle, /docker\s+(?:rm|volume rm|system prune)/);
  assert.doesNotMatch(lifecycle, /docker-compose\.yml/);
  assert.match(docs, /meabeclick-synthetic_synthetic_data/);
  assert.match(docs, /does not deploy, restart, stop, or inspect the production stack/i);
});
