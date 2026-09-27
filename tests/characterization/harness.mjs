// tests/characterization/harness.mjs
//
// Spawns the production build (`build/index.js`, adapter-node's output) for
// each test. Through Task 23 this could also spawn `server/app.mjs` — the
// pre-migration Express app — selected via a TARGET env var, so the same
// characterization suite could run as a diff detector against both
// implementations during the migration. Task 24 deleted server/app.mjs (and
// everything under api/, pages/, games/*.html) once the SvelteKit app was
// verified and cut over, so there is only one target left to spawn. Run
// `npm run build` before `npm test` — this harness does not build for you.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Ports are OS-assigned per call (bind to 0, read the assigned port, release
 * it) so parallel test files — each `node --test` file runs in its own child
 * process — never collide. There is a small window between releasing the
 * probe socket and the real server binding it, so startServer retries a
 * fresh port on EADDRINUSE.
 */
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const BLOCKED = [
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'CALLMEBOT_API_KEY', 'OPENAI_API_KEY',
  // The Drive login (the backups' and the lesson sync's): a test must never
  // create folders in the business's real Drive.
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN',
];

const MAX_PORT_ATTEMPTS = 3;

/** `ports` is a test seam: ports to try before asking the OS for free ones,
 *  so harness.test.mjs can hand it a port something else already answers. */
export async function startServer({ env = {}, ports = [] } = {}) {
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt++) {
    const port    = ports[attempt - 1] ?? await getFreePort();
    const dataDir = await mkdtemp(join(tmpdir(), 'meabeclick-test-'));
    const dbPath  = join(dataDir, 'results.db');
    // checkPortalDir() (src/lib/server/boot-checks.ts) refuses to boot the
    // production build unless PORTAL_DIR already exists — by design, so a
    // real deployment can't silently run with student PII resolving to a
    // directory nobody provisioned (see server/README.md's "Portal data"
    // section: this is a one-time seeding step ops does by hand, e.g.
    // `mkdir -p data/portal`). The harness plays the same role here.
    await mkdir(join(dataDir, 'portal'), { recursive: true });

    const childEnv = { ...process.env };
    for (const key of BLOCKED) delete childEnv[key];

    // Deleting env vars is no longer enough to keep generation switched off.
    // Codex credentials are a FILE ($CODEX_HOME/auth.json), so on any machine
    // that has run `codex login` — every dev machine — the booking tests would
    // sail past the credential gate and spawn real, billed agent runs. Point
    // CODEX_HOME at an empty directory inside this test's own temp dir so the
    // gate sees what CI sees.
    const codexHome = join(dataDir, 'codex-home-empty');
    await mkdir(codexHome, { recursive: true });
    childEnv.CODEX_HOME = codexHome;
    // Belt and braces: even if some future change slipped past the gate, this
    // makes a spawn fail instantly and locally rather than call an API.
    childEnv.CODEX_BIN = join(dataDir, 'no-such-agent');
    Object.assign(childEnv, {
      PORT: String(port),
      DB_PATH: dbPath,
      DATA_DIR: dataDir,
      PORTAL_DIR: join(dataDir, 'portal'),
      ADMIN_PASSWORD: 'test-password',
      SESSION_SECRET: 'test-secret-not-a-real-one',
      SITE_URL: `http://127.0.0.1:${port}`,
      ORIGIN: `http://127.0.0.1:${port}`,
      // Required by boot-checks.ts (Task 21) — see src/routes/api/login/+server.ts's
      // comment on the cookie `secure` flag for why adapter-node needs this set.
      PROTOCOL_HEADER: 'x-forwarded-proto',
      // Required at boot since the hardcoded personal-calendar fallback was
      // removed. The value is never used: GOOGLE_SERVICE_ACCOUNT_* are in
      // BLOCKED, so no test reaches Google.
      CALENDAR_ID: 'test-calendar@example.com',
      ...env,
    });

    // The only remaining target since Task 24 deleted server/app.mjs — see
    // this module's header comment. Requires `npm run build` to have been
    // run first; a missing build/index.js surfaces as a boot error below
    // (MODULE_NOT_FOUND in stderr), not a silent hang.
    const child = spawn('node', ['build/index.js'], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', c => { stderr += c; });
    /* adapter-node prints this from listen()'s callback — only once THIS
       child owns the port. See the readiness loop below for why an answer
       on the port is not enough. */
    let listening = false;
    let stdout = '';
    child.stdout.on('data', c => {
      if (listening) return;
      stdout += c;
      listening = /Listening on /.test(stdout);
    });

    const baseUrl = `http://127.0.0.1:${port}`;

    // Kills the child (if it's still alive) and removes the temp dir. Safe
    // to call whether the child is running, already exited, or already
    // killed — used both by the failure paths below and as the returned
    // `stop()`.
    const cleanup = async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await new Promise(res => child.once('exit', res));
      }
      await rm(dataDir, { recursive: true, force: true });
    };

    // Poll until it answers, the child dies, or we time out. /api/me is
    // unauthenticated and always 200.
    //
    // An answer alone proves only that SOMETHING listens on the port. Under
    // load, parallel test files raced for one port between getFreePort()
    // releasing it and a child binding it: the loser died with EADDRINUSE,
    // but not before the probe had been answered by the winner, so the
    // losing test ran against another test's server and database —
    // 'fetch failed' when that test stopped it, rows missing, 'database is
    // locked'. So the answer only counts once our own child has said it
    // holds the port.
    const deadline = Date.now() + 15_000;
    let bootError = null;
    for (;;) {
      if (child.exitCode !== null) {
        bootError = new Error(`server exited ${child.exitCode} before listening:\n${stderr}`);
        break;
      }
      try {
        if (listening) {
          const r = await fetch(`${baseUrl}/api/me`);
          if (r.ok) break;
        }
      } catch { /* not up yet */ }
      if (Date.now() > deadline) {
        bootError = new Error(`server never listened:\n${stderr}`);
        break;
      }
      await new Promise(res => setTimeout(res, 100));
    }

    if (bootError) {
      await cleanup();
      const raced = /EADDRINUSE/.test(stderr);
      if (raced && attempt < MAX_PORT_ATTEMPTS) continue; // try another port
      throw bootError;
    }

    return { baseUrl, stop: cleanup, dbPath, dataDir };
  }
  // Unreachable: the loop above always either returns or throws.
}

/** Logs in and returns the raw Cookie header value for authenticated requests. */
export async function login(baseUrl, password = 'test-password') {
  const r = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status}`);
  const raw = r.headers.getSetCookie().find(c => c.startsWith('maab_session='));
  if (!raw) throw new Error('no session cookie in login response');
  return raw.split(';')[0];
}

/**
 * Follows a magic link and returns the raw `maab_family=` Cookie header
 * value, so a test can act as the family that link belongs to.
 *
 * `redirect: 'manual'` matters: /enter answers 303 and sets the cookie on
 * that response. Letting fetch follow it would land on the board and hand
 * back the final response's headers, which carry no Set-Cookie.
 */
export async function familySession(enterUrl) {
  const r = await fetch(enterUrl, { redirect: 'manual' });
  const raw = r.headers.getSetCookie().find(c => c.startsWith('maab_family='));
  if (!raw) throw new Error(`no family cookie from ${enterUrl} (status ${r.status})`);
  return raw.split(';')[0];
}
