/**
 * scripts/connect-calendar.sh: swapping the calendar robot's key.
 *
 * Every booking signs in with the key file this script replaces, so the
 * three things it must never get wrong are the three tested here: a key
 * that cannot write never reaches production; a key that can is written
 * over the mounted file in place (the container bind-mounts that one file,
 * and a `mv` would leave it reading the old inode until a restart); and if
 * the running app still cannot write with it, the old key goes back.
 *
 * `ssh` and `docker` are fakes on PATH: ssh runs the remote command here,
 * against a temp directory standing in for the server, and docker answers
 * the probe with whatever the test asks for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/connect-calendar.sh');
const OLD = JSON.stringify({ client_email: 'meabeclick@old-project.iam.gserviceaccount.com', private_key: 'OLD-PRIVATE-KEY' });
const NEW_EMAIL = 'calendar-writer@meabeclick-site.iam.gserviceaccount.com';
const NEW = JSON.stringify({ type: 'service_account', client_email: NEW_EMAIL, private_key: '-----BEGIN PRIVATE KEY-----\nNEW-SECRET\n' });
const ENV = 'ADMIN_PASSWORD=x\nGOOGLE_SERVICE_ACCOUNT_EMAIL=meabeclick@old-project.iam.gserviceaccount.com\nCALENDAR_ID=lessons@group.calendar.google.com\n';

/* Every active tutor's lesson calendar, as the running app's database lists
   them (migration 029): the new robot must be able to write into each. */
const CALENDARS = 'lessons@group.calendar.google.com\nlior-lessons@group.calendar.google.com\n';

function setup({ runExit = 0, execExit = 0, calendars = CALENDARS } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'connect-calendar-'));
  const srv = join(root, 'srv');
  const bin = join(root, 'bin');
  const log = join(root, 'docker.log');
  spawnSync('mkdir', ['-p', srv, bin]);
  writeFileSync(join(srv, 'service-account.json'), OLD, { mode: 0o400 });
  writeFileSync(join(srv, '.env'), ENV, { mode: 0o600 });
  writeFileSync(join(root, 'new-key.json'), NEW);
  writeFileSync(join(root, 'calendars.txt'), calendars);

  writeFileSync(join(bin, 'ssh'), `#!/usr/bin/env bash
while [[ "$1" == -* ]]; do shift; done
shift # the host
exec bash -c "$*"
`);
  // The fake records each call, and for the two probes, which key file the
  // probe would have read at that moment. `exec -i` without a key path is
  // the listing of the tutors' lesson calendars.
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "docker $*" >> ${JSON.stringify(log)}
case "$1" in
  inspect) echo "ghcr.io/example/app:abc123" ;;
  exec)
    if [[ "$2" == "-i" ]]; then
      cat > /dev/null
      if [[ "$*" == *service-account.json* ]]; then
        echo "live probe sees: $(cat ${JSON.stringify(join(srv, 'service-account.json'))}) args: $*" >> ${JSON.stringify(log)}
        exit ${execExit}
      fi
      cat ${JSON.stringify(join(root, 'calendars.txt'))}
      exit 0
    fi ;;
  run)
    cat > /dev/null
    echo "new-key probe args: $*" >> ${JSON.stringify(log)}
    exit ${runExit} ;;
esac
`);
  chmodSync(join(bin, 'ssh'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);

  /* With `piped`, the key arrives the way the header documents it:
     `<(ssh mac cat …)`, a pipe the script can open once. */
  const run = (piped) => spawnSync('bash', piped == null
    ? [SCRIPT, join(root, 'new-key.json')]
    : ['-c', 'exec bash "$1" <(printf "%s" "$KEY_CONTENT")', '_', SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KEY_CONTENT: piped ?? '',
      PATH: `${bin}:${process.env.PATH}`,
      SERVER: 'fake-server', DIR: srv, CONTAINER: 'app-1',
      OWNER: `${process.getuid()}:${process.getgid()}`,
    },
  });
  const read = f => readFileSync(join(srv, f), 'utf8');
  const files = () => readdirSync(srv).sort();
  const dockerLog = () => (existsSync(log) ? readFileSync(log, 'utf8') : '');
  return { srv, run, read, files, dockerLog, inode: () => statSync(join(srv, 'service-account.json')).ino };
}

test('a key that cannot write leaves production untouched', () => {
  const s = setup({ runExit: 1 });
  const r = s.run();
  assert.notEqual(r.status, 0);
  assert.equal(s.read('service-account.json'), OLD);
  assert.equal(s.read('.env'), ENV);
  assert.deepEqual(s.files(), ['.env', 'service-account.json'], 'no .new key and no backups left behind');
  assert.doesNotMatch(s.dockerLog(), /live probe/, 'the running app is never asked');
  assert.match(r.stderr, /nothing was changed/);
});

test("the new key is probed against every tutor's lesson calendar, from the running app's database", () => {
  const s = setup({ runExit: 1 });
  s.run();
  assert.match(s.dockerLog(), /docker run .*service-account\.json\.new:\/probe-key\.json:ro .*ghcr\.io\/example\/app:abc123/);
  assert.match(s.dockerLog(),
    /new-key probe args: .*\/probe-key\.json lessons@group\.calendar\.google\.com lior-lessons@group\.calendar\.google\.com/);
  assert.doesNotMatch(s.dockerLog(), /printenv/, 'nothing reads CALENDAR_ID from the environment any more');
});

test("the running app's probe writes into every tutor's lesson calendar too", () => {
  const s = setup();
  assert.equal(s.run().status, 0);
  assert.match(s.dockerLog(),
    /live probe sees: .*args: .*\/app\/service-account\.json lessons@group\.calendar\.google\.com lior-lessons@group\.calendar\.google\.com/);
});

test('with no tutor lesson calendar to test, or one that is not a calendar id, nothing changes', () => {
  for (const calendars of ['', 'x@y.com; rm -rf /\n']) {
    const s = setup({ calendars });
    const r = s.run();
    assert.notEqual(r.status, 0, JSON.stringify(calendars));
    assert.match(r.stderr, /lesson calendar/);
    assert.equal(s.read('service-account.json'), OLD);
    assert.doesNotMatch(s.dockerLog(), /new-key probe|live probe/);
    assert.deepEqual(s.files(), ['.env', 'service-account.json']);
  }
});

test('a key that writes replaces the mounted file in place, keeping the old one', () => {
  const s = setup();
  const before = s.inode();
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read('service-account.json'), NEW);
  assert.equal(s.inode(), before, 'same file, so the container sees it without a restart');
  assert.equal(statSync(`${s.srv}/service-account.json`).mode & 0o777, 0o400);
  const backups = s.files().filter(f => f.startsWith('service-account.json.bak-'));
  assert.equal(backups.length, 1);
  assert.equal(s.read(backups[0]), OLD);
  assert.ok(!s.files().includes('service-account.json.new'));
  assert.match(s.dockerLog(), /live probe sees: .*NEW-SECRET/, 'the live probe ran after the swap');
});

test('the robot email in .env follows the key, and nothing else in .env changes', () => {
  const s = setup();
  s.run();
  assert.equal(s.read('.env'), ENV.replace(/^GOOGLE_SERVICE_ACCOUNT_EMAIL=.*$/m, `GOOGLE_SERVICE_ACCOUNT_EMAIL=${NEW_EMAIL}`));
  const envBackups = s.files().filter(f => f.startsWith('.env.bak-'));
  assert.equal(envBackups.length, 1);
  assert.equal(s.read(envBackups[0]), ENV);
});

test('if the running app cannot write with the new key, the old key goes back', () => {
  const s = setup({ execExit: 1 });
  const before = s.inode();
  const r = s.run();
  assert.notEqual(r.status, 0);
  assert.equal(s.read('service-account.json'), OLD);
  assert.equal(s.inode(), before);
  assert.equal(s.read('.env'), ENV);
  assert.match(r.stderr, /old key is back/);
});

test('the key can arrive on a pipe, which can only be read once', () => {
  const s = setup();
  const r = s.run(NEW);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read('service-account.json'), NEW);
});

test('the private key is never printed', () => {
  for (const exits of [{}, { runExit: 1 }, { execExit: 1 }]) {
    const r = setup(exits).run();
    assert.doesNotMatch(r.stdout + r.stderr, /NEW-SECRET|PRIVATE KEY/);
  }
});

test('a file that is not a service-account key is refused before the server is touched', () => {
  const s = setup();
  for (const bad of ['{"installed":{"client_id":"x"}}', 'not json',
    JSON.stringify({ client_email: 'x@y.com; rm -rf /', private_key: 'k' })]) {
    const r = s.run(bad);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not a service-account key/);
  }
  assert.equal(s.read('service-account.json'), OLD);
  assert.equal(s.dockerLog(), '');
  assert.deepEqual(s.files(), ['.env', 'service-account.json']);
});
