import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORBIDDEN_EXTERNAL_CONFIG } from '../../synthetic/integration-guard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const compose = read('docker-compose.synthetic.yml');
const productionCompose = read('docker-compose.yml');
const entrypoint = read('synthetic/entrypoint.mjs');
const integrationGuard = read('synthetic/integration-guard.mjs');
const seed = read('synthetic/seed.mjs');
const seedData = read('synthetic/seed-data.mjs');
const databaseSeed = read('synthetic/database-seed.mjs');
const portalFixture = read('synthetic/portal-fixture.mjs');
const lifecycle = read('scripts/synthetic-vps.sh');
const dockerfile = read('Dockerfile');
const docs = read('docs/synthetic-vps.md');

const appBlock = compose.slice(compose.indexOf('\n  app:'), compose.indexOf('\n  gateway:'));
const gatewayBlock = compose.slice(compose.indexOf('\n  gateway:'), compose.indexOf('\n  seed:'));
const networkBlock = compose.slice(compose.indexOf('\nnetworks:'), compose.indexOf('\nvolumes:'));


test('synthetic Compose has a fixed project identity distinct from production', () => {
  assert.match(compose, /^name:\s*meabeclick-synthetic\s*$/m);
  assert.doesNotMatch(productionCompose, /^name:\s*meabeclick-synthetic\s*$/m);
  assert.match(lifecycle, /--project-name meabeclick-synthetic/);
  assert.match(lifecycle, /--file .*docker-compose\.synthetic\.yml/);
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
  for (const key of FORBIDDEN_EXTERNAL_CONFIG) {
    assert.doesNotMatch(appBlock, new RegExp(`^\\s*${key}:`, 'm'), `${key} must not be passed to the app`);
    assert.match(integrationGuard, new RegExp(`['\"]${key}['\"]`), `${key} must be in the shared rejection inventory`);
  }
  assert.match(entrypoint, /SYNTHETIC_TEST_MODE/);
  assert.match(entrypoint, /\/synthetic-data\/synthetic\.db/);
  assert.match(dockerfile, /COPY --chown=node:node synthetic \.\/synthetic/);
});

test('deterministic seed is visibly fictional and covers the release-test model', () => {
  assert.match(seedData, /example\.invalid/);
  assert.match(seedData, /הורה בדיקה/);
  assert.match(seedData, /תלמידת בדיקה/);
  assert.match(seedData, /מורה בדיקה/);
  assert.match(seedData, /INSERT INTO bookings_v2/);
  assert.match(seedData, /INSERT INTO lessons/);
  assert.match(seedData, /INSERT INTO lesson_materials/);
  assert.match(seedData, /INSERT INTO homework/);
  assert.match(seedData, /INSERT INTO game_filler/);
  assert.match(seedData, /INSERT INTO results_v2/);
  assert.match(seedData, /submitted_at/);
  assert.match(seedData, /x²|x\^2/);
  assert.match(databaseSeed, /purgeApplicationData/);
  assert.match(databaseSeed, /verifySyntheticDatabase/);
  assert.match(seed, /seedSyntheticPortal/);
  assert.match(portalFixture, /synthetic-student-gamma\.json/);
  assert.match(portalFixture, /synthetic-quadratic-formulas/);
});

test('state-changing lifecycle commands use one fixed retained inter-process lock', () => {
  assert.match(lifecycle, /\/tmp\/meabeclick-synthetic-\$\{UID\}\.lock\.d/);
  assert.match(lifecycle, /command -v flock/);
  assert.match(lifecycle, /flock -n/);
  assert.match(lifecycle, /up\|verify\|down\|rebuild/);
  assert.doesNotMatch(lifecycle, /rm .*meabeclick-synthetic.*\.lock/);
});

test('teardown is hard-scoped to only the synthetic project and volume', () => {
  assert.match(lifecycle, /down --volumes --remove-orphans/);
  assert.doesNotMatch(lifecycle, /docker\s+(?:rm|volume rm|system prune)/);
  assert.doesNotMatch(lifecycle, /docker-compose\.yml/);
  assert.match(docs, /meabeclick-synthetic_synthetic_data/);
  assert.match(docs, /does not deploy, restart, stop, or inspect the production stack/i);
});
