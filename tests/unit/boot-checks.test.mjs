import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const {
  checkEnv,
  checkDataDir,
  checkPortalDir,
  checkLessonEngine,
  systemCaBundlePath,
  REQUIRED_VARS,
  checkRegistry,
  envIssues,
} = await import('../../src/lib/server/boot-checks.ts');

// Derived from the module's own registry, never restated: a hardcoded copy
// goes stale the moment a variable is added, and then fails in a way that
// looks like the NEW variable is broken rather than like the test is.
const ALL_REQUIRED = REQUIRED_VARS.map(v => v.key);

/** A value each required var will accept. PROTOCOL_HEADER is the only one
 *  with a validator, so it is the only one that cannot take a placeholder. */
const VALID = {
  PROTOCOL_HEADER: 'x-forwarded-proto',
  SITE_URL: 'http://localhost:5173',
  ORIGIN: 'http://localhost:5173',
};

function setAllRequired(dataDir) {
  for (const key of ALL_REQUIRED) {
    process.env[key] = VALID[key] ?? (key === 'DATA_DIR' ? dataDir : `test-${key.toLowerCase()}`);
  }
}

test('refuses to boot without SITE_URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-'));
  setAllRequired(dir);
  delete process.env.SITE_URL;
  assert.throws(() => checkEnv(), /SITE_URL/);
});

test('reports every missing var at once, not just the first', () => {
  const dir = '/does/not/matter';
  setAllRequired(dir);
  delete process.env.SITE_URL;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.PROTOCOL_HEADER;

  const missing = envIssues().map(v => v.key);
  assert.deepEqual(missing.sort(), ['ADMIN_PASSWORD', 'PROTOCOL_HEADER', 'SITE_URL'].sort());

  assert.throws(() => checkEnv(), (err) => {
    assert.match(err.message, /SITE_URL/);
    assert.match(err.message, /ADMIN_PASSWORD/);
    assert.match(err.message, /PROTOCOL_HEADER/);
    return true;
  });
});

test('never echoes a secret value in the thrown message', () => {
  const dir = '/does/not/matter';
  setAllRequired(dir);
  process.env.SESSION_SECRET = 'super-secret-value-do-not-leak';
  process.env.ADMIN_PASSWORD = 'another-secret-do-not-leak';
  delete process.env.SITE_URL; // trigger a throw so we get a message to inspect

  assert.throws(() => checkEnv(), (err) => {
    assert.doesNotMatch(err.message, /super-secret-value-do-not-leak/);
    assert.doesNotMatch(err.message, /another-secret-do-not-leak/);
    return true;
  });
});

test('passes when every required var is set', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-'));
  setAllRequired(dir);
  assert.doesNotThrow(() => checkEnv());
  for (const key of ALL_REQUIRED) assert.ok(process.env[key], key);
});

test('PROTOCOL_HEADER present but wrong refuses to boot, not just PROTOCOL_HEADER unset', () => {
  const dir = '/does/not/matter';
  setAllRequired(dir);
  process.env.PROTOCOL_HEADER = 'X-Forwarded-For'; // set, but the wrong header entirely

  const issues = envIssues();
  const issue = issues.find(i => i.key === 'PROTOCOL_HEADER');
  assert.ok(issue, 'expected an issue for a wrong PROTOCOL_HEADER value');
  assert.match(issue.message, /x-forwarded-proto/);

  assert.throws(() => checkEnv(), /PROTOCOL_HEADER/);
});

test('PROTOCOL_HEADER value check is case-insensitive (adapter-node lowercases it too)', () => {
  const dir = '/does/not/matter';
  setAllRequired(dir);
  process.env.PROTOCOL_HEADER = 'X-Forwarded-Proto';
  assert.doesNotThrow(() => checkEnv());
});

test('checkDataDir passes for a writable directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-'));
  process.env.DATA_DIR = dir;
  await assert.doesNotReject(() => checkDataDir());
});

test('checkDataDir refuses to boot when DATA_DIR is not writable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-ro-'));
  await chmod(dir, 0o555);
  process.env.DATA_DIR = dir;
  try {
    await assert.rejects(() => checkDataDir(), /not writable|does not exist/);
  } finally {
    await chmod(dir, 0o755); // restore so the test runner can clean up
  }
});

test('checkDataDir refuses to boot when DATA_DIR does not exist', async () => {
  process.env.DATA_DIR = '/definitely/does/not/exist/anywhere';
  await assert.rejects(() => checkDataDir(), /does not exist|not writable/);
});

test('checkPortalDir passes for a writable directory and logs the resolved path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-portal-'));
  process.env.PORTAL_DIR = dir;
  const original = console.log;
  let logged = '';
  console.log = (msg) => { logged += msg; };
  try {
    assert.doesNotThrow(() => checkPortalDir());
  } finally {
    console.log = original;
    delete process.env.PORTAL_DIR;
  }
  assert.match(logged, /PORTAL_DIR resolved to/);
  assert.match(logged, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('checkPortalDir refuses to boot when PORTAL_DIR is not writable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-portal-ro-'));
  await chmod(dir, 0o555);
  process.env.PORTAL_DIR = dir;
  try {
    assert.throws(() => checkPortalDir(), /not writable|does not exist/);
  } finally {
    await chmod(dir, 0o755); // restore so the test runner can clean up
    delete process.env.PORTAL_DIR;
  }
});

test('checkPortalDir refuses to boot when PORTAL_DIR does not exist', () => {
  process.env.PORTAL_DIR = '/definitely/does/not/exist/anywhere/portal';
  try {
    assert.throws(() => checkPortalDir(), /does not exist|not writable/);
  } finally {
    delete process.env.PORTAL_DIR;
  }
});

// checkLessonEngine covers both halves of "can this server generate a
// lesson": the binary runs, AND credentials exist. The second half is why
// these tests exist at all — `claude --version` passed happily throughout the
// outage that motivated this module, because the binary was never the
// problem.
//

/** Runs fn with console.warn captured, returning the warnings it emitted. */
function capturingWarnings(fn) {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    assert.doesNotThrow(fn);
  } finally {
    console.warn = original;
  }
  return warnings;
}

/** A CODEX_HOME with credentials in it, so the binary check is what's under
 *  test rather than the credential check standing in for it. */
async function authedCodexHome() {
  const dir = await mkdtemp(join(tmpdir(), 'codex-home-'));
  await writeFile(join(dir, 'auth.json'), '{"auth_mode":"chatgpt"}');
  return dir;
}

test('checkLessonEngine warns rather than throws when the binary is not runnable', async () => {
  process.env.CODEX_BIN = '/definitely/not/a/real/binary';
  process.env.CODEX_HOME = await authedCodexHome();
  try {
    const warnings = capturingWarnings(() => checkLessonEngine());
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not runnable/);
  } finally {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_HOME;
  }
});

test('checkLessonEngine warns rather than throws when the binary hangs past its timeout', async () => {
  // A script that ignores its argv (including --version) and just sleeps —
  // exercises the same failure path a stalled agent process would (waiting on
  // stdin, a stuck network call). The 5s budget must cut this off; it must
  // still only warn, never block boot.
  const dir = await mkdtemp(join(tmpdir(), 'boot-checks-hang-'));
  const script = join(dir, 'hang.sh');
  await writeFile(script, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
  process.env.CODEX_BIN = script;
  process.env.CODEX_HOME = await authedCodexHome();

  const start = Date.now();
  try {
    const warnings = capturingWarnings(() => checkLessonEngine());
    assert.match(warnings[0] ?? '', /not runnable/);
  } finally {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_HOME;
  }
  assert.ok(Date.now() - start < 10_000, 'expected the timeout to actually bound the wait');
});

test('checkLessonEngine warns when the binary runs but no credentials exist', async () => {
  // The outage this module was written after: a healthy binary, a dead
  // credential, and a boot that said nothing. /bin/true stands in for a CLI
  // whose --version succeeds.
  process.env.CODEX_BIN = '/bin/true';
  process.env.CODEX_HOME = await mkdtemp(join(tmpdir(), 'codex-empty-'));  // no auth.json
  const hadKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const warnings = capturingWarnings(() => checkLessonEngine());
    assert.equal(warnings.length, 1, 'a runnable binary with no credentials must still warn');
    assert.match(warnings[0], /no credentials/);
    assert.match(warnings[0], /auth\.json/, 'the warning should say what to mount');
  } finally {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_HOME;
    if (hadKey !== undefined) process.env.OPENAI_API_KEY = hadKey;
  }
});

test('checkLessonEngine passes silently when the binary runs and credentials exist', async () => {
  process.env.CODEX_BIN = '/bin/true';
  process.env.CODEX_HOME = await authedCodexHome();
  try {
    assert.deepEqual(capturingWarnings(() => checkLessonEngine()), []);
  } finally {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_HOME;
  }
});

test('checkLessonEngine warns when the system CA bundle is missing', async () => {
  // The failure this catches: node:22-slim carries no ca-certificates. Node
  // has its own bundled roots, so the app's HTTPS calls all keep working and
  // nothing looks wrong — but codex is a Rust binary that trusts the SYSTEM
  // store, and every request it makes dies at the TLS handshake as a bare
  // "error sending request for url", on a container whose DNS and egress are
  // provably fine. It cost a deploy cycle to find once.
  //
  // SSL_CERT_FILE is pointed at a path that does not exist, which also
  // asserts the override is checked for existence rather than merely being
  // set.
  process.env.CODEX_BIN = '/bin/true';
  process.env.CODEX_HOME = await authedCodexHome();
  const hadCertFile = process.env.SSL_CERT_FILE;
  const hadCertDir = process.env.SSL_CERT_DIR;
  process.env.SSL_CERT_FILE = join(tmpdir(), 'no-such-ca-bundle.crt');
  delete process.env.SSL_CERT_DIR;

  try {
    // Deterministic on any host: SSL_CERT_FILE is what OpenSSL consults once
    // set, so naming a missing file means no usable store, whatever the
    // distro defaults happen to be on the machine running this suite.
    assert.equal(systemCaBundlePath(), null);
    const warnings = capturingWarnings(() => checkLessonEngine());
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /no system CA bundle/);
    assert.match(warnings[0], /ca-certificates/, 'the warning must name the fix');
  } finally {
    delete process.env.CODEX_BIN;
    delete process.env.CODEX_HOME;
    if (hadCertFile !== undefined) process.env.SSL_CERT_FILE = hadCertFile; else delete process.env.SSL_CERT_FILE;
    if (hadCertDir !== undefined) process.env.SSL_CERT_DIR = hadCertDir; else delete process.env.SSL_CERT_DIR;
  }
});

test('SSL_CERT_FILE names the bundle for an image that keeps it elsewhere', async () => {
  // Not every base image is Debian-family, so the hardcoded paths must not be
  // the only answer — otherwise the check becomes a false warning nobody can
  // silence.
  const dir = await mkdtemp(join(tmpdir(), 'ca-'));
  const bundle = join(dir, 'custom-roots.pem');
  await writeFile(bundle, '# not a real bundle');
  const had = process.env.SSL_CERT_FILE;
  process.env.SSL_CERT_FILE = bundle;
  try {
    assert.equal(systemCaBundlePath(), bundle);
  } finally {
    if (had !== undefined) process.env.SSL_CERT_FILE = had; else delete process.env.SSL_CERT_FILE;
  }
});


test('checkRegistry passes silently for the real games/registry.json', () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => { warned = true; };
  try {
    assert.doesNotThrow(() => checkRegistry());
  } finally {
    console.warn = original;
  }
  assert.equal(warned, false);
});

test('CALENDAR_ID is required, so no booking can be silently misrouted', async () => {
  // It used to fall back to a hardcoded personal address, so an unset value
  // did not fail — it routed every booking in the system to one person's
  // calendar. Invisible with one tutor; with two it is a misrouting bug that
  // presents as "the calendar did not sync".
  //
  // enrollments.teacher_id already records who teaches each subject, so the
  // per-teacher lookup that replaces this is a change to booking, not a
  // schema migration. Requiring the variable now is what keeps an unset
  // value from quietly picking a person in the meantime.
  const dir = await mkdtemp(join(tmpdir(), 'boot-cal-'));
  setAllRequired(dir);
  delete process.env.CALENDAR_ID;
  try {
    const issues = envIssues();
    assert.ok(issues.some(i => i.key === 'CALENDAR_ID'), 'an unset CALENDAR_ID must be reported at boot');
  } finally {
    for (const k of ALL_REQUIRED) delete process.env[k];
  }
});

test('no required var carries a personal address as its default', () => {
  // The rule the CALENDAR_ID fallback broke. A default that names a person
  // is a routing decision hiding in a config default.
  const src = readFileSync(join(root, 'src/routes/api/book/+server.ts'), 'utf8');
  const defaults = [...src.matchAll(/process\.env\.\w+\s*\|\|\s*'([^']+)'/g)].map(m => m[1]);
  for (const d of defaults) {
    assert.doesNotMatch(d, /@(gmail|googlemail)\.com/i,
      `a personal address is being used as a fallback: ${d}`);
  }
});
