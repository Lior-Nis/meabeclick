# Tutor Meet Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tutor opens a setup link, signs in with Google once, and the app creates their own Meet room and saves it as `teachers.meet_url`. No one copies a link or touches the server.

**Architecture:**
- **Codes:** a random setup code (only its SHA-256 is stored on the teacher row).
- **The trip to Google and back:** a signed, short-lived cookie that carries the tutor through Google's consent and back.
- **Making the room:** one Google round trip (token exchange → `spaces.create` → revoke), built from three small server modules (codes and cookie, the Google client, the flow).
- **Wiring:** thin SvelteKit routes call those modules, and a dashboard card mints the links.

**Tech Stack:** SvelteKit 2 / Svelte 5, adapter-node, `node:sqlite`, `node --test` (imports `.ts` directly), python Playwright for browser QA.

**Spec:** `docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md`

## Global Constraints

- The repo is **public**: commit no client IDs, no secrets, no real email addresses, no Meet links, no phone numbers. Tests use `example.com` addresses and made-up room codes.
- Google values live only in the server's `.env`: `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET`. Unset means the feature is off, not a boot failure.
- Scopes, exactly: `openid email https://www.googleapis.com/auth/meetings.space.created`. `access_type=online`. No refresh token is ever stored.
- The room is created with `{"config":{"accessType":"RESTRICTED"}}`: families knock.
- Setup link: 32 random bytes, base64url (43 chars), 7-day expiry, SHA-256 stored, newest replaces older, success clears it.
- Setup cookie `maab_tutor_setup`: httpOnly, `secure` when the request is https, SameSite=Lax, Path `/app/tutor-setup`, 15 minutes.
- Logs carry a step name and an HTTP status only, never a Google response body or a token.
- Hebrew copy uses the plural/neutral imperative, as the rest of the site does ("לחצו", "בחרו").
- Each task's code lives on branch `feat/tutor-meet-setup`, in the worktree `scratchpad/wt-meet` (it has a `node_modules` symlink). Build before characterization tests: `npm run build`.

## Review Focus

1. **The link opened twice.** WhatsApp's preview fetches the link, then the tutor opens it. The second open must still work, because opening the page changes nothing. Pinned in Task 5, "opening the link twice uses nothing up".
2. **A newer link sent while the tutor is on Google's screens.** The tutor must not end up with a room saved from the replaced link. They land on the expired page. Pinned in Task 4, "a code replaced mid-flow saves nothing and calls nothing".
3. **The phone reloads the tab after success.** Mobile browsers restore discarded tabs. The reload must show success again and create no second room. Pinned in Task 4, "a finished setup replayed shows success and calls Google no more".
4. **Google answers with a link that isn't a Meet address.** Nothing is saved and the tutor gets the "try again" message. Pinned in Task 3, "a room without a Meet https link is a room failure", and Task 4, "a Google failure keeps the link and saves nothing".
5. **Revoking the permission fails.** The room is still saved; only a warning is logged. Pinned in Task 3, "revoke failing does not lose the room".

---

### Task 1: Spike: can a free Google account create a knock-only Meet room?

Throwaway. Nothing here is committed. It needs the owner, Lior, twice: to enable the API (or approve doing it in his browser), and to click Allow and try the room.

**Files:**
- Create (scratchpad only, never committed): `scratchpad/meet-space-probe.mjs`

- [ ] **Step 1: Enable the Meet REST API**

Ask Lior to open `https://console.cloud.google.com/apis/library/meet.googleapis.com?project=zeta-instrument-492312-k7` while signed in as the account that owns the project, and press **Enable**. Alternatively, with his explicit OK, do it in his Chrome through the browser tools.

- [ ] **Step 2: Write the probe**

```js
// scratchpad/meet-space-probe.mjs — throwaway (spec, "Step 1 is a spike").
// Can a personal Google account create a Meet space, and does RESTRICTED hold?
// Uses the existing Desktop OAuth client (the Drive backups'), loopback redirect.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const { GOOGLE_OAUTH_CLIENT_ID: id, GOOGLE_OAUTH_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) throw new Error('GOOGLE_OAUTH_CLIENT_ID / _SECRET not set');
const scope = 'openid email https://www.googleapis.com/auth/meetings.space.created';
const state = randomBytes(16).toString('hex');

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const redirect = `http://127.0.0.1:${server.address().port}`;
console.log('OPEN THIS URL:\n' + `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: 'code', scope,
  access_type: 'online', prompt: 'select_account consent', state,
})}`);

const code = await new Promise((res, rej) => server.on('request', (req, resp) => {
  const u = new URL(req.url, redirect);
  resp.end('OK, back to the terminal.');
  server.close();
  if (u.searchParams.get('state') === state && u.searchParams.get('code')) res(u.searchParams.get('code'));
  else rej(new Error(u.searchParams.get('error') || 'state mismatch'));
}));

const t = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({
  code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code',
}) });
const tok = await t.json();
console.log('token:', t.status, tok.access_token ? 'ok' : 'NO ACCESS TOKEN');

const r = await fetch('https://meet.googleapis.com/v2/spaces', {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ config: { accessType: 'RESTRICTED' } }),
});
const space = await r.json();
console.log('spaces.create:', r.status, space.error
  ? `${space.error.status} ${space.error.message}`
  : `meetingUri=${space.meetingUri} accessType=${space.config?.accessType}`);

const v = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: tok.access_token }) });
console.log('revoke:', v.status);
```

- [ ] **Step 3: Run it in the background with the Desktop client's values from the server, never echoed**

```bash
cd /tmp/claude-1000/-home-liornisimov-Projects-mea-beclick/7ab4210a-f30b-4690-9a0f-ff0df0d6d8ae/scratchpad
GOOGLE_OAUTH_CLIENT_ID="$(ssh mea 'docker exec mea-beclick-app-1 printenv GOOGLE_OAUTH_CLIENT_ID')" \
GOOGLE_OAUTH_CLIENT_SECRET="$(ssh mea 'docker exec mea-beclick-app-1 printenv GOOGLE_OAUTH_CLIENT_SECRET')" \
node meet-space-probe.mjs
```

Give Lior the printed URL. He opens it in the browser on this machine (the loopback redirect needs it), picks his Google account, passes the unverified screen, and taps Allow.

- [ ] **Step 4: Read the result and have Lior try the room**

Expected on pass: `spaces.create: 200 meetingUri=https://meet.google.com/xxx-xxxx-xxx accessType=RESTRICTED`, then `revoke: 200`.

Ask Lior to:
1. Open the `meetingUri` signed in as that same account. He should go straight in, as the host.
2. Open it again in a private window. The private window should see "Ask to join", and his window should get an "Admit" prompt.

- [ ] **Step 5: Gate**

- **Pass** (a room comes back, `RESTRICTED` holds, the stranger knocks): continue with Task 2.
- **`spaces.create` refused** (403 or 400 for a personal account): **stop**. Tell Lior, then rewrite Task 3 to the spec's D4 (calendar event on the tutor's own calendar, scope `calendar.events`) before continuing.
- **Room created but `accessType` came back different, or no knock:** stop and report. Decide with Lior before building.

Delete `meet-space-probe.mjs` afterwards. The room it made is Lior's to keep or ignore; nothing points at it.

---

### Task 2: Setup codes, the setup cookie, and migration 028

**Files:**
- Create: `src/lib/server/migrations/028_tutor_setup.ts`
- Modify: `src/lib/server/migrations/list.ts` (import after line 27; entry after the `version: 27` line)
- Create: `src/lib/server/tutor-setup.ts`
- Modify: `src/lib/server/entities.ts:12-16` (TeacherRow), `src/lib/server/entities.ts:46-49` (remove `setTeacherMeetUrl`)
- Modify: `tests/unit/lesson-mode.test.mjs:118-119,129` (use `completeSetup`)
- Test: `tests/unit/tutor-setup.test.mjs`

**Interfaces:**
- Consumes: `handle()` from `src/lib/server/db.ts`; `TeacherRow` from `entities.ts`.
- Produces (all from `src/lib/server/tutor-setup.ts`):
  - **Constants:** `SETUP_COOKIE: 'maab_tutor_setup'`, `SETUP_TTL_MS`, `COOKIE_TTL_MS`.
  - **Codes:**
    - `mintSetupCode(teacherId: number, now?: number): string`
    - `teacherForCode(code: unknown, now?: number): TeacherRow | null`
    - `setupLink(code: string): string`
  - **Finishing:** `completeSetup(teacherId: number, meetUrl: string, account: string | null): void`
  - **Cookie:**
    - `type SetupCookie = { kind: 'started'; teacherId: number; code: string; nonce: string } | { kind: 'done'; teacherId: number }`
    - `newNonce(): string`
    - `mintStartedCookie(teacherId: number, code: string, nonce: string, now?: number): string`
    - `mintDoneCookie(teacherId: number, now?: number): string`
    - `readSetupCookie(value: string | null | undefined, now?: number): SetupCookie | null`
    - `setupCookieOptions(url: URL): { path: string; httpOnly: true; sameSite: 'lax'; secure: boolean; maxAge: number }`
  - **`TeacherRow`** gains `meet_account: string | null; setup_hash: string | null; setup_expires: string | null`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/tutor-setup.test.mjs
//
// A tutor's setup link and the cookie that carries them through Google
// (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tsetup-')), 'results.db');
process.env.SITE_URL = 'https://site.example';
const S = await import('../../src/lib/server/tutor-setup.ts');
const E = await import('../../src/lib/server/entities.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const NOW = Date.parse('2027-01-10T10:00:00Z');
const DAY = 24 * 3600e3;
const ROOM = 'https://meet.google.com/abc-defg-hij';

test('a code is 43 base64url chars, only its hash is stored, and it finds its teacher', () => {
  const t = E.createTeacher({ name: 'מורה א' });
  const code = S.mintSetupCode(t.id, NOW);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const row = handle().prepare(`SELECT setup_hash, setup_expires FROM teachers WHERE id = ?`).get(t.id);
  assert.notEqual(row.setup_hash, code, 'the raw code must not be stored');
  assert.match(row.setup_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.setup_expires, new Date(NOW + 7 * DAY).toISOString());
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
  assert.equal(S.setupLink(code), `https://site.example/app/tutor-setup/${code}`);
});

test('a code expires after 7 days, and a newer code replaces it', () => {
  const t = E.createTeacher({ name: 'מורה ב' });
  const first = S.mintSetupCode(t.id, NOW);
  assert.equal(S.teacherForCode(first, NOW + 7 * DAY - 1)?.id, t.id);
  assert.equal(S.teacherForCode(first, NOW + 7 * DAY), null);
  const second = S.mintSetupCode(t.id, NOW);
  assert.equal(S.teacherForCode(first, NOW), null, 'the replaced code still works');
  assert.equal(S.teacherForCode(second, NOW).id, t.id);
});

test('anything that is not a live code finds nobody', () => {
  const t = E.createTeacher({ name: 'מורה ג' });
  const code = S.mintSetupCode(t.id, NOW);
  for (const bad of [undefined, null, '', 'short', `${code}x`, code.replace(/./, '.'), 42]) {
    assert.equal(S.teacherForCode(bad, NOW), null, String(bad));
  }
  handle().prepare(`UPDATE teachers SET active = 0 WHERE id = ?`).run(t.id);
  assert.equal(S.teacherForCode(code, NOW), null, 'a deactivated teacher still matched');
});

test('completeSetup saves the room and the account, and uses the code up', () => {
  const t = E.createTeacher({ name: 'מורה ד' });
  const code = S.mintSetupCode(t.id, NOW);
  S.completeSetup(t.id, ROOM, 'tutor@example.com');
  const row = E.getTeacher(t.id);
  assert.equal(row.meet_url, ROOM);
  assert.equal(row.meet_account, 'tutor@example.com');
  assert.equal(row.setup_hash, null);
  assert.equal(S.teacherForCode(code, NOW), null);
});

test('the started cookie round-trips, and is refused when tampered or stale', () => {
  const nonce = S.newNonce();
  const code = 'A'.repeat(43);
  const v = S.mintStartedCookie(7, code, nonce, NOW);
  assert.deepEqual(S.readSetupCookie(v, NOW), { kind: 'started', teacherId: 7, code, nonce });
  assert.equal(S.readSetupCookie(v, NOW + S.COOKIE_TTL_MS), null, 'stale');
  assert.equal(S.readSetupCookie(v.replace('s.7.', 's.8.'), NOW), null, 'teacher swapped');
  assert.equal(S.readSetupCookie(v.slice(0, -2) + 'xx', NOW), null, 'signature');
  for (const bad of [undefined, null, '', 'nodot', '.x']) assert.equal(S.readSetupCookie(bad, NOW), null);
});

test('the done cookie names only the teacher', () => {
  assert.deepEqual(S.readSetupCookie(S.mintDoneCookie(3, NOW), NOW), { kind: 'done', teacherId: 3 });
});

test('cookie options: scoped to the setup pages, secure only over https', () => {
  const o = S.setupCookieOptions(new URL('https://site.example/x'));
  assert.deepEqual(o, { path: '/app/tutor-setup', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 900 });
  assert.equal(S.setupCookieOptions(new URL('http://127.0.0.1:5000/x')).secure, false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/tutor-setup.test.mjs`
Expected: FAIL, `Cannot find module '.../src/lib/server/tutor-setup.ts'`.

- [ ] **Step 3: Write the migration**

```ts
// src/lib/server/migrations/028_tutor_setup.ts
/**
 * Migration 028 — a tutor connects their own Meet room from a setup link.
 *
 * `setup_hash` / `setup_expires`: the SHA-256 of the newest setup link's
 * code and when it stops working. The code itself is never stored, so the
 * database never holds a working link. NULL means no link is out.
 *
 * `meet_account`: the Google account that owns `meet_url` (027). The tutor
 * must be signed into Meet with it to admit families, so it is shown back
 * to them and on the dashboard.
 * See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 */
export const sql = `
ALTER TABLE teachers ADD COLUMN setup_hash TEXT;
ALTER TABLE teachers ADD COLUMN setup_expires TEXT;
ALTER TABLE teachers ADD COLUMN meet_account TEXT;
`;
```

In `src/lib/server/migrations/list.ts`, add after the `sql027` import:

```ts
import { sql as sql028 } from './028_tutor_setup.ts';
```

and after `{ version: 27, name: '027_lesson_mode', sql: sql027 },`:

```ts
  { version: 28, name: '028_tutor_setup', sql: sql028 },
```

- [ ] **Step 4: Update TeacherRow and remove the hand-setter**

In `src/lib/server/entities.ts` replace the `TeacherRow` type with:

```ts
export type TeacherRow = {
  id: number; name: string; phone: string | null; active: number;
  /** The teacher's fixed Google Meet room (migration 027), or null. */
  meet_url: string | null;
  /** The Google account that owns meet_url (migration 028). */
  meet_account: string | null;
  /** The newest setup link's code hash and expiry; see tutor-setup.ts. */
  setup_hash: string | null;
  setup_expires: string | null;
};
```

Delete `setTeacherMeetUrl` and its comment (lines 46–49). The setup flow's `completeSetup` replaces it.

In `tests/unit/lesson-mode.test.mjs`, add after the `const E = …` import line:

```js
const { completeSetup } = await import('../../src/lib/server/tutor-setup.ts');
```

and replace the three `E.setTeacherMeetUrl(x, url)` calls with `completeSetup(x, url, null)`.

- [ ] **Step 5: Write `tutor-setup.ts`**

```ts
// src/lib/server/tutor-setup.ts
/**
 * A tutor's setup link, and the cookie that carries them through Google.
 *
 * The link: 32 random bytes the owner sends on WhatsApp. Only their SHA-256
 * is stored, beside the teacher, with a 7-day expiry, so the database never
 * holds a working link. A newer link replaces the older one; finishing
 * clears it. See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 *
 * The cookie proves that the browser Google sends back is the one that
 * tapped the button. It is signed like the family tokens (family-auth.ts),
 * under its own prefix, so a signature made for one can never verify as
 * the other.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { handle } from './db.ts';
import type { TeacherRow } from './entities.ts';

// process.env, and a random fallback rather than '', for the reasons
// family-auth.ts gives: an HMAC keyed with '' needs no secret to forge.
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');

export const SETUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SETUP_COOKIE = 'maab_tutor_setup';
export const COOKIE_TTL_MS = 15 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

const hashCode = (code: string): string => createHash('sha256').update(code).digest('hex');

/** A fresh link for this teacher; any earlier one stops working. */
export function mintSetupCode(teacherId: number, now = Date.now()): string {
  const code = randomBytes(32).toString('base64url');
  handle().prepare(`UPDATE teachers SET setup_hash = ?, setup_expires = ? WHERE id = ?`)
    .run(hashCode(code), new Date(now + SETUP_TTL_MS).toISOString(), teacherId);
  return code;
}

/** The active teacher whose live link this is, or null. */
export function teacherForCode(code: unknown, now = Date.now()): TeacherRow | null {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null;
  const row = handle().prepare(`SELECT * FROM teachers WHERE setup_hash = ? AND active = 1`)
    .get(hashCode(code)) as TeacherRow | undefined;
  if (!row?.setup_expires || Date.parse(row.setup_expires) <= now) return null;
  return row;
}

/** The absolute link for WhatsApp, built like family-auth.ts enterLink. */
export function setupLink(code: string): string {
  const site = (process.env.SITE_URL ?? '').replace(/\/+$/, '');
  return `${site}/app/tutor-setup/${code}`;
}

/** The room is saved and the link used up, in one statement. */
export function completeSetup(teacherId: number, meetUrl: string, account: string | null): void {
  handle().prepare(`UPDATE teachers
    SET meet_url = ?, meet_account = ?, setup_hash = NULL, setup_expires = NULL WHERE id = ?`)
    .run(meetUrl, account, teacherId);
}

/* ── The setup cookie ─────────────────────────────────────────────── */

export type SetupCookie =
  | { kind: 'started'; teacherId: number; code: string; nonce: string }
  | { kind: 'done'; teacherId: number };

const sign = (payload: string): string =>
  createHmac('sha256', SECRET).update(`tutor-setup:${payload}`).digest('base64url');
const seal = (payload: string): string => `${payload}.${sign(payload)}`;

export const newNonce = (): string => randomBytes(16).toString('base64url');

/** Set when the tutor leaves for Google. It carries the code itself, so a
 *  failure can send them back to their own page with the button. */
export function mintStartedCookie(teacherId: number, code: string, nonce: string, now = Date.now()): string {
  return seal(`s.${teacherId}.${code}.${nonce}.${now + COOKIE_TTL_MS}`);
}

/** Replaces the started cookie once the room is saved. A reloaded tab then
 *  shows success instead of replaying Google's one-time code. */
export function mintDoneCookie(teacherId: number, now = Date.now()): string {
  return seal(`d.${teacherId}.-.-.${now + COOKIE_TTL_MS}`);
}

/** Signature first, expiry second, both before anything is trusted. */
export function readSetupCookie(value: string | null | undefined, now = Date.now()): SetupCookie | null {
  if (typeof value !== 'string') return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  const [kind, rawId, code, nonce, rawExp] = payload.split('.');
  const teacherId = Number(rawId);
  const exp = Number(rawExp);
  if (!Number.isInteger(teacherId) || teacherId <= 0 || !Number.isFinite(exp) || exp <= now) return null;
  if (kind === 'd') return { kind: 'done', teacherId };
  if (kind === 's' && CODE_RE.test(code ?? '') && nonce) return { kind: 'started', teacherId, code, nonce };
  return null;
}

/** `secure` follows the request's scheme, as the login cookie's does
 *  (src/routes/api/login/+server.ts). Lax, because Google's redirect back
 *  is a cross-site top-level navigation and Strict would withhold it. */
export function setupCookieOptions(url: URL) {
  return {
    path: '/app/tutor-setup', httpOnly: true as const, sameSite: 'lax' as const,
    secure: url.protocol === 'https:', maxAge: COOKIE_TTL_MS / 1000,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tests/unit/tutor-setup.test.mjs tests/unit/lesson-mode.test.mjs tests/unit/entities-accounts.test.mjs`
Expected: PASS, all.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/migrations/028_tutor_setup.ts src/lib/server/migrations/list.ts \
  src/lib/server/tutor-setup.ts src/lib/server/entities.ts \
  tests/unit/tutor-setup.test.mjs tests/unit/lesson-mode.test.mjs
git commit -m "Mint a tutor's setup link and sign the cookie that carries them through Google"
```

(Every commit message ends with the session's two attribution lines.)

---

### Task 3: The Google client: exchange, create the room, revoke

**Files:**
- Create: `src/lib/server/google-meet-setup.ts`
- Test: `tests/unit/google-meet-setup.test.mjs`

**Interfaces:**
- Consumes: `meetUrl(raw: unknown): string | null` from `src/lib/lesson-mode.ts`.
- Produces (from `src/lib/server/google-meet-setup.ts`):
  - **Constants:** `SCOPES: string`, `CALLBACK_PATH: '/app/tutor-setup/callback'`.
  - **Client config:**
    - `interface WebClient { clientId: string; clientSecret: string; redirectUri: string }`
    - `webClientFromEnv(env?: Record<string, string | undefined>): WebClient | null`
    - `consentUrl(client: WebClient, state: string): string`
  - **Errors:** `class GoogleStepError extends Error { step: 'token' | 'room'; status: number }`
  - **Calls:**
    - `emailFromIdToken(idToken: unknown): string | null`
    - `connectRoom(client: WebClient, authCode: string, fetchImpl?: typeof fetch): Promise<{ meetUrl: string; account: string | null }>`

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/google-meet-setup.test.mjs
//
// The three Google calls that make a tutor's room, with Google simulated.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const G = await import('../../src/lib/server/google-meet-setup.ts');
const CLIENT = { clientId: 'cid.example', clientSecret: 'shh', redirectUri: 'https://site.example/app/tutor-setup/callback' };
const ROOM = 'https://meet.google.com/abc-defg-hij';
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

/** A fake Google: one canned answer per endpoint, every call recorded. */
function fakeGoogle({
  token = { status: 200, body: { access_token: 'at-1', id_token: idToken({ email: 'tutor@example.com' }) } },
  room = { status: 200, body: { meetingUri: ROOM, config: { accessType: 'RESTRICTED' } } },
  revoke = { status: 200, body: {} },
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const pick = u.startsWith('https://oauth2.googleapis.com/token') ? token
      : u.startsWith('https://meet.googleapis.com/') ? room : revoke;
    if (pick instanceof Error) throw pick;
    return new Response(JSON.stringify(pick.body ?? {}), { status: pick.status, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

test('webClientFromEnv needs both values and the site', () => {
  const env = { GOOGLE_WEB_CLIENT_ID: 'cid', GOOGLE_WEB_CLIENT_SECRET: 's', SITE_URL: 'https://site.example/' };
  assert.deepEqual(G.webClientFromEnv(env), { clientId: 'cid', clientSecret: 's', redirectUri: 'https://site.example/app/tutor-setup/callback' });
  for (const k of Object.keys(env)) assert.equal(G.webClientFromEnv({ ...env, [k]: '' }), null, k);
});

test('the consent URL asks for the account and the room permission only, online', () => {
  const u = new URL(G.consentUrl(CLIENT, 'nonce-1'));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.deepEqual(q, {
    client_id: 'cid.example', redirect_uri: CLIENT.redirectUri, response_type: 'code',
    scope: 'openid email https://www.googleapis.com/auth/meetings.space.created',
    access_type: 'online', prompt: 'select_account consent', state: 'nonce-1',
  });
});

test('connectRoom exchanges, creates a knock-only room, revokes, and returns room and account', async () => {
  const g = fakeGoogle();
  assert.deepEqual(await G.connectRoom(CLIENT, 'auth-code', g.fetchImpl), { meetUrl: ROOM, account: 'tutor@example.com' });
  assert.deepEqual(g.calls.map((c) => c.url), [
    'https://oauth2.googleapis.com/token',
    'https://meet.googleapis.com/v2/spaces',
    'https://oauth2.googleapis.com/revoke',
  ]);
  const ex = new URLSearchParams(String(g.calls[0].init.body));
  assert.equal(ex.get('code'), 'auth-code');
  assert.equal(ex.get('grant_type'), 'authorization_code');
  assert.equal(ex.get('redirect_uri'), CLIENT.redirectUri);
  assert.equal(g.calls[1].init.headers.Authorization, 'Bearer at-1');
  assert.deepEqual(JSON.parse(g.calls[1].init.body), { config: { accessType: 'RESTRICTED' } });
  assert.equal(new URLSearchParams(String(g.calls[2].init.body)).get('token'), 'at-1');
});

test('a failed exchange is a token failure and creates nothing', async () => {
  const g = fakeGoogle({ token: { status: 400, body: { error: 'invalid_grant', error_description: 'echo of secrets' } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) =>
    e instanceof G.GoogleStepError && e.step === 'token' && e.status === 400 && !/echo/.test(e.message));
  assert.equal(g.calls.length, 1);
});

test('a refused room is a room failure, and the permission is still revoked', async () => {
  const g = fakeGoogle({ room: { status: 403, body: { error: { message: 'nope' } } } });
  await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e.step === 'room' && e.status === 403);
  assert.equal(g.calls.at(-1).url, 'https://oauth2.googleapis.com/revoke');
});

test('a room without a Meet https link is a room failure', async () => {
  for (const meetingUri of [undefined, '', 'http://meet.google.com/abc-defg-hij', 'https://evil.example/abc']) {
    const g = fakeGoogle({ room: { status: 200, body: { meetingUri } } });
    await assert.rejects(G.connectRoom(CLIENT, 'c', g.fetchImpl), (e) => e.step === 'room', String(meetingUri));
  }
});

test('revoke failing does not lose the room', async () => {
  for (const revoke of [{ status: 500, body: {} }, new TypeError('fetch failed')]) {
    const g = fakeGoogle({ revoke });
    assert.equal((await G.connectRoom(CLIENT, 'c', g.fetchImpl)).meetUrl, ROOM);
  }
});

test('the account is read from the id_token, and its absence is not an error', () => {
  assert.equal(G.emailFromIdToken(idToken({ email: 'a@example.com' })), 'a@example.com');
  for (const bad of [undefined, '', 'x', 'h.%%%.s', idToken({})]) assert.equal(G.emailFromIdToken(bad), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/google-meet-setup.test.mjs`
Expected: FAIL, `Cannot find module '.../google-meet-setup.ts'`.

- [ ] **Step 3: Write `google-meet-setup.ts`**

```ts
// src/lib/server/google-meet-setup.ts
/**
 * The Google calls that make a tutor's Meet room, as the tutor.
 *
 * On a free Google account only a meeting's creator can admit someone who
 * knocks, so the room must belong to the tutor, not to the site. The tutor
 * consents once. The permission is used for one room and then revoked: no
 * refresh token exists to expire, be revoked by a password change, or
 * leak later. See docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 *
 * Errors carry the step and the HTTP status, never Google's body. It can
 * echo request details, as drive/api.ts notes.
 */
import { meetUrl } from '../lesson-mode.ts';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const SPACES = 'https://meet.googleapis.com/v2/spaces';

/** The account's email (to show which account owns the room), and rooms
 *  this app creates — nothing else of the tutor's. */
export const SCOPES = 'openid email https://www.googleapis.com/auth/meetings.space.created';
export const CALLBACK_PATH = '/app/tutor-setup/callback';

export interface WebClient { clientId: string; clientSecret: string; redirectUri: string }

/** Null while the web client is not configured: the feature is off. */
export function webClientFromEnv(env: Record<string, string | undefined> = process.env): WebClient | null {
  const clientId = env.GOOGLE_WEB_CLIENT_ID;
  const clientSecret = env.GOOGLE_WEB_CLIENT_SECRET;
  const site = env.SITE_URL;
  if (!clientId || !clientSecret || !site) return null;
  return { clientId, clientSecret, redirectUri: `${site.replace(/\/+$/, '')}${CALLBACK_PATH}` };
}

/** `online`: no refresh token. `select_account`: the tutor picks the
 *  account on purpose, since that account becomes the room's host. */
export function consentUrl(client: WebClient, state: string): string {
  return `${AUTH}?${new URLSearchParams({
    client_id: client.clientId, redirect_uri: client.redirectUri, response_type: 'code',
    scope: SCOPES, access_type: 'online', prompt: 'select_account consent', state,
  })}`;
}

export class GoogleStepError extends Error {
  constructor(readonly step: 'token' | 'room', readonly status: number) {
    super(`google ${step} failed: ${status}`);
  }
}

/** The id_token came straight from Google's token endpoint over TLS, so
 *  its payload is read without checking the signature (Google's guidance
 *  for exactly this case). */
export function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims?.email === 'string' && claims.email ? claims.email : null;
  } catch {
    return null;
  }
}

export async function connectRoom(
  client: WebClient, authCode: string, fetchImpl: typeof fetch = fetch,
): Promise<{ meetUrl: string; account: string | null }> {
  const t = await fetchImpl(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authCode, client_id: client.clientId, client_secret: client.clientSecret,
      redirect_uri: client.redirectUri, grant_type: 'authorization_code',
    }),
  });
  if (!t.ok) throw new GoogleStepError('token', t.status);
  const tok = await t.json() as { access_token?: string; id_token?: string };
  if (!tok.access_token) throw new GoogleStepError('token', t.status);

  try {
    const r = await fetchImpl(SPACES, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      // Families knock and the tutor admits them: the link never changes, so
      // a family that keeps it must not walk into another child's lesson.
      body: JSON.stringify({ config: { accessType: 'RESTRICTED' } }),
    });
    if (!r.ok) throw new GoogleStepError('room', r.status);
    const space = await r.json() as { meetingUri?: string };
    const url = meetUrl(space.meetingUri);
    if (!url || new URL(url).hostname !== 'meet.google.com') throw new GoogleStepError('room', r.status);
    return { meetUrl: url, account: emailFromIdToken(tok.id_token) };
  } finally {
    await revoke(tok.access_token, fetchImpl);
  }
}

/** Best effort: the token dies within the hour anyway. */
async function revoke(token: string, fetchImpl: typeof fetch): Promise<void> {
  try {
    const r = await fetchImpl(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
    if (!r.ok) console.warn(`[tutor-setup] revoke failed: ${r.status}`);
  } catch {
    console.warn('[tutor-setup] revoke failed: network');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/google-meet-setup.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/google-meet-setup.ts tests/unit/google-meet-setup.test.mjs
git commit -m "Make a tutor's Meet room as the tutor, then hand the permission back"
```

---

### Task 4: The flow: start and finish

**Files:**
- Create: `src/lib/server/tutor-setup-flow.ts`
- Test: `tests/unit/tutor-setup-flow.test.mjs`

**Interfaces:**
- Consumes:
  - **From Task 2:** `teacherForCode`, `newNonce`, `mintStartedCookie`, `mintDoneCookie`, `readSetupCookie`, `completeSetup`.
  - **From Task 3:** `WebClient`, `consentUrl`, `connectRoom`, `GoogleStepError`.
- Produces (from `src/lib/server/tutor-setup-flow.ts`):
  - **Constant:** `DONE_PATH: '/app/tutor-setup/done'`
  - **Starting:** `startSetup(code: string | null, client: WebClient | null, now?: number): { location: string; cookie: string | null }`
  - **Finishing:**
    - `interface CallbackInput { cookie: string | undefined; state: string | null; authCode: string | null; error: string | null }`
    - `finishSetup(input: CallbackInput, client: WebClient | null, fetchImpl?: typeof fetch, now?: number): Promise<{ location: string; cookie: string | null }>`
  - **The `cookie` field:** a value to set, or `null` for "delete the cookie".

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/tutor-setup-flow.test.mjs
//
// The round trip a tutor makes: start (to Google) and finish (back from it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'tflow-')), 'results.db');
const F = await import('../../src/lib/server/tutor-setup-flow.ts');
const S = await import('../../src/lib/server/tutor-setup.ts');
const E = await import('../../src/lib/server/entities.ts');

const CLIENT = { clientId: 'cid.example', clientSecret: 'shh', redirectUri: 'https://site.example/app/tutor-setup/callback' };
const ROOM = 'https://meet.google.com/abc-defg-hij';
const NOW = Date.parse('2027-01-10T10:00:00Z');
const idToken = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

function fakeGoogle({ room = { status: 200, body: { meetingUri: ROOM } } } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const pick = u.includes('/token') ? { status: 200, body: { access_token: 'at', id_token: idToken({ email: 'tutor@example.com' }) } }
      : u.includes('meet.googleapis.com') ? room : { status: 200, body: {} };
    return new Response(JSON.stringify(pick.body), { status: pick.status });
  };
  return { fetchImpl, calls };
}

/** A teacher with a live link, already sent off to Google. */
function started(name) {
  const t = E.createTeacher({ name });
  const code = S.mintSetupCode(t.id, NOW);
  const s = F.startSetup(code, CLIENT, NOW);
  const state = new URL(s.location).searchParams.get('state');
  return { t, code, cookie: s.cookie, state };
}

test('start sends a live code to Google with a cookie whose nonce is the state', () => {
  const { t, code, cookie, state } = started('מורה 1');
  assert.ok(state);
  assert.deepEqual(S.readSetupCookie(cookie, NOW), { kind: 'started', teacherId: t.id, code, nonce: state });
});

test('start sends anything else back to the setup page, with no cookie', () => {
  const t = E.createTeacher({ name: 'מורה 2' });
  const code = S.mintSetupCode(t.id, NOW);
  assert.deepEqual(F.startSetup('not-a-code', CLIENT, NOW), { location: '/app/tutor-setup/not-a-code', cookie: null });
  assert.deepEqual(F.startSetup(code, null, NOW), { location: `/app/tutor-setup/${code}`, cookie: null }, 'client unset');
  assert.deepEqual(F.startSetup(null, CLIENT, NOW), { location: '/app/tutor-setup/', cookie: null });
});

test('finish saves the room and account, uses the code up, and leaves a done cookie', async () => {
  const { t, code, cookie, state } = started('מורה 3');
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.equal(r.location, F.DONE_PATH);
  assert.deepEqual(S.readSetupCookie(r.cookie, NOW), { kind: 'done', teacherId: t.id });
  const row = E.getTeacher(t.id);
  assert.equal(row.meet_url, ROOM);
  assert.equal(row.meet_account, 'tutor@example.com');
  assert.equal(S.teacherForCode(code, NOW), null);
});

test('a finished setup replayed shows success and calls Google no more', async () => {
  const { cookie, state } = started('מורה 4');
  const first = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, fakeGoogle().fetchImpl, NOW);
  const g = fakeGoogle();
  const again = await F.finishSetup({ cookie: first.cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(again, { location: F.DONE_PATH, cookie: first.cookie });
  assert.equal(g.calls.length, 0);
});

test('denied at Google: back to the page with the button; the code still works', async () => {
  const { t, code, cookie, state } = started('מורה 5');
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: null, error: 'access_denied' }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=denied`, cookie: null });
  assert.equal(g.calls.length, 0);
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
});

test('a Google failure keeps the link and saves nothing', async () => {
  const { t, code, cookie, state } = started('מורה 6');
  const g = fakeGoogle({ room: { status: 200, body: { meetingUri: 'https://evil.example/x' } } });
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}?e=google`, cookie: null });
  assert.equal(E.getTeacher(t.id).meet_url, null);
  assert.equal(S.teacherForCode(code, NOW).id, t.id);
});

test('a code replaced mid-flow saves nothing and calls nothing', async () => {
  const { t, code, cookie, state } = started('מורה 7');
  S.mintSetupCode(t.id, NOW); // the owner sends a newer link meanwhile
  const g = fakeGoogle();
  const r = await F.finishSetup({ cookie, state, authCode: 'ac', error: null }, CLIENT, g.fetchImpl, NOW);
  assert.deepEqual(r, { location: `/app/tutor-setup/${code}`, cookie: null });
  assert.equal(g.calls.length, 0);
  assert.equal(E.getTeacher(t.id).meet_url, null);
});

test('no cookie, a wrong state, or no client ends on the done page as not completed', async () => {
  const { cookie, state } = started('מורה 8');
  const g = fakeGoogle();
  for (const [input, client] of [
    [{ cookie: undefined, state, authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state: 'other', authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state: null, authCode: 'ac', error: null }, CLIENT],
    [{ cookie, state, authCode: 'ac', error: null }, null],
  ]) {
    assert.deepEqual(await F.finishSetup(input, client, g.fetchImpl, NOW), { location: F.DONE_PATH, cookie: null });
  }
  assert.equal(g.calls.length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/unit/tutor-setup-flow.test.mjs`
Expected: FAIL, `Cannot find module '.../tutor-setup-flow.ts'`.

- [ ] **Step 3: Write `tutor-setup-flow.ts`**

```ts
// src/lib/server/tutor-setup-flow.ts
/**
 * The round trip a tutor makes: start (to Google) and finish (back from it).
 * Pure decisions over the database and an injected fetch, so every branch is
 * tested without a server or Google. The routes only apply the result: set
 * or delete the cookie, then redirect. See
 * docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md.
 */
import {
  teacherForCode, newNonce, mintStartedCookie, mintDoneCookie, readSetupCookie, completeSetup,
} from './tutor-setup.ts';
import { consentUrl, connectRoom, GoogleStepError, type WebClient } from './google-meet-setup.ts';

export const DONE_PATH = '/app/tutor-setup/done';

/** `cookie`: a value to set, or null for "delete it". */
export interface Step { location: string; cookie: string | null }

const page = (code: string): string => `/app/tutor-setup/${encodeURIComponent(code)}`;

/** A live code goes to Google; anything else back to its page, which says why. */
export function startSetup(code: string | null, client: WebClient | null, now = Date.now()): Step {
  const teacher = teacherForCode(code, now);
  if (!teacher || !client || !code) return { location: page(code ?? ''), cookie: null };
  const nonce = newNonce();
  return { location: consentUrl(client, nonce), cookie: mintStartedCookie(teacher.id, code, nonce, now) };
}

export interface CallbackInput {
  cookie: string | undefined; state: string | null; authCode: string | null; error: string | null;
}

export async function finishSetup(
  input: CallbackInput, client: WebClient | null, fetchImpl: typeof fetch = fetch, now = Date.now(),
): Promise<Step> {
  const c = readSetupCookie(input.cookie, now);
  // Already finished: a reloaded tab. Show success again; Google's code is spent.
  if (c?.kind === 'done') return { location: DONE_PATH, cookie: input.cookie ?? null };
  if (!c || !client || !input.state || input.state !== c.nonce) return { location: DONE_PATH, cookie: null };

  // The owner may have sent a newer link meanwhile; the old page then says expired.
  const teacher = teacherForCode(c.code, now);
  if (!teacher || teacher.id !== c.teacherId) return { location: page(c.code), cookie: null };

  if (input.error || !input.authCode) return { location: `${page(c.code)}?e=denied`, cookie: null };

  try {
    const room = await connectRoom(client, input.authCode, fetchImpl);
    completeSetup(teacher.id, room.meetUrl, room.account);
    return { location: DONE_PATH, cookie: mintDoneCookie(teacher.id, now) };
  } catch (err) {
    console.warn(`[tutor-setup] ${err instanceof GoogleStepError ? err.message : 'google unreachable'}`);
    return { location: `${page(c.code)}?e=google`, cookie: null };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/unit/tutor-setup-flow.test.mjs tests/unit/tutor-setup.test.mjs tests/unit/google-meet-setup.test.mjs`
Expected: PASS, all.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tutor-setup-flow.ts tests/unit/tutor-setup-flow.test.mjs
git commit -m "Decide each step of a tutor's trip to Google and back"
```

---

### Task 5: The routes and pages

**Files:**
- Create: `src/routes/api/teachers/[id]/setup-link/+server.ts`
- Create: `src/routes/api/tutor-setup/start/+server.ts`
- Create: `src/routes/app/tutor-setup/callback/+server.ts`
- Create: `src/routes/app/tutor-setup/+layout.svelte`
- Create: `src/routes/app/tutor-setup/[code]/+page.server.ts`, `src/routes/app/tutor-setup/[code]/+page.svelte`
- Create: `src/routes/app/tutor-setup/done/+page.server.ts`, `src/routes/app/tutor-setup/done/+page.svelte`
- Modify: `tests/characterization/harness.mjs:36-43` (block the new variables)
- Test: `tests/characterization/tutor-setup.test.mjs`

**Interfaces:**
- Consumes:
  - **Tasks 2–4:** everything above.
  - **Auth:** `apiAuthDenied(event)` from `$server/auth.ts`.
  - **Teachers:** `getTeacher(id)` from `$server/entities.ts`.
- Produces:
  - **The dashboard API:** `POST /api/teachers/:id/setup-link` → `{ link: string }` (401 without a session, 404 for an unknown or inactive teacher).
  - **The tutor's pages:** `/app/tutor-setup/<code>` and `/app/tutor-setup/done`.

- [ ] **Step 1: Block the new variables in the harness**

In `tests/characterization/harness.mjs`, inside `BLOCKED`, after the Drive line, add:

```js
  // The tutor-setup web client: a test that wants it passes made-up values.
  'GOOGLE_WEB_CLIENT_ID', 'GOOGLE_WEB_CLIENT_SECRET',
```

- [ ] **Step 2: Write the failing characterization tests**

```js
// tests/characterization/tutor-setup.test.mjs
//
// A tutor's setup link through the real server
// (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md). Nothing
// here reaches Google: the success path is unit-tested with Google
// simulated (tutor-setup-flow.test.mjs), and proven once on production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const GOOGLE = { GOOGLE_WEB_CLIENT_ID: 'test-client.example', GOOGLE_WEB_CLIENT_SECRET: 'test-secret' };

async function mint(baseUrl, cookie, id = 1) {
  const r = await fetch(`${baseUrl}/api/teachers/${id}/setup-link`, { method: 'POST', headers: { cookie } });
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json()).link;
}
const html = async (url, init) => (await fetch(url, init)).text();
const codeOf = (link) => link.split('/').at(-1);

test('only a dashboard session mints a link; opening the link twice uses nothing up', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    assert.equal((await fetch(`${baseUrl}/api/teachers/1/setup-link`, { method: 'POST' })).status, 401);
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/api/teachers/999/setup-link`, { method: 'POST', headers: { cookie } })).status, 404);
    const link = await mint(baseUrl, cookie);
    assert.match(link, new RegExp(`^${baseUrl}/app/tutor-setup/[A-Za-z0-9_-]{43}$`));
    const first = await html(link);
    assert.match(first, /היי ניקול/);
    assert.match(first, new RegExp(`href="/api/tutor-setup/start\\?code=${codeOf(link)}"`));
    assert.match(await html(link), /התחברות עם Google/, 'the second open (after a link preview) still works');
  } finally { await stop(); }
});

test('a replaced, unknown or malformed code shows the expired page', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    const cookie = await login(baseUrl);
    const older = await mint(baseUrl, cookie);
    const newer = await mint(baseUrl, cookie);
    assert.match(await html(older), /הקישור לא תקף/);
    assert.match(await html(newer), /התחברות עם Google/);
    assert.match(await html(`${baseUrl}/app/tutor-setup/garbage`), /הקישור לא תקף/);
  } finally { await stop(); }
});

test('start sends a live code to Google with the setup cookie, and anything else back', async () => {
  const { baseUrl, stop } = await startServer({ env: GOOGLE });
  try {
    const code = codeOf(await mint(baseUrl, await login(baseUrl)));
    const r = await fetch(`${baseUrl}/api/tutor-setup/start?code=${code}`, { redirect: 'manual' });
    assert.equal(r.status, 303);
    const to = new URL(r.headers.get('location'));
    assert.equal(to.origin + to.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(to.searchParams.get('client_id'), 'test-client.example');
    assert.equal(to.searchParams.get('redirect_uri'), `${baseUrl}/app/tutor-setup/callback`);
    assert.match(to.searchParams.get('scope'), /meetings\.space\.created/);
    assert.equal(to.searchParams.get('access_type'), 'online');
    const set = r.headers.getSetCookie().find((c) => c.startsWith('maab_tutor_setup='));
    assert.ok(set, 'no setup cookie');
    assert.match(set, /Path=\/app\/tutor-setup/);
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Lax/i);

    const bad = await fetch(`${baseUrl}/api/tutor-setup/start?code=nope`, { redirect: 'manual' });
    assert.equal(bad.status, 303);
    assert.equal(bad.headers.get('location'), '/app/tutor-setup/nope');
  } finally { await stop(); }
});

test('without the web client the page says so and start stays home', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const link = await mint(baseUrl, await login(baseUrl));
    const page = await html(link);
    assert.match(page, /עוד לא הוגדר/);
    assert.doesNotMatch(page, /התחברות עם Google/);
    const r = await fetch(`${baseUrl}/api/tutor-setup/start?code=${codeOf(link)}`, { redirect: 'manual' });
    assert.equal(r.headers.get('location'), `/app/tutor-setup/${codeOf(link)}`);
  } finally { await stop(); }
});

test('callback: denied keeps the link; a bad state or no cookie ends as not completed', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: GOOGLE });
  try {
    const code = codeOf(await mint(baseUrl, await login(baseUrl)));
    const s = await fetch(`${baseUrl}/api/tutor-setup/start?code=${code}`, { redirect: 'manual' });
    const state = new URL(s.headers.get('location')).searchParams.get('state');
    const setup = s.headers.getSetCookie().find((c) => c.startsWith('maab_tutor_setup=')).split(';')[0];

    const denied = await fetch(`${baseUrl}/app/tutor-setup/callback?error=access_denied&state=${state}`,
      { redirect: 'manual', headers: { cookie: setup } });
    assert.equal(denied.status, 303);
    assert.equal(denied.headers.get('location'), `/app/tutor-setup/${code}?e=denied`);
    const back = await html(`${baseUrl}/app/tutor-setup/${code}?e=denied`);
    assert.match(back, /לא אישרתם/);
    assert.match(back, /התחברות עם Google/);

    const wrong = await fetch(`${baseUrl}/app/tutor-setup/callback?code=x&state=other`,
      { redirect: 'manual', headers: { cookie: setup } });
    assert.equal(wrong.headers.get('location'), '/app/tutor-setup/done');
    const none = await fetch(`${baseUrl}/app/tutor-setup/callback?code=x&state=${state}`, { redirect: 'manual' });
    assert.equal(none.headers.get('location'), '/app/tutor-setup/done');
    assert.match(await html(`${baseUrl}/app/tutor-setup/done`), /החיבור לא הושלם/);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(db.prepare(`SELECT meet_url FROM teachers WHERE id = 1`).get().meet_url, null);
  } finally { await stop(); }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run build && node --test tests/characterization/tutor-setup.test.mjs`
Expected: FAIL, with 404s from the routes that don't exist yet (`setup-link` answers 404 where 401 is expected).

- [ ] **Step 4: Write the endpoints**

```ts
// src/routes/api/teachers/[id]/setup-link/+server.ts
/**
 * The link the owner sends a tutor on WhatsApp, to connect their Meet room.
 * Minting replaces the tutor's previous link. See $server/tutor-setup.ts.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { getTeacher } from '$server/entities.ts';
import { mintSetupCode, setupLink } from '$server/tutor-setup.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;
  const id = Number(event.params.id);
  const teacher = Number.isInteger(id) && id > 0 ? getTeacher(id) : null;
  if (!teacher?.active) return json({ error: 'teacher not found' }, { status: 404 });
  return json({ link: setupLink(mintSetupCode(teacher.id)) }, { headers: { 'Cache-Control': 'no-store' } });
};
```

```ts
// src/routes/api/tutor-setup/start/+server.ts
/**
 * The setup page's one button: a plain link, not a form, because the
 * CSP's form-action 'self' would block a form's redirect to Google.
 */
import { redirect } from '@sveltejs/kit';
import { startSetup } from '$server/tutor-setup-flow.ts';
import { SETUP_COOKIE, setupCookieOptions } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url, cookies }) => {
  const step = startSetup(url.searchParams.get('code'), webClientFromEnv());
  if (step.cookie) cookies.set(SETUP_COOKIE, step.cookie, setupCookieOptions(url));
  redirect(303, step.location);
};
```

```ts
// src/routes/app/tutor-setup/callback/+server.ts
/**
 * Where Google sends the tutor back. It does the work and redirects rather
 * than rendering, so a phone that reloads the tab lands on the done page
 * instead of replaying Google's one-time code. See tutor-setup-flow.ts.
 */
import { redirect } from '@sveltejs/kit';
import { finishSetup } from '$server/tutor-setup-flow.ts';
import { SETUP_COOKIE, setupCookieOptions } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
  const q = url.searchParams;
  const step = await finishSetup({
    cookie: cookies.get(SETUP_COOKIE), state: q.get('state'), authCode: q.get('code'), error: q.get('error'),
  }, webClientFromEnv());
  const options = setupCookieOptions(url);
  if (step.cookie) cookies.set(SETUP_COOKIE, step.cookie, options);
  else cookies.delete(SETUP_COOKIE, { path: options.path });
  redirect(303, step.location);
};
```

- [ ] **Step 5: Write the page loaders**

```ts
// src/routes/app/tutor-setup/[code]/+page.server.ts
/**
 * The page a setup link opens. Opening it changes nothing — WhatsApp's link
 * preview fetches it before the tutor does — so only the button acts.
 */
import { teacherForCode } from '$server/tutor-setup.ts';
import { webClientFromEnv } from '$server/google-meet-setup.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
  const teacher = teacherForCode(params.code);
  if (!teacher) return { state: 'expired' as const };
  if (!webClientFromEnv()) return { state: 'off' as const, name: teacher.name };
  const e = url.searchParams.get('e');
  return {
    state: 'ready' as const,
    name: teacher.name,
    start: `/api/tutor-setup/start?code=${params.code}`,
    hasRoom: !!teacher.meet_url,
    problem: e === 'denied' || e === 'google' ? e : null,
  };
};
```

```ts
// src/routes/app/tutor-setup/done/+page.server.ts
/** "מוכן ✓" for the browser that just finished, from the done cookie. */
import { getTeacher } from '$server/entities.ts';
import { readSetupCookie, SETUP_COOKIE } from '$server/tutor-setup.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
  const c = readSetupCookie(cookies.get(SETUP_COOKIE));
  const t = c?.kind === 'done' ? getTeacher(c.teacherId) : null;
  if (!t?.meet_url) return { done: false as const };
  return { done: true as const, meetUrl: t.meet_url, account: t.meet_account };
};
```

- [ ] **Step 6: Write the layout and the two pages**

```svelte
<!-- src/routes/app/tutor-setup/+layout.svelte -->
<script lang="ts">
  /* The tutor's setup pages: one narrow column, the confirm-booking page's
     look. Styles are :global under .wrap so both pages share them. */
  import BrandMark from '$lib/components/BrandMark.svelte';
  let { children } = $props();
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<main class="wrap">
  <div class="brand"><BrandMark height={28} /></div>
  {@render children()}
</main>

<style>
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; text-align: center; }
  .brand { display: flex; justify-content: center; margin-bottom: 20px; }
  .wrap :global(h1) { font-size: 1.5rem; font-weight: 900; margin: 0 0 8px; }
  .wrap :global(.lead) { color: var(--text-muted); margin: 0 0 16px; }
  .wrap :global(.btn) {
    display: inline-flex; align-items: center; justify-content: center; min-height: 48px;
    padding: 0 24px; border: 0; border-radius: 999px; background: var(--accent); color: #fff;
    font: inherit; font-weight: 800; text-decoration: none; cursor: pointer;
  }
  .wrap :global(.error) { color: var(--danger); font-weight: 700; margin: 0 0 12px; }
  .wrap :global(.note) { color: var(--text-muted); font-size: 0.9rem; margin-top: 18px; }
  .wrap :global(.steps) { text-align: start; margin: 22px 0 0; padding-inline-start: 1.2rem; line-height: 1.6; }
  .wrap :global(.room) { font-weight: 800; margin: 0 0 16px; word-break: break-all; }
</style>
```

```svelte
<!-- src/routes/app/tutor-setup/[code]/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>חיבור חדר Meet — מאה בקליק</title></svelte:head>

{#if data.state === 'ready'}
  <h1>היי {data.name} 👋</h1>
  <p class="lead">צעד אחד, ונפתח לכם חדר שיעורים קבוע ב-Google Meet. משפחות שבוחרות שיעור אונליין יקבלו אליו קישור אוטומטית.</p>
  {#if data.problem === 'denied'}<p class="error" role="alert">לא אישרתם את הגישה ב-Google. אפשר לנסות שוב.</p>{/if}
  {#if data.problem === 'google'}<p class="error" role="alert">משהו השתבש מול Google. נסו שוב בעוד רגע.</p>{/if}
  <a class="btn" href={data.start}>התחברות עם Google</a>
  <ol class="steps">
    <li>בחרו את חשבון ה-Google שאיתו אתם נכנסים לשיעורים.</li>
    <li>אם Google מזהיר שהאפליקציה לא אומתה, זה צפוי: לחצו „מתקדם" (Advanced) ואז „מעבר אל…" (Go to…).</li>
    <li>לחצו „אישור" (Allow). זהו.</li>
  </ol>
  {#if data.hasRoom}
    <p class="note">כבר יש לכם חדר. חיבור מחדש יפתח חדר חדש במקומו. שיעורים שכבר נקבעו ישמרו את הקישור הקודם, והוא ימשיך לעבוד.</p>
  {/if}
{:else if data.state === 'off'}
  <h1>היי {data.name}</h1>
  <p class="lead">החיבור ל-Google עוד לא הוגדר באתר. נסו שוב מאוחר יותר.</p>
{:else}
  <h1>הקישור לא תקף</h1>
  <p class="lead">הקישור פג תוקף או שכבר השתמשו בו. בקשו קישור חדש ממי ששלח לכם אותו.</p>
{/if}
```

```svelte
<!-- src/routes/app/tutor-setup/done/+page.svelte -->
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>חדר ה-Meet מוכן — מאה בקליק</title></svelte:head>

{#if data.done}
  <h1>מוכן ✓</h1>
  <p class="lead">החדר שלכם ב-Google Meet:</p>
  <p class="room" dir="ltr"><a href={data.meetUrl} target="_blank" rel="noopener">{data.meetUrl.replace('https://', '')}</a></p>
  <a class="btn" href={data.meetUrl} target="_blank" rel="noopener">פתיחת החדר</a>
  {#if data.account}
    <p class="note">החדר נפתח בחשבון <b dir="ltr">{data.account}</b>. היכנסו ל-Meet עם החשבון הזה, כדי שתוכלו להכניס משפחות שמבקשות להצטרף.</p>
  {/if}
  <p class="note">המשפחות יקבלו את הקישור הזה אוטומטית. אפשר לשמור אותו גם אצלכם.</p>
{:else}
  <h1>החיבור לא הושלם</h1>
  <p class="lead">פתחו שוב את הקישור שקיבלתם בוואטסאפ ונסו שוב.</p>
{/if}
```

- [ ] **Step 7: Build and run the tests to verify they pass**

Run: `npm run build && node --test tests/characterization/tutor-setup.test.mjs`
Expected: PASS, 5 tests.

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/routes/api/teachers src/routes/api/tutor-setup src/routes/app/tutor-setup \
  tests/characterization/harness.mjs tests/characterization/tutor-setup.test.mjs
git commit -m "Give a tutor a setup page that connects their Meet room through Google"
```

---

### Task 6: The dashboard's "מורים" card, and browser QA

**Files:**
- Create: `src/lib/components/TutorsCard.svelte`
- Modify: `src/routes/app/dashboard/+page.server.ts` (the `load` return, and its imports)
- Modify: `src/routes/app/dashboard/+page.svelte` (import near line 6; section before the "כניסה לפורטל" header, near line 1230)
- Test: `tests/characterization/tutor-setup.test.mjs` (two more tests)
- QA (scratchpad, not committed): `scratchpad/qa-tutors.py`

**Interfaces:**
- Consumes:
  - **Teachers:** `listTeachers()` and `defaultTeacher()` from `$server/entities.ts`.
  - **Config:** `webClientFromEnv()`.
  - **Minting:** `POST /api/teachers/:id/setup-link`.
- Produces: `pageData.tutors: { id: number; name: string; phone: string | null; meetUrl: string | null; account: string | null }[]`, `pageData.tutorsDefaultId: number | null`, and `pageData.googleReady: boolean`.

- [ ] **Step 1: Write the failing tests** (append to `tests/characterization/tutor-setup.test.mjs`)

```js
// Only the server-rendered markup counts, not the hydration data island
// (see dashboard-card.test.mjs).
const markup = (h) => h.split(/<script nonce=/)[0];

test('the dashboard lists the tutors with their room status and the link button', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: GOOGLE });
  try {
    const cookie = await login(baseUrl);
    const db = new DatabaseSync(dbPath);
    db.prepare(`UPDATE teachers SET meet_url = 'https://meet.google.com/aaa-bbbb-ccc', meet_account = 'tutor@example.com' WHERE id = 1`).run();
    db.close();
    const page = markup(await html(`${baseUrl}/app/dashboard`, { headers: { cookie } }));
    assert.match(page, />מורים</);
    assert.match(page, /✓ חדר Meet/);
    assert.match(page, /tutor@example\.com/);
    assert.match(page, /✗ אין חדר Meet/, 'the second seeded tutor has no room');
    assert.match(page, /שליחת קישור הגדרה/);
  } finally { await stop(); }
});

test('without the web client the dashboard says so and offers no link', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const page = markup(await html(`${baseUrl}/app/dashboard`, { headers: { cookie: await login(baseUrl) } }));
    assert.match(page, /עוד לא הוגדר בשרת/);
    assert.doesNotMatch(page, /שליחת קישור הגדרה/);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm run build && node --test tests/characterization/tutor-setup.test.mjs`
Expected: the two new tests FAIL (no `>מורים<`, no `עוד לא הוגדר בשרת`); the earlier five still PASS.

- [ ] **Step 3: Add the loader fields**

In `src/routes/app/dashboard/+page.server.ts`:
- Change the entities import to `import { roster, enrollmentsForStudent, listTeachers, defaultTeacher } from '$server/entities.ts';`
- Add `import { webClientFromEnv } from '$server/google-meet-setup.ts';`
- Add these fields to the returned object:

```ts
    /* The "מורים" card. Only what it shows: never setup_hash. */
    tutors: listTeachers().filter(t => t.active).map(t => ({
      id: t.id, name: t.name, phone: t.phone, meetUrl: t.meet_url, account: t.meet_account,
    })),
    /* Bookings carry this tutor's room until a booking can name its tutor. */
    tutorsDefaultId: defaultTeacher()?.id ?? null,
    googleReady: webClientFromEnv() !== null,
```

- [ ] **Step 4: Write `TutorsCard.svelte`**

```svelte
<!-- src/lib/components/TutorsCard.svelte -->
<script lang="ts">
  /**
   * Each tutor's Meet room, and the setup link that connects it
   * (docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md). The
   * link goes straight to the tutor's WhatsApp when the tutor has a phone.
   */
  type Tutor = { id: number; name: string; phone: string | null; meetUrl: string | null; account: string | null };
  let { tutors, defaultId, googleReady }: { tutors: Tutor[]; defaultId: number | null; googleReady: boolean } = $props();

  let links = $state<Record<number, string>>({});
  let busy = $state<number | null>(null);
  let copied = $state<number | null>(null);
  let problem = $state('');

  const message = (t: Tutor, link: string): string =>
    `היי ${t.name}, זה הקישור לחיבור חדר ה-Meet שלך לאתר מאה בקליק. לוקח דקה, פעם אחת: ${link}`;

  /** 0501234567 and 972501234567 both reach the same chat; no phone opens
   *  WhatsApp's contact picker. */
  function waHref(t: Tutor, link: string): string {
    const digits = (t.phone ?? '').replace(/\D/g, '');
    const to = digits.startsWith('0') ? `972${digits.slice(1)}` : digits;
    return `https://wa.me/${to}?text=${encodeURIComponent(message(t, link))}`;
  }

  async function mint(t: Tutor) {
    busy = t.id;
    problem = '';
    try {
      const r = await fetch(`/api/teachers/${t.id}/setup-link`, { method: 'POST' });
      if (r.status === 401) { problem = 'ההתחברות פגה. רעננו את הדף והתחברו שוב.'; return; }
      if (!r.ok) { problem = 'לא הצלחתי להכין קישור. נסו שוב.'; return; }
      links = { ...links, [t.id]: (await r.json()).link };
    } catch {
      problem = 'אין חיבור לשרת.';
    } finally {
      busy = null;
    }
  }

  async function copy(t: Tutor) {
    try {
      await navigator.clipboard.writeText(message(t, links[t.id]));
      copied = t.id;
      setTimeout(() => { if (copied === t.id) copied = null; }, 2000);
    } catch {
      problem = `ההעתקה לא הצליחה. הקישור: ${links[t.id]}`;
    }
  }
</script>

<div class="tutors">
  {#if !googleReady}
    <p class="off">החיבור ל-Google עוד לא הוגדר בשרת, ולכן אי אפשר עדיין לשלוח קישור הגדרה.</p>
  {/if}
  {#each tutors as t (t.id)}
    <div class="row">
      <div class="who">
        <b>{t.name}</b>
        {#if t.id === defaultId}<span class="tag">החדר שנשלח למשפחות</span>{/if}
        {#if t.meetUrl}
          <div class="status ok">✓ חדר Meet{#if t.account} · <span dir="ltr">{t.account}</span>{/if} · <a href={t.meetUrl} target="_blank" rel="noopener">פתיחה</a></div>
        {:else}
          <div class="status missing">✗ אין חדר Meet</div>
        {/if}
      </div>
      {#if googleReady}
        <div class="actions">
          {#if links[t.id]}
            <a class="act wa" href={waHref(t, links[t.id])} target="_blank" rel="noopener">שליחה בוואטסאפ</a>
            <button class="act" onclick={() => copy(t)}>{copied === t.id ? 'הועתק ✓' : 'העתקה'}</button>
          {:else}
            <button class="act" disabled={busy === t.id} onclick={() => mint(t)}>{busy === t.id ? 'מכין…' : 'שליחת קישור הגדרה'}</button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
  {#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</div>

<style>
  .tutors { background: var(--bg-card); border: 1.5px solid var(--border-strong); border-radius: 18px; padding: 6px 14px; }
  .row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--border); }
  .row:last-of-type { border-bottom: 0; }
  .who { min-width: 0; }
  .tag { font-size: .7rem; font-weight: 700; color: var(--accent); border: 1px solid currentColor; border-radius: 999px; padding: 1px 8px; margin-inline-start: 6px; }
  .status { font-size: .85rem; margin-top: 4px; overflow-wrap: anywhere; }
  .status.ok { color: var(--text); }
  .status.missing { color: var(--text-muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .act { min-height: 44px; display: inline-flex; align-items: center; border: 1.5px solid var(--border-strong); background: none; border-radius: 999px; padding: 0 16px; cursor: pointer; font: inherit; font-size: .85rem; color: inherit; text-decoration: none; }
  .act.wa { background: #25d366; border-color: #25d366; color: #fff; font-weight: 700; }
  .act:disabled { opacity: .6; cursor: default; }
  .off, .problem { font-size: .85rem; margin: 10px 0; }
  .problem { color: var(--danger); font-weight: 700; overflow-wrap: anywhere; }
</style>
```

- [ ] **Step 5: Place the card on the dashboard**

In `src/routes/app/dashboard/+page.svelte`, add next to the other component imports (after line 6):

```svelte
  import TutorsCard from '$lib/components/TutorsCard.svelte';
```

and immediately before the `<div class="sec-header" style="margin-top:2.2rem">` that holds `<h2 class="sec-h2">כניסה לפורטל</h2>`, insert:

```svelte
  <div class="sec-header" style="margin-top:2.2rem">
    <div>
      <div class="sec-label2">צוות</div>
      <h2 class="sec-h2">מורים</h2>
    </div>
  </div>
  <TutorsCard tutors={pageData.tutors} defaultId={pageData.tutorsDefaultId} googleReady={pageData.googleReady} />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run build && node --test tests/characterization/tutor-setup.test.mjs tests/characterization/dashboard-card.test.mjs`
Expected: PASS, all.

Run: `npm run check && npm run check:ci`
Expected: 0 errors, no new warnings.

- [ ] **Step 7: Browser QA at 320, 375, 390, 430 and 1280 px**

Write `scratchpad/qa-tutors.py`, following the existing `scratchpad/qa-mode.py` pattern: start the built server through `scratchpad/qa-serve.mjs` with `GOOGLE_WEB_CLIENT_ID=test-client.example` and `GOOGLE_WEB_CLIENT_SECRET=test-secret`, then log in with the harness's test password. For each width:
- **Dashboard:**
  - screenshot the "מורים" card;
  - tap "שליחת קישור הגדרה" for the first tutor;
  - assert that "שליחה בוואטסאפ" appears, with an `href` starting `https://wa.me/972` whose `text` contains the setup link;
  - grant clipboard permission, tap "העתקה", and assert "הועתק ✓";
  - assert no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`).
- **Setup page:** open the minted link and screenshot it. Assert the button and the three steps are visible and there is no horizontal scroll.
- **Error states:** screenshot `?e=denied`, `?e=google`, `/app/tutor-setup/garbage` and `/app/tutor-setup/done` (not completed).
- **Without the web client:** start a second server with no Google values, and screenshot the dashboard card's "not set up" line and the setup page's "off" state.

Look at every screenshot. Fix anything clipped, overlapping, or wrapping badly in RTL, then re-run. Stop the QA servers afterwards, by the wrapper's PID, not by port.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS. If a known flake fails (`report-homework`, `answer-positions`, `deck-standard`), re-run that file alone and note it.

- [ ] **Step 9: Commit**

```bash
git add src/lib/components/TutorsCard.svelte src/routes/app/dashboard/+page.server.ts \
  src/routes/app/dashboard/+page.svelte tests/characterization/tutor-setup.test.mjs
git commit -m "List the tutors on the dashboard, with their room and a setup link to send"
```

---

### Task 7: Document, ship, configure, prove

**Files:**
- Modify: `server/README.md` (new section after "### Off-box backups (Google Drive)")

- [ ] **Step 1: Document the web client**

Add to `server/README.md`, after the Drive backups section:

````markdown
### Tutor Meet rooms (setup links)

A tutor connects their own Google Meet room from a setup link the dashboard
mints ("מורים" card → "שליחת קישור הגדרה"). They sign in with Google once.
The app creates a knock-only room *as the tutor* and saves it as
`teachers.meet_url`, then revokes the permission. Nothing Google-side is
stored. See `docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md`.

**Setup, once**, in the same Cloud project as the Drive backups:

1. APIs & Services → Library → **Google Meet REST API** → Enable.
2. Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized redirect URI: `https://meabeclick.com/app/tutor-setup/callback`
     (`SITE_URL` + `/app/tutor-setup/callback`, exactly).
   - If the console asks for it, add `meabeclick.com` under the consent
     screen's Authorized domains.
3. Put the client's two values in `.env` (chmod 600, never committed):

   ```
   GOOGLE_WEB_CLIENT_ID=…
   GOOGLE_WEB_CLIENT_SECRET=…
   ```

   Recreate the container so it reads them (see Deploy).

Unset, the feature is off: the dashboard card says so and offers no link.
The scope `meetings.space.created` is *sensitive*. Until Google verifies
the app, a tutor sees an "unverified app" screen once, and the setup page
tells them how to pass it.
````

- [ ] **Step 2: Commit, push, open the PR**

```bash
git add server/README.md
git commit -m "Document the tutor-setup Google client"
git push -u origin feat/tutor-meet-setup
```

Write the body to `scratchpad/pr-body.md`, then run `gh pr create --title "Let a tutor connect their Meet room from a setup link" --body-file scratchpad/pr-body.md`. The body:

```markdown
A tutor's fixed Meet room (#46's `teachers.meet_url`) used to be set by hand on the server. Now the owner taps "שליחת קישור הגדרה" next to the tutor in the dashboard and sends the link on WhatsApp. The tutor opens it, signs in with Google once, and the app creates a knock-only room *as the tutor*, saves it, and revokes the permission. Nothing Google-side is stored.

Why as the tutor: on a free Google account only a meeting's creator can admit someone who knocks.

Spec: docs/superpowers/specs/2026-10-16-tutor-meet-setup-design.md
Plan: docs/superpowers/plans/2026-10-16-tutor-meet-setup.md

**Spike (personal Google account):** `spaces.create` answered `<status>` with `accessType=<value>`. In a private window, a visitor `<knocked / walked in>`. Copy the probe's printed lines here, with the meetingUri redacted to `meet.google.com/xxx-xxxx-xxx`: the repo is public.

**Changes**
- **Migration 028:** `teachers.setup_hash`, `setup_expires`, `meet_account`.
- **Setup links:** 7 days, hash-only, newest wins, one use.
- **The trip to Google:** a signed 15-minute cookie carries the tutor through Google and back. `state` must match it.
- **Reloads:** the callback redirects, so a reloaded tab shows success again and never replays the code.
- **The dashboard:** a "מורים" card with each tutor's room and account, plus WhatsApp and copy.
- **Off until configured:** the feature stays off until `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_WEB_CLIENT_SECRET` are set. See server/README.md.

**Tests:** unit tests for codes and cookie, the Google client (simulated), and the flow; characterization tests for the routes, pages and dashboard card; Playwright at 320, 375, 390, 430 and 1280 px.

**Known limitation (out of scope):** bookings still assign the default tutor, so every online lesson carries that tutor's room. Routing a lesson to its own tutor is a separate change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01M83cAin9ny5QGUYH4Ydu6F
```

The three `<…>` slots in the spike line are filled from Task 1's actual output before creating the PR.

- [ ] **Step 3: Whole-branch review, then merge**

Run the final review on the branch diff (`git diff origin/main...HEAD`). Fix its findings and push. Then:

```bash
gh pr checks --watch            # no branch protection: this is the gate
gh pr merge --squash --delete-branch
gh run list --branch main --limit 1   # watch the post-merge run to success
ssh mea 'docker inspect mea-beclick-app-1 --format "{{.Config.Image}}"'   # tag == merge SHA
```

If the post-merge run fails on a known flake, `gh run rerun --failed` and watch again.

Check that migration 028 applied on production: `teachers` has `setup_hash`, `setup_expires` and `meet_account`, queried read-only with `DB_PATH`.

- [ ] **Step 4: Create the web client and configure production**

Follow Step 1's README section. Either Lior does steps 1–2 in the console, or, with his explicit OK, it's done in his Chrome. Then put the two values into `/home/meabeclick/mea-beclick/.env` on the server without echoing them, and recreate the container following README "Deploy". The README warns that a bare `docker compose up -d` once rolled production back, so use the pinned-image command it gives. Confirm that the image tag still equals the merge SHA, that `/`, `/booking` and `/app/dashboard` answer, and that the dashboard card now shows "שליחת קישור הגדרה".

- [ ] **Step 5: Production proof**

1. Lior mints his own link from the dashboard and opens it on his phone. He connects with his Google account.
2. Check that he lands on "מוכן ✓" with his account shown, and that the dashboard shows ✓ with his account.
3. He opens the room signed in (he's the host), and from a private window (that visitor knocks).
4. Then Lior sends the default tutor her link and she connects. The next online booking carries her room. Verify on the booking's calendar event and email when it happens.

- [ ] **Step 6: Close the loop**

- Post a `td comment add --no-notify` on Todoist `6hmR35WgcWp7Mj2q` with the PR link and the production result.
- Complete the task once the default tutor's room is connected.
- Remove the worktree and the local branch.
