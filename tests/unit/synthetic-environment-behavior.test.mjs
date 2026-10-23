import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, mkdir, readFile, readdir, chmod, access, rm, symlink, chown } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

import { FORBIDDEN_EXTERNAL_CONFIG } from '../../synthetic/integration-guard.mjs';
import {
  DATA_TABLE_POLICY,
  purgeApplicationData,
  verifySyntheticDatabase,
} from '../../synthetic/database-policy.mjs';
import {
  PORTAL_FILE_NAME,
  PORTAL_FILE_TEXT,
  seedSyntheticPortal,
  verifySyntheticPortal,
} from '../../synthetic/portal-fixture.mjs';
import { loopbackUrlIssue } from '../../synthetic/runtime-policy.mjs';
import { seedSyntheticRows } from '../../synthetic/seed-data.mjs';
import { replaceSyntheticDatabase } from '../../synthetic/database-seed.mjs';
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
  const scripts = join(dir, 'scripts');
  const fixtureLifecycle = join(scripts, 'synthetic-vps.sh');
  await mkdir(bin);
  await mkdir(scripts);
  const lifecycleSource = await readFile(lifecycle, 'utf8');
  await writeFile(fixtureLifecycle, lifecycleSource.replace(
    '/tmp/meabeclick-synthetic-${UID}.lock.d',
    join(dir, 'lifecycle.lock.d'),
  ), { mode: 0o755 });
  await writeFile(join(bin, 'docker'), `#!/usr/bin/env bash
printf 'docker' >> "$FAKE_CALL_LOG"
printf ' <%s>' "$@" >> "$FAKE_CALL_LOG"
printf '\n' >> "$FAKE_CALL_LOG"
case " $* " in
  *" $FAKE_DOCKER_FAIL_MATCH "*) exit 42 ;;
esac
if [[ " $* " == *" \${FAKE_DOCKER_DELAY_MATCH:-__never__} "* ]]; then
  : > "$FAKE_DOCKER_DELAY_STARTED"
  while [[ ! -e "$FAKE_DOCKER_DELAY_RELEASE" ]]; do sleep 0.01; done
fi
`, { mode: 0o755 });
  await writeFile(join(bin, 'node'), `#!/usr/bin/env bash
printf 'node' >> "$FAKE_CALL_LOG"
printf ' <%s>' "$@" >> "$FAKE_CALL_LOG"
printf '\n' >> "$FAKE_CALL_LOG"
case " $* " in
  *" \${FAKE_NODE_FAIL_MATCH:-__never__} "*) exit 43 ;;
esac
`, { mode: 0o755 });
  return {
    dir,
    bin,
    log,
    lifecycle: fixtureLifecycle,
    lockDir: join(dir, 'lifecycle.lock.d'),
  };
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

async function waitForFile(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${path}`);
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
  const result = run('bash', [fixture.lifecycle, 'up'], { env: lifecycleEnv(fixture) });
  assert.equal(result.status, 0, result.stderr);
  const log = await readLog(fixture.log);
  const gatewayRemoval = log.indexOf('<rm> <--stop> <--force> <gateway>');
  const app = log.indexOf('<up> <-d> <--build> <--wait> <app>');
  const seed = log.indexOf('<run> <--rm> <--no-deps> <seed>');
  const verify = log.indexOf('<seed> <node> <synthetic/verify.mjs>');
  const gateway = log.indexOf('<up> <-d> <--wait> <gateway>');
  const smoke = log.indexOf('node <synthetic/http-smoke.mjs> <http://127.0.0.1:4273>');
  const browserSmoke = log.indexOf('node <synthetic/browser-smoke.mjs> <http://127.0.0.1:4273>');
  assert.ok(gatewayRemoval >= 0 && gatewayRemoval < app, log);
  assert.ok(app < seed, log);
  assert.ok(seed < verify, log);
  assert.ok(verify < gateway, log);
  assert.ok(gateway < smoke && smoke < browserSmoke, log);
});

test('rerunning up removes an existing gateway before rebuild and keeps it absent through verification', async () => {
  const fixture = await fakeLifecycleTools();
  const first = run('bash', [fixture.lifecycle, 'up'], { env: lifecycleEnv(fixture) });
  assert.equal(first.status, 0, first.stderr);
  const second = run('bash', [fixture.lifecycle, 'up'], { env: lifecycleEnv(fixture) });
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
    const result = run('bash', [fixture.lifecycle, 'up'], {
      env: lifecycleEnv(fixture, { FAKE_DOCKER_FAIL_MATCH: failure.match }),
    });
    assert.notEqual(result.status, 0);
    const log = await readLog(fixture.log);
    if (failure.gatewayMustBeAbsent) assert.doesNotMatch(log, /<up> <-d> <--wait> <gateway>/);
    assert.match(log, /<down> <--volumes> <--remove-orphans>\s*$/);
  });
}

test('lifecycle fails closed when the magic-link student portal HTTP smoke fails', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [fixture.lifecycle, 'up'], {
    env: lifecycleEnv(fixture, { FAKE_NODE_FAIL_MATCH: 'synthetic/http-smoke.mjs' }),
  });
  assert.notEqual(result.status, 0);
  const log = await readLog(fixture.log);
  const gateway = log.indexOf('<up> <-d> <--wait> <gateway>');
  const smoke = log.indexOf('node <synthetic/http-smoke.mjs> <http://127.0.0.1:4273>');
  const cleanup = log.lastIndexOf('<down> <--volumes> <--remove-orphans>');
  assert.ok(gateway >= 0 && gateway < smoke && smoke < cleanup, log);
});

test('lifecycle fails closed when the rendered-browser student portal smoke fails', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [fixture.lifecycle, 'up'], {
    env: lifecycleEnv(fixture, { FAKE_NODE_FAIL_MATCH: 'synthetic/browser-smoke.mjs' }),
  });
  assert.notEqual(result.status, 0);
  const log = await readLog(fixture.log);
  const httpSmoke = log.indexOf('node <synthetic/http-smoke.mjs> <http://127.0.0.1:4273>');
  const browserSmoke = log.indexOf('node <synthetic/browser-smoke.mjs> <http://127.0.0.1:4273>');
  const cleanup = log.lastIndexOf('<down> <--volumes> <--remove-orphans>');
  assert.ok(httpSmoke >= 0 && httpSmoke < browserSmoke && browserSmoke < cleanup, log);
});

test('standalone verification failure also removes the synthetic project and volume', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [fixture.lifecycle, 'verify'], {
    env: lifecycleEnv(fixture, { FAKE_DOCKER_FAIL_MATCH: 'synthetic/verify.mjs' }),
  });
  assert.notEqual(result.status, 0);
  const log = await readLog(fixture.log);
  assert.match(log, /<down> <--volumes> <--remove-orphans>\s*$/);
});

test('standalone verify fails closed when the student portal HTTP smoke fails', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [fixture.lifecycle, 'verify'], {
    env: lifecycleEnv(fixture, { FAKE_NODE_FAIL_MATCH: 'synthetic/http-smoke.mjs' }),
  });
  assert.notEqual(result.status, 0);
  const log = await readLog(fixture.log);
  assert.match(log, /node <synthetic\/http-smoke\.mjs> <http:\/\/127\.0\.0\.1:4273>/);
  assert.match(log, /<down> <--volumes> <--remove-orphans>\s*$/);
});

test('all lifecycle Docker Compose calls use the fixed empty env source and teardown is scoped', async () => {
  const fixture = await fakeLifecycleTools();
  const result = run('bash', [fixture.lifecycle, 'down'], { env: lifecycleEnv(fixture) });
  assert.equal(result.status, 0, result.stderr);
  const log = await readLog(fixture.log);
  for (const line of log.trim().split('\n')) {
    assert.match(line, /^docker <compose> <--env-file> <\/dev\/null> <--project-name> <meabeclick-synthetic> <--file> <[^>]*docker-compose\.synthetic\.yml>/);
  }
  assert.match(log, /<down> <--volumes> <--remove-orphans>$/m);
  assert.doesNotMatch(log, /<system> <prune>|<volume> <rm>|<rm>/);
});

test('lifecycle lock rejects concurrent fixed-project commands before Docker is invoked', async () => {
  const fixture = await fakeLifecycleTools();
  const started = join(fixture.dir, 'holder-started');
  const release = join(fixture.dir, 'holder-release');
  const holder = spawn('bash', [fixture.lifecycle, 'up'], {
    cwd: root,
    env: lifecycleEnv(fixture, {
      FAKE_DOCKER_DELAY_MATCH: 'rm --stop --force gateway',
      FAKE_DOCKER_DELAY_STARTED: started,
      FAKE_DOCKER_DELAY_RELEASE: release,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let holderStderr = '';
  holder.stderr.on('data', (chunk) => { holderStderr += chunk; });
  const holderClosed = new Promise((resolve) => holder.on('close', resolve));

  try {
    await waitForFile(started);

    for (const command of ['up', 'verify', 'rebuild', 'down']) {
      const before = await readLog(fixture.log);
      const contender = run('bash', [fixture.lifecycle, command], {
        env: lifecycleEnv(fixture, { FAKE_DOCKER_DELAY_MATCH: '__never__' }),
      });
      assert.equal(contender.status, 75, `${command}: ${contender.stderr}`);
      assert.match(contender.stderr, /another synthetic lifecycle command is active/i);
      assert.equal(await readLog(fixture.log), before, `${command} invoked Docker while blocked`);
    }

    await writeFile(release, 'release\n');
    const holderStatus = await holderClosed;
    assert.equal(holderStatus, 0, holderStderr);

    const reacquired = run('bash', [fixture.lifecycle, 'down'], { env: lifecycleEnv(fixture) });
    assert.equal(reacquired.status, 0, `lock was not reusable after release: ${reacquired.stderr}`);
  } finally {
    await writeFile(release, 'release\n').catch(() => {});
    if (holder.exitCode === null) holder.kill('SIGKILL');
    await holderClosed;
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

for (const unsafeTarget of [
  {
    name: 'symlink',
    prepare: async (fixture) => {
      const target = join(fixture.dir, 'lock-target');
      await mkdir(target, { mode: 0o700 });
      await symlink(target, fixture.lockDir);
    },
  },
  {
    name: 'non-directory',
    prepare: async (fixture) => writeFile(fixture.lockDir, 'not a directory\n', { mode: 0o600 }),
  },
  {
    name: 'wrong-mode directory',
    prepare: async (fixture) => mkdir(fixture.lockDir, { mode: 0o755 }),
  },
]) {
  test(`lifecycle rejects an unsafe ${unsafeTarget.name} lock target before Docker is invoked`, async () => {
    const fixture = await fakeLifecycleTools();
    await unsafeTarget.prepare(fixture);

    const result = run('bash', [fixture.lifecycle, 'down'], { env: lifecycleEnv(fixture) });

    assert.equal(result.status, 73, result.stderr);
    assert.match(result.stderr, /user-owned mode-700 directory/i);
    await assert.rejects(readLog(fixture.log), { code: 'ENOENT' });
    await rm(fixture.dir, { recursive: true, force: true });
  });
}

test('lifecycle rejects a foreign-owned lock directory before Docker is invoked when ownership can be changed', {
  skip: typeof process.getuid !== 'function' || process.getuid() !== 0,
}, async () => {
  const fixture = await fakeLifecycleTools();
  await mkdir(fixture.lockDir, { mode: 0o700 });
  await chown(fixture.lockDir, 65534, 65534);

  const result = run('bash', [fixture.lifecycle, 'down'], { env: lifecycleEnv(fixture) });

  assert.equal(result.status, 73, result.stderr);
  assert.match(result.stderr, /user-owned mode-700 directory/i);
  await assert.rejects(readLog(fixture.log), { code: 'ENOENT' });
  await rm(fixture.dir, { recursive: true, force: true });
});

test('lifecycle validates SYNTHETIC_PORT before invoking Docker', async () => {
  for (const port of ['0', '1023', '65536', '4173:80', 'not-a-port']) {
    const fixture = await fakeLifecycleTools();
    const result = run('bash', [fixture.lifecycle, 'config'], { env: lifecycleEnv(fixture, { SYNTHETIC_PORT: port }) });
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

test('loopback URL validation accepts only an exact credential-free root URL and matching values', () => {
  assert.equal(loopbackUrlIssue('http://127.0.0.1:4173', 'http://127.0.0.1:4173'), null);
  for (const [origin, siteUrl] of [
    ['http://127.0.0.1:4173', 'http://127.0.0.1:4273'],
    ['https://127.0.0.1:4173', 'https://127.0.0.1:4173'],
    ['http://localhost:4173', 'http://localhost:4173'],
    ['http://127.0.0.1:4173@evil.example', 'http://127.0.0.1:4173@evil.example'],
    ['http://127.0.0.1.evil.example:4173', 'http://127.0.0.1.evil.example:4173'],
    ['http://2130706433:4173', 'http://2130706433:4173'],
    ['http://0177.0.0.1:4173', 'http://0177.0.0.1:4173'],
    ['http://user:pass@127.0.0.1:4173', 'http://user:pass@127.0.0.1:4173'],
    ['http://127.0.0.1', 'http://127.0.0.1'],
    ['http://127.0.0.1:80', 'http://127.0.0.1:80'],
    ['http://127.0.0.1:65536', 'http://127.0.0.1:65536'],
    ['http://127.0.0.1:4173/portal', 'http://127.0.0.1:4173/portal'],
    ['http://127.0.0.1:4173/?poison=1', 'http://127.0.0.1:4173/?poison=1'],
    ['http://127.0.0.1:4173/#poison', 'http://127.0.0.1:4173/#poison'],
    ['not a url', 'not a url'],
  ]) {
    assert.notEqual(loopbackUrlIssue(origin, siteUrl), null, `${origin} / ${siteUrl}`);
  }
});

test('HTTP smoke refuses a normalized numeric loopback alias before any request', () => {
  const result = run(process.execPath, ['synthetic/http-smoke.mjs', 'http://2130706433:4173']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP smoke target rejected/);
});

test('HTTP smoke follows API material/game URLs and validates concrete completed homework', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, cookie: request.headers.cookie });
    if (request.url?.startsWith('/enter?t=s.92001.')) {
      response.writeHead(303, {
        location: '/app/student?s=synthetic-student-gamma',
        'set-cookie': 'maab_family=fixed-test-session; Path=/; HttpOnly; SameSite=Lax',
      }).end();
    } else if (request.url === '/app/student?s=synthetic-student-gamma') {
      response.writeHead(request.headers.cookie === 'maab_family=fixed-test-session' ? 200 : 401).end('student page');
    } else if (request.url === '/api/portal/synthetic-student-gamma') {
      response.writeHead(request.headers.cookie === 'maab_family=fixed-test-session' ? 200 : 401, {
        'content-type': 'application/json',
      }).end(JSON.stringify({
        name: 'תלמידת בדיקה גמא',
        lessons: [{ slidesUrl: '/lessons/synthetic-quadratic-formulas' }],
        games: [{
          dataId: 'synthetic-linear-formulas',
          url: '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature',
        }],
        homework: [{
          id: 95001,
          task: 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
          submitted: true,
          graded: true,
          grade: 'ok',
          gradedBy: 'teacher',
          template: 'quiz',
          dataId: 'synthetic-linear-formulas',
        }],
      }));
    } else if (request.url === '/lessons/synthetic-quadratic-formulas') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p>');
    } else if (request.url === '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<h1>בדיקה סינתטית — נוסחאות של פונקציה ריבועית</h1><p>אם y = x², מה הערך של y כאשר x = 3?</p>');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['synthetic/http-smoke.mjs', `http://127.0.0.1:${address.port}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  await new Promise((resolve) => server.close(resolve));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lesson, game, and completed homework HTTP smoke passed/);
  assert.deepEqual(requests.map(({ url }) => url), [
    requests[0].url,
    '/app/student?s=synthetic-student-gamma',
    '/api/portal/synthetic-student-gamma',
    '/lessons/synthetic-quadratic-formulas',
    '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature',
  ]);
  assert.equal(requests.length, 5);
  assert.equal(requests[1].cookie, 'maab_family=fixed-test-session');
  assert.equal(requests[2].cookie, 'maab_family=fixed-test-session');
  assert.equal(requests[3].cookie, undefined);
  assert.equal(requests[4].cookie, undefined);
});

for (const redirectCase of [
  {
    name: 'student page',
    path: '/app/student?s=synthetic-student-gamma',
    expectedError: /student portal page smoke returned HTTP 302/,
  },
  {
    name: 'portal API',
    path: '/api/portal/synthetic-student-gamma',
    expectedError: /student portal API smoke returned HTTP 302/,
  },
]) {
  test(`HTTP smoke rejects a ${redirectCase.name} redirect without contacting its foreign target`, async () => {
    let escapedRequests = 0;
    const portalBody = JSON.stringify({
      name: 'תלמידת בדיקה גמא',
      lessons: [{ slidesUrl: '/lessons/synthetic-quadratic-formulas' }],
      games: [{
        dataId: 'synthetic-linear-formulas',
        url: '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature',
      }],
      homework: [{
        id: 95001,
        task: 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
        submitted: true,
        graded: true,
        grade: 'ok',
        gradedBy: 'teacher',
        template: 'quiz',
        dataId: 'synthetic-linear-formulas',
      }],
    });
    const escaped = createServer((_request, response) => {
      escapedRequests += 1;
      if (redirectCase.name === 'portal API') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(portalBody);
      } else {
        response.writeHead(200).end('foreign student page');
      }
    });
    await new Promise((resolve) => escaped.listen(0, '127.0.0.1', resolve));
    const escapedAddress = escaped.address();
    assert.ok(escapedAddress && typeof escapedAddress === 'object');

    const server = createServer((request, response) => {
      if (request.url?.startsWith('/enter?t=s.92001.')) {
        response.writeHead(303, {
          location: '/app/student?s=synthetic-student-gamma',
          'set-cookie': 'maab_family=fixed-test-session; Path=/; HttpOnly; SameSite=Lax',
        }).end();
      } else if (request.url === redirectCase.path) {
        response.writeHead(302, { location: `http://127.0.0.1:${escapedAddress.port}/sentinel` }).end();
      } else if (request.url === '/app/student?s=synthetic-student-gamma') {
        response.writeHead(200).end('student page');
      } else if (request.url === '/api/portal/synthetic-student-gamma') {
        response.writeHead(200, { 'content-type': 'application/json' }).end(portalBody);
      } else if (request.url === '/lessons/synthetic-quadratic-formulas') {
        response.writeHead(200).end('<h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p>');
      } else if (request.url?.startsWith('/app/play/quiz?')) {
        response.writeHead(200).end('<h1>בדיקה סינתטית — נוסחאות של פונקציה ריבועית</h1><p>אם y = x², מה הערך של y כאשר x = 3?</p>');
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    try {
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, ['synthetic/http-smoke.mjs', `http://127.0.0.1:${address.port}`], {
          cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });

      assert.notEqual(result.status, 0);
      assert.match(result.stderr, redirectCase.expectedError);
      assert.equal(escapedRequests, 0, 'HTTP smoke contacted a foreign redirect target');
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => escaped.close(resolve));
    }
  });
}

test('HTTP smoke never follows a returned fixture redirect off the synthetic origin', async () => {
  let escapedRequests = 0;
  const escaped = createServer((_request, response) => {
    escapedRequests += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<h1>בדיקה סינתטית — נוסחאות של פונקציה ריבועית</h1><p>אם y = x², מה הערך של y כאשר x = 3?</p>');
  });
  await new Promise((resolve) => escaped.listen(0, '127.0.0.1', resolve));
  const escapedAddress = escaped.address();
  assert.ok(escapedAddress && typeof escapedAddress === 'object');

  const server = createServer((request, response) => {
    if (request.url?.startsWith('/enter?t=s.92001.')) {
      response.writeHead(303, {
        location: '/app/student?s=synthetic-student-gamma',
        'set-cookie': 'maab_family=fixed-test-session; Path=/; HttpOnly; SameSite=Lax',
      }).end();
    } else if (request.url === '/app/student?s=synthetic-student-gamma') {
      response.writeHead(200).end('student page');
    } else if (request.url === '/api/portal/synthetic-student-gamma') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        name: 'תלמידת בדיקה גמא',
        lessons: [{ slidesUrl: '/lessons/synthetic-quadratic-formulas' }],
        games: [{
          dataId: 'synthetic-linear-formulas',
          url: '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature',
        }],
        homework: [{
          id: 95001,
          task: 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
          submitted: true,
          graded: true,
          grade: 'ok',
          gradedBy: 'teacher',
          template: 'quiz',
          dataId: 'synthetic-linear-formulas',
        }],
      }));
    } else if (request.url === '/lessons/synthetic-quadratic-formulas') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end('<h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p>');
    } else if (request.url?.startsWith('/app/play/quiz?')) {
      response.writeHead(302, { location: `http://127.0.0.1:${escapedAddress.port}/escaped` }).end();
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['synthetic/http-smoke.mjs', `http://127.0.0.1:${address.port}`], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => escaped.close(resolve));

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signed game smoke returned HTTP 302/);
  assert.equal(escapedRequests, 0, 'HTTP smoke followed a redirect off the synthetic origin');
});

test('HTTP smoke rejects a lesson redirect without contacting its foreign target', async () => {
  let escapedRequests = 0;
  const escaped = createServer((_request, response) => {
    escapedRequests += 1;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end('<h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p>');
  });
  await new Promise((resolve) => escaped.listen(0, '127.0.0.1', resolve));
  const escapedAddress = escaped.address();
  assert.ok(escapedAddress && typeof escapedAddress === 'object');

  const server = createServer((request, response) => {
    if (request.url?.startsWith('/enter?t=s.92001.')) {
      response.writeHead(303, {
        location: '/app/student?s=synthetic-student-gamma',
        'set-cookie': 'maab_family=fixed-test-session; Path=/; HttpOnly; SameSite=Lax',
      }).end();
    } else if (request.url === '/app/student?s=synthetic-student-gamma') {
      response.writeHead(200).end('student page');
    } else if (request.url === '/api/portal/synthetic-student-gamma') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        name: 'תלמידת בדיקה גמא',
        lessons: [{ slidesUrl: '/lessons/synthetic-quadratic-formulas' }],
        games: [{
          dataId: 'synthetic-linear-formulas',
          url: '/app/play/quiz?d=synthetic-linear-formulas&s=synthetic-student-gamma&t=fixed-signature',
        }],
        homework: [{
          id: 95001,
          task: 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
          submitted: true,
          graded: true,
          grade: 'ok',
          gradedBy: 'teacher',
          template: 'quiz',
          dataId: 'synthetic-linear-formulas',
        }],
      }));
    } else if (request.url === '/lessons/synthetic-quadratic-formulas') {
      response.writeHead(302, { location: `http://127.0.0.1:${escapedAddress.port}/sentinel` }).end();
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['synthetic/http-smoke.mjs', `http://127.0.0.1:${address.port}`], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lesson material smoke returned HTTP 302/);
    assert.equal(escapedRequests, 0, 'HTTP smoke contacted the foreign lesson redirect target');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => escaped.close(resolve));
  }
});

test('portal fixture is deterministic, exact, atomic, and cleans stale files on rerun', async () => {
  const portalDir = await mkdtemp(join(tmpdir(), 'synthetic-portal-'));
  await writeFile(join(portalDir, 'real-student-sentinel.json'), '{"name":"must disappear"}\n');
  await mkdir(join(portalDir, 'stale-directory'));
  await writeFile(join(portalDir, 'stale-directory', 'nested'), 'must disappear');

  seedSyntheticPortal(portalDir);
  assert.deepEqual(await readdir(portalDir), [PORTAL_FILE_NAME]);
  assert.equal(await readFile(join(portalDir, PORTAL_FILE_NAME), 'utf8'), PORTAL_FILE_TEXT);
  const portal = JSON.parse(PORTAL_FILE_TEXT);
  assert.deepEqual(portal.lessons, [{
    date: '2026-01-15', topic: 'שיעור בדיקה: y = x²', slug: 'synthetic-quadratic-formulas',
  }]);
  assert.doesNotThrow(() => verifySyntheticPortal(portalDir));

  await chmod(join(portalDir, PORTAL_FILE_NAME), 0o644);
  await writeFile(join(portalDir, PORTAL_FILE_NAME), '{"name":"corrupt"}\n');
  await writeFile(join(portalDir, '.stale-seed.tmp'), 'partial');
  seedSyntheticPortal(portalDir);
  assert.deepEqual(await readdir(portalDir), [PORTAL_FILE_NAME]);
  assert.equal(await readFile(join(portalDir, PORTAL_FILE_NAME), 'utf8'), PORTAL_FILE_TEXT);
  assert.doesNotThrow(() => verifySyntheticPortal(portalDir));
});

test('portal verification rejects changed content and every unexpected portal entry', async () => {
  const portalDir = await mkdtemp(join(tmpdir(), 'synthetic-portal-verify-'));
  seedSyntheticPortal(portalDir);
  await chmod(join(portalDir, PORTAL_FILE_NAME), 0o644);
  await writeFile(join(portalDir, PORTAL_FILE_NAME), '{"name":"changed"}\n');
  assert.throws(() => verifySyntheticPortal(portalDir), /content/);
  seedSyntheticPortal(portalDir);
  await writeFile(join(portalDir, 'unexpected.json'), '{}');
  assert.throws(() => verifySyntheticPortal(portalDir), /unexpected/);
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
    else if (table === 'students_v2') db.exec('CREATE TABLE students_v2 (id INTEGER PRIMARY KEY, code TEXT, name TEXT, emoji TEXT, account_id INTEGER REFERENCES accounts(id), progress INTEGER, progress_note TEXT, credential TEXT, created_at TEXT, goals TEXT, style TEXT, notes TEXT)');
    else if (table === 'teachers') db.exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, active INTEGER, meet_url TEXT, meet_account TEXT, setup_hash TEXT, setup_expires TEXT, calendar_id TEXT, busy_ics TEXT, teaching_hours TEXT)');
    else if (table === 'enrollments') db.exec('CREATE TABLE enrollments (id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students_v2(id), subject TEXT, level TEXT, teacher_id INTEGER REFERENCES teachers(id))');
    else if (table === 'bookings_v2') db.exec('CREATE TABLE bookings_v2 (id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students_v2(id), enrollment_id INTEGER REFERENCES enrollments(id), start TEXT, end TEXT, duration INTEGER, at TEXT, status TEXT, source_utm TEXT, heard_from TEXT, mode TEXT, teacher_id INTEGER REFERENCES teachers(id), heard_from_detail TEXT)');
    else if (table === 'lessons') db.exec('CREATE TABLE lessons (id INTEGER PRIMARY KEY, slug TEXT, student TEXT, subject TEXT, level TEXT, topic TEXT, title TEXT, context TEXT, at TEXT, lesson_at TEXT, status TEXT, problem TEXT, slides TEXT, homework TEXT, games TEXT)');
    else if (table === 'lesson_materials') db.exec('CREATE TABLE lesson_materials (id INTEGER PRIMARY KEY, lesson_slug TEXT, kind TEXT, version INTEGER, content TEXT, teacher_only TEXT, origin TEXT, published_at TEXT, created_at TEXT)');
    else if (table === 'homework') db.exec('CREATE TABLE homework (id INTEGER PRIMARY KEY, lesson_id INTEGER, student_id INTEGER REFERENCES students_v2(id), task TEXT, template TEXT, data_id TEXT, assigned_at TEXT, due_at TEXT, submitted_at TEXT, submitted_by TEXT, graded_at TEXT, grade TEXT, graded_by TEXT, node_id INTEGER, booking_id INTEGER REFERENCES bookings_v2(id), held_until TEXT, answer TEXT)');
    else if (table === 'results_v2') db.exec('CREATE TABLE results_v2 (id INTEGER PRIMARY KEY, student_id INTEGER REFERENCES students_v2(id), at TEXT, data_id TEXT, template TEXT, score INTEGER, total INTEGER, tries INTEGER, stars INTEGER, seconds INTEGER, missed TEXT, hints INTEGER)');
    else if (table === 'game_filler') db.exec('CREATE TABLE game_filler (id TEXT PRIMARY KEY, body TEXT)');
    else if (table === 'lesson_reports') db.exec('CREATE TABLE lesson_reports (id INTEGER PRIMARY KEY, booking_id INTEGER REFERENCES bookings_v2(id), student_id INTEGER REFERENCES students_v2(id), enrollment_id INTEGER REFERENCES enrollments(id), note TEXT, created_at TEXT, updated_at TEXT)');
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
  assert.deepEqual({ ...db.prepare('SELECT * FROM lesson_materials').get() }, {
    id: 98501,
    lesson_slug: 'synthetic-quadratic-formulas',
    kind: 'slides',
    version: 1,
    content: '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שיעור בדיקה סינתטי</title></head><body><main><h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p></main></body></html>',
    teacher_only: null,
    origin: 'generated',
    published_at: '2026-01-15T10:00:00.000Z',
    created_at: '2026-01-15T10:00:00.000Z',
  });

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
    ['lesson_materials', "UPDATE lesson_materials SET content = 'unexpected-content'"],
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

test('foreign-key enforcement rejects violations and verifier independently detects existing ones', () => {
  const db = createPolicyFixture();
  db.exec('PRAGMA foreign_keys = ON');
  assert.throws(
    () => db.prepare("INSERT INTO students_v2 (id, code, account_id) VALUES (1, 'orphan', 999999)").run(),
    /FOREIGN KEY constraint failed/,
  );

  const seeded = createPolicyFixture();
  seedSyntheticRows(seeded);
  seeded.exec('PRAGMA foreign_keys = OFF');
  seeded.exec('UPDATE students_v2 SET account_id = 999999 WHERE id = 92001');
  assert.throws(() => verifySyntheticDatabase(seeded), /foreign key/i);
  db.close();
  seeded.close();
});

test('synthetic seed transaction keeps FK enforcement on and rolls back a deferred violation before commit', () => {
  const db = createPolicyFixture();
  assert.throws(() => replaceSyntheticDatabase(db, {
    afterSeed: (transaction) => {
      assert.equal(transaction.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
      transaction.exec('UPDATE students_v2 SET account_id = 999999 WHERE id = 92001');
    },
  }), /foreign key/i);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students_v2').get().n, 0);
  db.close();
});
