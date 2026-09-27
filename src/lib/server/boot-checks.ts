/**
 * Fail-fast checks run once at server boot (see src/hooks.server.ts).
 *
 * The theme this module exists to close: this migration has repeatedly been
 * bitten by config that fails silently instead of loudly — a mount() helper
 * that warned and moved on (booking 404s on a "healthy" server), calendar
 * writes that failed invisibly until a dashboard banner was bolted on, and
 * several modules (auth.ts, urls.ts, email.ts, content.ts) that fall back to
 * a plausible-looking default rather than refusing to start. Each check
 * below traces to one of those defects; see the inline comment on each for
 * which one.
 *
 * process.env, not `$env/dynamic/private`: that import is a Vite virtual
 * module and would make this file unimportable by `node --test`, which is
 * how tests/unit/boot-checks.test.mjs loads it directly — same reasoning as
 * urls.ts and content.ts.
 *
 * checkDataDir dynamically imports content.ts (rather than a static
 * top-level import) so that merely importing THIS module never pulls in
 * content.ts → urls.ts, which warns unconditionally at module load if
 * SESSION_SECRET is unset ("using a random one..."). If this module
 * statically imported content.ts, that warning — plus auth.ts's own two
 * module-load warnings — would print immediately before checkEnv() gets a
 * chance to throw over the exact same missing variable, reading as three
 * contradictory lines about one problem. src/hooks.server.ts relies on
 * this: it calls checkEnv() before dynamically importing auth.ts, and this
 * module's own DATA_DIR check needed the same treatment to keep that
 * ordering guarantee intact. See hooks.server.ts's comment for the other
 * half of this.
 *
 * Dev-mode: these checks are NOT called at all under `vite dev` — see the
 * `if (!dev)` guard in src/hooks.server.ts, not anything in this file. This
 * file has no opinion about dev vs. prod; it only knows how to check and how
 * to report.
 */
import { execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Static import, unlike content.ts below: paths.ts has zero side effects at
// module load (no console output, no throwing, just a computed constant),
// so importing it here can't reproduce the "three contradictory warnings"
// problem the dynamic content.ts import exists to avoid — see this file's
// header comment.
import { portalDir } from './paths.ts';
// Same reasoning as paths.ts above: engine.ts is a pure lookup over env and
// one existsSync, with no module-load side effects, so importing it here
// cannot reintroduce the duplicate-warning ordering problem.
import { codexHome, engineBin, engineHasCredentials } from './lesson/engine.ts';
import { loadTemplates } from './plans/templates.ts';

interface RequiredVar {
  key: string;
  /** Shown when the var is unset. */
  why: string;
  /**
   * Called only when the var IS set, to validate its value. Returns an
   * error string (safe to print — never a secret) or null if the value is
   * fine. Only PROTOCOL_HEADER needs this today: presence alone doesn't
   * catch a typo'd or wrong-name header, and unlike ORIGIN — which
   * adapter-node's own parse_origin validates and throws on — a bad
   * PROTOCOL_HEADER value fails with no error at all, reproducing exactly
   * the silent cookie-`secure` bug this check exists to close.
   */
  validateValue?: (value: string) => string | null;
}

// Each entry traces to a specific defect found during this migration —
// see the task-21 brief / progress.md rulings P2, P14, P16 for the full
// history. Keeping the "why" next to the key means the thrown message is
// actionable on its own, without anyone having to go spelunking.
/** Exported so tests derive the list rather than restating it — a hardcoded
 *  copy in a test goes stale the moment a variable is added, and fails in a
 *  way that looks like the new variable is broken. */
export const REQUIRED_VARS: RequiredVar[] = [
  {
    key: 'SITE_URL',
    why: 'the absolute origin used in booking/portal emails (e.g. game and portal links) — ' +
      'unset, api/book.js used to fall back to the raw server IP (p2 bug 6hJh33RvfVc8r84H); ' +
      'today it produces "undefined/portal?s=..." in a real email instead',
  },
  {
    key: 'SESSION_SECRET',
    why: 'HMAC key for dashboard session cookies AND signed game/homework links (urls.ts) — ' +
      'unset, both fall back to a secret generated fresh at module load, so every ' +
      'restart logs everyone out and silently invalidates every game link already sent',
  },
  {
    key: 'ADMIN_PASSWORD',
    why: 'the tutor dashboard login password — unset, every login attempt fails, which ' +
      'looks like a broken password rather than missing config',
  },
  {
    key: 'ORIGIN',
    why: "adapter-node's own origin for building request URLs; without it the derived " +
      'protocol (and therefore the login cookie\'s `secure` flag) is not dependable',
  },
  {
    key: 'PROTOCOL_HEADER',
    why: "must be set to 'x-forwarded-proto' — adapter-node's equivalent of Express's " +
      "app.set('trust proxy', 1). Left unset, adapter-node's get_origin() hardcodes " +
      "'https' and never reads the header Caddy sets, so the session cookie's `secure` " +
      'flag depends on an unconfigured default rather than a verified proxy trust chain ' +
      '(ruling P16)',
    // adapter-node lowercases this value itself before using it
    // (handler.js: `env('PROTOCOL_HEADER', '').toLowerCase()`), so compare
    // case-insensitively — but the NAME must still be exactly
    // 'x-forwarded-proto', the header this deployment's Caddyfile actually
    // sets. A different-but-plausible value (a typo, the wrong case handled
    // some other way, a different header name entirely) passes a
    // presence-only check while adapter-node silently looks for a header
    // that will never arrive and falls back to hardcoded 'https' — the
    // exact bug this check exists to close, just moved one layer down.
    validateValue: (value) => value.toLowerCase() === 'x-forwarded-proto'
      ? null
      : `must be exactly 'x-forwarded-proto' (the header Caddy sets) — got ${JSON.stringify(value)}`,
  },
  {
    key: 'DATA_DIR',
    why: 'the absolute directory generated content (lesson slides, game data, drafts, ' +
      "portal files) lives under — unset, content.ts falls back to the CWD-relative " +
      "'./data', and adapter-node's runtime cwd is not guaranteed to be the repo root",
  },
  {
    key: 'CALENDAR_ID',
    why: 'the calendar bookings are written to. It used to fall back to a hardcoded ' +
      'personal address, so an unset value did not fail — it silently routed every ' +
      "booking in the system to one person's calendar. Harmless while there is one " +
      'tutor and a misrouting bug the moment there are two, presenting as "the ' +
      'calendar did not sync" rather than as a missing variable',
  },
];

export interface EnvIssue { key: string; message: string; }

/**
 * Checks every required env var and returns the ones that are missing OR
 * set to an invalid value — does not throw itself, so callers (checkEnv,
 * and the unit test) can decide how to report a batch of issues instead of
 * stopping at the first one. A fresh deployment should see every problem
 * in one message, not fix-and-retry six times.
 */
export function envIssues(): EnvIssue[] {
  const issues: EnvIssue[] = [];
  for (const { key, why, validateValue } of REQUIRED_VARS) {
    const value = process.env[key];
    if (!value) {
      issues.push({ key, message: why });
      continue;
    }
    if (validateValue) {
      const problem = validateValue(value);
      if (problem) issues.push({ key, message: problem });
    }
  }
  return issues;
}

/** Throws with every missing-or-invalid var (name + problem) in one
 *  message, or returns normally if all are set and valid. Never includes a
 *  raw secret value — only ever reports absence or (for non-secret vars
 *  like PROTOCOL_HEADER) the actual wrong value, so secrets (SESSION_SECRET,
 *  ADMIN_PASSWORD) can't leak into a boot log even for the vars that ARE
 *  set. */
export function checkEnv(): void {
  const issues = envIssues();
  if (issues.length === 0) return;

  const lines = issues.map(({ key, message }) => `  - ${key}: ${message}`);
  throw new Error(
    `refusing to start — missing or invalid required environment variable(s):\n${lines.join('\n')}`,
  );
}

/** Throws unless DATA_DIR resolves to a directory this process can write
 *  to. Logs the RESOLVED ABSOLUTE PATH (not the raw env value, which may be
 *  relative) so a misconfigured deploy is visible in boot logs without
 *  anyone having to reproduce dataDir()'s resolution by hand.
 *
 *  Dynamically imports content.ts — see this module's header comment for
 *  why that import can't be static. */
export async function checkDataDir(): Promise<void> {
  const { dataDir } = await import('./content.ts');
  const dir = resolve(dataDir());
  console.log(`[boot] DATA_DIR resolved to ${dir}`);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`refusing to start — DATA_DIR (${dir}) does not exist or is not writable`);
  }
}

/**
 * Throws unless PORTAL_DIR resolves to a directory this process can write
 * to. Logs the RESOLVED ABSOLUTE PATH exactly as checkDataDir does — this
 * whole class of bug (a path silently resolving somewhere unintended) is
 * what that logging exists to make visible, and portalDir() had been left
 * out of it.
 *
 * portalDir() is deliberately NOT folded into DATA_DIR/content.ts (see
 * paths.ts's header) — its unset default is the repo-root-relative
 * `<site>/portal`, computed from paths.ts's own file location via
 * import.meta.url. In the built, containerized app that resolves under
 * build/ (e.g. /app/build/portal), which is never mounted or populated —
 * a real deployment MUST set PORTAL_DIR explicitly (docker-compose.yml
 * does: PORTAL_DIR=/app/data/portal, inside the one persistent volume).
 * This check is what turns "silently resolves to the wrong, non-persistent
 * path" into a boot-time failure instead of a same-PIN-looks-wrong support
 * ticket from a real student.
 */
export function checkPortalDir(): void {
  const dir = resolve(portalDir());
  console.log(`[boot] PORTAL_DIR resolved to ${dir}`);
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(`refusing to start — PORTAL_DIR (${dir}) does not exist or is not writable`);
  }
}

/**
 * WARNS, does not throw: lesson generation and the student question box
 * both shell out to the `codex` CLI (lesson/prep.ts and ask.ts, via
 * CODEX_BIN or 'codex' on PATH). A multi-stage
 * Docker build that copies only build/ and production node_modules
 * silently drops the globally-installed binary, and generation then fails
 * at the first real booking with nothing else catching it — the
 * characterization suite deliberately disables generation, so click-through
 * never exercises this path. The site should still serve pages and take
 * bookings if only generation is broken, so this does not block boot.
 *
 * A 5s timeout is load-bearing, not decorative: a HUNG binary (stalled on
 * stdin, a network call, anything) would otherwise block boot indefinitely
 * with zero log output — worse than either throwing or warning, since the
 * site never starts and nothing explains why. A timeout is treated exactly
 * like any other failure (ENOENT, non-zero exit): warn and move on.
 */
/**
 * Warns if the configured lesson engine cannot run, or has no credentials.
 *
 * Warns rather than throws, deliberately: taking bookings matters more than
 * generating slides, and a site that refuses to boot over a missing optional
 * CLI is a worse outage than one that books lessons and generates nothing.
 *
 * The credential half is new and is the check that would have paid for
 * itself: when the Claude subscription's entitlement was revoked, boot said
 * nothing, every booking failed, and each one recorded the same generic
 * sentence. `claude --version` kept passing throughout — the binary was fine,
 * the credential was not — so a liveness check on the binary alone is not a
 * check on whether generation can work.
 */
/** Where a Debian-family image keeps the trust store Codex reads. OpenSSL
 *  honours SSL_CERT_FILE/SSL_CERT_DIR above these, so an image that puts its
 *  bundle somewhere else can say so rather than trip a false warning. */
const CA_BUNDLE_PATHS = ['/etc/ssl/certs/ca-certificates.crt', '/etc/pki/tls/certs/ca-bundle.crt'];

export function systemCaBundlePath(): string | null {
  const named = process.env.SSL_CERT_FILE || process.env.SSL_CERT_DIR;
  // An explicitly named store is the answer whether or not it is there. If it
  // is set and missing, that is a misconfiguration worth surfacing — not one
  // to paper over with a distro default, which OpenSSL will not consult
  // either once the variable is set.
  if (named) return existsSync(named) ? named : null;
  return CA_BUNDLE_PATHS.find(p => existsSync(p)) ?? null;
}

export function checkLessonEngine(): void {
  const bin = engineBin();
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 5_000 });
  } catch {
    console.warn(
      `WARNING: the codex CLI is not runnable (ran "${bin} --version", 5s budget) — ` +
      'lesson generation and the student question box will fail at the first real use. ' +
      'The site will still serve pages and take bookings.',
    );
    return;
  }

  // Codex is a Rust binary and trusts the SYSTEM certificate store, unlike
  // everything else in this image: Node ships its own bundled roots, so the
  // app's own HTTPS calls keep working and nothing else notices the store is
  // gone. On a node:22-slim base it IS gone unless the Dockerfile installs
  // ca-certificates. The symptom is a bare "error sending request for url"
  // with no mention of certificates, on a container whose DNS and egress are
  // demonstrably fine — so it gets named here rather than left to be
  // rediscovered.
  if (!systemCaBundlePath()) {
    console.warn(
      'WARNING: no system CA bundle found (looked in ' + CA_BUNDLE_PATHS.join(', ') + ') — ' +
      'codex trusts the system store, not Node\'s bundled roots, so `codex login` and every ' +
      'lesson generation will fail at the TLS handshake. Install ca-certificates in the image.',
    );
  }

  if (!engineHasCredentials()) {
    console.warn(
      `WARNING: ${bin} is installed but has no credentials — expected ${codexHome()}/auth.json ` +
      '(mount it into the container, read-write so token refresh persists) or OPENAI_API_KEY. ' +
      'Lesson generation will fail at the first real booking.',
    );
  }
}

/**
 * WARNS, does not throw, and names what will be degraded. registry.ts
 * (src/lib/server/lesson/registry.ts) used to do a top-level JSON.parse at
 * module load with no env override — meaning a missing/invalid
 * games/registry.json crashed the moment ANYTHING imported that module,
 * which risked taking down the whole server rather than just the one
 * feature that needs it (a fragility Task 11's review had already flagged
 * and deferred; Task 18 is what actually exercised it, when the games
 * catalog page became registry.ts's first real caller). registry.ts is now
 * lazy (getRegistry(), read and cached on first use, not at import) so
 * that guarantee holds: only /app/games (the catalog) and
 * /app/play/[template] (via isKnownTemplate) fail when someone actually
 * hits them — booking, the revenue path, never touches this file and is
 * unaffected either way. That's the same "don't take down the whole site
 * over one degraded feature" principle already applied to the `codex` CLI
 * check above; this fold-in is the FIX for the earlier version of this
 * function, which threw here instead.
 */
export function checkRegistry(): void {
  const path = resolve(process.cwd(), 'games', 'registry.json');
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    console.warn(
      `WARNING: games/registry.json (${path}) is missing or not valid JSON (${cause}) — ` +
      'the games catalog (/app/games) and lesson generation will fail. Booking and the ' +
      'rest of the site will still work.',
    );
  }
}

/** Warns, like checkRegistry: a broken template disables plan creation for that
 *  track and nothing else, so it must not stop the site from booting. CI is the
 *  real gate (tests/unit/plan-template-content.test.mjs). */
export function checkPlanTemplates(): void {
  const templates = loadTemplates();
  if (!templates.length) {
    console.warn(
      'WARNING: no learning-plan templates loaded — /app/plan can show existing plans but cannot create new ones.',
    );
  }
}
