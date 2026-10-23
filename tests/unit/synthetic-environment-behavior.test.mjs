import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { FORBIDDEN_EXTERNAL_CONFIG } from '../../synthetic/integration-guard.mjs';
import {
  DATA_TABLE_POLICY,
  purgeApplicationData,
  verifySyntheticDatabase,
} from '../../synthetic/database-policy.mjs';
import { STORAGE } from '../../src/lib/server/storage-inventory.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lifecycle = join(root, 'scripts', 'synthetic-vps.sh');
const composeFile = join(root, 'docker-compose.synthetic.yml');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

async function fakeLifecycleTools() {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-lifecycle-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  await mkdir(bin);
  await writeFile(join(bin, 'docker'), `#!/usr/bin/env bash
printf 'docker' >> "$FAKE_CALL_LOG"
printf ' <%s>' "$@" >> "$FAKE_CALL_LOG"
printf '\n' >> "$FAKE_CALL_LOG"
case " $* " in
  *" $FAKE_DOCKER_FAIL_MATCH "*) exit 42 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(bin, 'node'), `#!/usr/bin/env bash
printf 'node' >> "$FAKE_CALL_LOG"
printf ' <%s>' "$@" >> "$FAKE_CALL_LOG"
printf '\n' >> "$FAKE_CALL_LOG"
`, { mode: 0o755 });
  return { dir, bin, log };
}

function lifecycleEnv(fixture, extra = {}) {
  return {
    ...process.env,
    PATH: `${fixture.bin}:${process.env.PATH}`,
    FAKE_CALL_LOG: fixture.log,
    SYNTHETIC_PORT: '4273',
    ...extra,
  };
}

async function readLog(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path, 'utf8');
}

test('Compose ignores a poison project .env when the fixed empty env source is used', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'synthetic-compose-env-'));
  const fixture = join(dir, 'compose.yml');
  await writeFile(join(dir, '.env'), 'POISON_SENTINEL=read-project-env\nSYNTHETIC_PORT=1\n');
  await writeFile(fixture, `services:
  probe:
    image: busybox:stable
    environment:
      SENTINEL: \${POISON_SENTINEL:-safe}
      PORT: \${SYNTHETIC_PORT:-4173}
`);
  const env = { ...process.env };
  delete env.POISON_SENTINEL;
  delete env.SYNTHETIC_PORT;
  const result = run('docker', ['compose', '--env-file', '/dev/null', '--file', fixture, 'config', '--format', 'json'], { cwd: dir, env });
  assert.equal(result.status, 0, result.stderr);
  const rendered = JSON.parse(result.stdout);
  assert.equal(rendered.services.probe.environment.SENTINEL, 'safe');
  assert.equal(rendered.services.probe.environment.PORT, '4173');
});

test('rendered synthetic Compose is loopback-only and keeps the app on the internal network', () => {
  const result = run('docker', [
    'compose', '--env-file', '/dev/null', '--project-name', 'meabeclick-synthetic',
    '--file', composeFile, 'config', '--format', 'json',
  ], { env: { ...process.env, SYNTHETIC_PORT: '4273' } });
  assert.equal(result.status, 0, result.stderr);
  const rendered = JSON.parse(result.stdout);
  assert.equal(rendered.services.app.ports, undefined);
  assert.deepEqual(Object.keys(rendered.services.app.networks), ['synthetic_internal']);
  assert.equal(rendered.networks.synthetic_internal.internal, true);
  assert.deepEqual(rendered.services.gateway.ports, [{
    mode: 'ingress', target: 3000, published: '4273', protocol: 'tcp', host_ip: '127.0.0.1',
  }]);
});

test('lifecycle starts gateway only after seed and database verification', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [lifecycle, 'up'], { env: lifecycleEnv(fixture) });
  assert.equal(result.status, 0, result.stderr);
  const log = await readLog(fixture.log);
  const gatewayRemoval = log.indexOf('<rm> <--stop> <--force> <gateway>');
  const app = log.indexOf('<up> <-d> <--build> <--wait> <app>');
  const seed = log.indexOf('<run> <--rm> <--no-deps> <seed>');
  const verify = log.indexOf('<seed> <node> <synthetic/verify.mjs>');
  const gateway = log.indexOf('<up> <-d> <--wait> <gateway>');
  assert.ok(gatewayRemoval >= 0 && gatewayRemoval < app, log);
  assert.ok(app < seed, log);
  assert.ok(seed < verify, log);
  assert.ok(verify < gateway, log);
});

test('rerunning up removes an existing gateway before rebuild and keeps it absent through verification', async () => {
  const fixture = await fakeLifecycleTools();
  const first = run('bash', [lifecycle, 'up'], { env: lifecycleEnv(fixture) });
  assert.equal(first.status, 0, first.stderr);
  const second = run('bash', [lifecycle, 'up'], { env: lifecycleEnv(fixture) });
  assert.equal(second.status, 0, second.stderr);

  const lines = (await readLog(fixture.log)).trim().split('\n');
  const removals = lines
    .map((line, index) => line.includes('<rm> <--stop> <--force> <gateway>') ? index : -1)
    .filter((index) => index >= 0);
  const appStarts = lines
    .map((line, index) => line.includes('<up> <-d> <--build> <--wait> <app>') ? index : -1)
    .filter((index) => index >= 0);
  const verifications = lines
    .map((line, index) => line.includes('<seed> <node> <synthetic/verify.mjs>') ? index : -1)
    .filter((index) => index >= 0);
  const gatewayStarts = lines
    .map((line, index) => line.includes('<up> <-d> <--wait> <gateway>') ? index : -1)
    .filter((index) => index >= 0);

  assert.equal(removals.length, 2, lines.join('\n'));
  assert.equal(appStarts.length, 2, lines.join('\n'));
  assert.equal(verifications.length, 2, lines.join('\n'));
  assert.equal(gatewayStarts.length, 2, lines.join('\n'));
  assert.ok(gatewayStarts[0] < removals[1], lines.join('\n'));
  assert.ok(removals[1] < appStarts[1], lines.join('\n'));
  assert.ok(appStarts[1] < verifications[1], lines.join('\n'));
  assert.ok(verifications[1] < gatewayStarts[1], lines.join('\n'));
  assert.equal(
    gatewayStarts.filter((index) => index > removals[1] && index < verifications[1]).length,
    0,
    lines.join('\n'),
  );
});

for (const failure of [
  { name: 'seed', match: '--no-deps seed', gatewayMustBeAbsent: true },
  { name: 'verification', match: 'synthetic/verify.mjs', gatewayMustBeAbsent: true },
  { name: 'gateway startup', match: '--wait gateway', gatewayMustBeAbsent: false },
]) {
  test(`lifecycle fails closed and removes synthetic resources after ${failure.name} failure`, async () => {
    const fixture = await fakeLifecycleTools();
    const result = run('bash', [lifecycle, 'up'], {
      env: lifecycleEnv(fixture, { FAKE_DOCKER_FAIL_MATCH: failure.match }),
    });
    assert.notEqual(result.status, 0);
    const log = await readLog(fixture.log);
    if (failure.gatewayMustBeAbsent) assert.doesNotMatch(log, /<up> <-d> <--wait> <gateway>/);
    assert.match(log, /<down> <--volumes> <--remove-orphans>\s*$/);
  });
}

test('standalone verification failure also removes the synthetic project and volume', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [lifecycle, 'verify'], {
    env: lifecycleEnv(fixture, { FAKE_DOCKER_FAIL_MATCH: 'synthetic/verify.mjs' }),
  });
  assert.notEqual(result.status, 0);
  const log = await readLog(fixture.log);
  assert.match(log, /<down> <--volumes> <--remove-orphans>\s*$/);
});

test('all lifecycle Docker Compose calls use the fixed empty env source and teardown is scoped', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [lifecycle, 'down'], { env: lifecycleEnv(fixture) });
  assert.equal(result.status, 0, result.stderr);
  const log = await readLog(fixture.log);
  for (const line of log.trim().split('\n')) {
    assert.match(line, /^docker <compose> <--env-file> <\/dev\/null> <--project-name> <meabeclick-synthetic> <--file> <[^>]*docker-compose\.synthetic\.yml>/);
  }
  assert.match(log, /<down> <--volumes> <--remove-orphans>$/m);
  assert.doesNotMatch(log, /<system> <prune>|<volume> <rm>|<rm>/);
});

test('lifecycle validates SYNTHETIC_PORT before invoking Docker', async () => {
  for (const port of ['0', '1023', '65536', '4173:80', 'not-a-port']) {
    const fixture = await fakeLifecycleTools();
    const result = run('bash', [lifecycle, 'config'], { env: lifecycleEnv(fixture, { SYNTHETIC_PORT: port }) });
    assert.equal(result.status, 64, `${port}: ${result.stderr}`);
    await assert.rejects(readLog(fixture.log));
  }
});

test('entrypoint rejects every external integration and engine control variable', () => {
  for (const key of FORBIDDEN_EXTERNAL_CONFIG) {
    const result = run(process.execPath, ['synthetic/entrypoint.mjs'], {
      env: { ...process.env, [key]: 'poison-sentinel' },
    });
    assert.equal(result.status, 78, `${key}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(key));
  }
});

test('shared guard inventory includes every current high-risk engine and integration control', () => {
  const required = [
    'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'BOOKING_EMAIL_TO',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_SERVICE_ACCOUNT_KEY_FILE',
    'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN',
    'GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET',
    'CALLMEBOT_PHONE', 'CALLMEBOT_API_KEY', 'OPS_CALLMEBOT_PHONE', 'OPS_CALLMEBOT_API_KEY',
    'OPS_SLACK_WEBHOOK_URL', 'CRON_KEY', 'GENERATION_HEALTH_STALE_DAYS', 'OPENAI_API_KEY',
    'LESSON_ENGINE', 'CODEX_BIN', 'CLAUDE_BIN', 'OPENCODE_BIN',
    'LESSON_MODEL', 'LESSON_EFFORT', 'LESSON_TIMEOUT_MINUTES', 'ASK_MODEL', 'ASK_EFFORT',
  ];
  for (const key of required) assert.ok(FORBIDDEN_EXTERNAL_CONFIG.includes(key), key);
});

test('database policy covers the complete source storage inventory without drift', () => {
  assert.deepEqual(Object.keys(DATA_TABLE_POLICY).sort(), Object.keys(STORAGE).sort());
});

function createPolicyFixture() {
  const db = new DatabaseSync(':memory:');
  for (const [table, policy] of Object.entries(DATA_TABLE_POLICY)) {
    if (table === 'schema_version') {
      db.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
      for (let version = 1; version <= 31; version++) {
        db.prepare('INSERT INTO schema_version VALUES (?, ?, ?)').run(version, `migration-${version}`, '2026-01-01T00:00:00.000Z');
      }
    } else if (table === 'accounts') db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, credential TEXT, is_self INTEGER, created_at TEXT, email TEXT, legacy_code TEXT)');
    else if (table === 'students_v2') db.exec('CREATE TABLE students_v2 (id INTEGER PRIMARY KEY, code TEXT, name TEXT, emoji TEXT, account_id INTEGER, progress INTEGER, progress_note TEXT, credential TEXT, created_at TEXT, goals TEXT, style TEXT, notes TEXT)');
    else if (table === 'teachers') db.exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, active INTEGER, meet_url TEXT, meet_account TEXT, setup_hash TEXT, setup_expires TEXT, calendar_id TEXT, busy_ics TEXT, teaching_hours TEXT)');
    else if (table === 'enrollments') db.exec('CREATE TABLE enrollments (id INTEGER PRIMARY KEY, student_id INTEGER, subject TEXT, level TEXT, teacher_id INTEGER)');
    else if (table === 'bookings_v2') db.exec('CREATE TABLE bookings_v2 (id INTEGER PRIMARY KEY, student_id INTEGER, enrollment_id INTEGER, start TEXT, end TEXT, duration INTEGER, at TEXT, status TEXT, source_utm TEXT, heard_from TEXT, mode TEXT, teacher_id INTEGER, heard_from_detail TEXT)');
    else if (table === 'lessons') db.exec('CREATE TABLE lessons (id INTEGER PRIMARY KEY, slug TEXT, student TEXT, subject TEXT, level TEXT, topic TEXT, title TEXT, context TEXT, at TEXT, lesson_at TEXT, status TEXT, problem TEXT, slides TEXT, homework TEXT, games TEXT)');
    else if (table === 'homework') db.exec('CREATE TABLE homework (id INTEGER PRIMARY KEY, lesson_id INTEGER, student_id INTEGER, task TEXT, template TEXT, data_id TEXT, assigned_at TEXT, due_at TEXT, submitted_at TEXT, submitted_by TEXT, graded_at TEXT, grade TEXT, graded_by TEXT, node_id INTEGER, booking_id INTEGER, held_until TEXT, answer TEXT)');
    else if (table === 'results_v2') db.exec('CREATE TABLE results_v2 (id INTEGER PRIMARY KEY, student_id INTEGER, at TEXT, data_id TEXT, template TEXT, score INTEGER, total INTEGER, tries INTEGER, stars INTEGER, seconds INTEGER, missed TEXT, hints INTEGER)');
    else if (table === 'game_filler') db.exec('CREATE TABLE game_filler (id TEXT PRIMARY KEY, body TEXT)');
    else if (table === 'lesson_reports') db.exec('CREATE TABLE lesson_reports (id INTEGER PRIMARY KEY, booking_id INTEGER, student_id INTEGER, enrollment_id INTEGER, note TEXT, created_at TEXT, updated_at TEXT)');
    else db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`);
    assert.ok(policy, table);
  }
  return db;
}

test('database policy purges migration defaults/catalog rows and accepts only the deterministic fixture', async () => {
  const db = createPolicyFixture();
  db.prepare('INSERT INTO teachers (id, name, phone) VALUES (1, ?, ?)').run('production-default-sentinel', 'real-phone-sentinel');
  db.prepare('INSERT INTO game_filler VALUES (?, ?)').run('example-default-sentinel', '{}');
  purgeApplicationData(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_filler').get().n, 0);

  const { seedSyntheticRows } = await import('../../synthetic/seed-data.mjs');
  seedSyntheticRows(db);
  assert.doesNotThrow(() => verifySyntheticDatabase(db));

  for (const [table, policy] of Object.entries(DATA_TABLE_POLICY)) {
    if (table === 'schema_version' || policy.expectedKeys.length > 0) continue;
    db.prepare(`INSERT INTO "${table}" (id) VALUES (999999)`).run();
    assert.throws(() => verifySyntheticDatabase(db), new RegExp(table));
    db.prepare(`DELETE FROM "${table}"`).run();
  }
  db.close();
});

test('database verification rejects extra IDs and altered synthetic identity/content', async () => {
  const { seedSyntheticRows } = await import('../../synthetic/seed-data.mjs');
  for (const [table, policy] of Object.entries(DATA_TABLE_POLICY)) {
    if (table === 'schema_version' || policy.expectedKeys.length === 0) continue;
    const db = createPolicyFixture();
    seedSyntheticRows(db);
    const unexpectedKey = typeof policy.expectedKeys[0] === 'number' ? 999999 : 'unexpected-key-sentinel';
    db.prepare(`INSERT INTO "${table}" ("${policy.key}") VALUES (?)`).run(unexpectedKey);
    assert.throws(() => verifySyntheticDatabase(db), new RegExp(table));
    db.close();
  }

  const corruptions = [
    ['accounts', "UPDATE accounts SET credential = 'unexpected-content'"],
    ['students_v2', "UPDATE students_v2 SET notes = 'unexpected-content'"],
    ['teachers', "UPDATE teachers SET name = 'production-default-sentinel', phone = 'real-phone-sentinel' WHERE id = 98001"],
    ['enrollments', "UPDATE enrollments SET level = 'unexpected-content'"],
    ['bookings_v2', "UPDATE bookings_v2 SET mode = 'unexpected-content'"],
    ['lessons', "UPDATE lessons SET homework = 'unexpected-content'"],
    ['homework', "UPDATE homework SET answer = 'unexpected-content'"],
    ['results_v2', 'UPDATE results_v2 SET tries = 999'],
    ['game_filler', "UPDATE game_filler SET body = '{}'"],
    ['lesson_reports', "UPDATE lesson_reports SET note = 'unexpected-content'"],
  ];
  for (const [table, sql] of corruptions) {
    const db = createPolicyFixture();
    seedSyntheticRows(db);
    db.exec(sql);
    assert.throws(() => verifySyntheticDatabase(db), new RegExp(table));
    db.close();
  }
});
