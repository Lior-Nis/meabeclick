# SvelteKit Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace vanilla HTML/JS + Express with a single SvelteKit + TypeScript process, guarded by the repo's first test suite.

**Architecture:** SvelteKit owns pages and API in one `adapter-node` process behind Caddy. A characterization suite is written against today's Express app first, then re-run against SvelteKit as a diff detector. Generated content moves from static serving to explicit routes under one `DATA_DIR`. URLs stop being persisted into records and are derived — and signed — by one helper.

**Tech Stack:** SvelteKit 2.70.3, Svelte 5 (runes), `@sveltejs/adapter-node` 5.5.7, Vite 8, TypeScript, `node:test`, `node:sqlite`, Docker, Caddy, GitHub Actions → GHCR.

**Spec:** `docs/superpowers/specs/2026-08-27-sveltekit-migration-design.md`

## Plan Sequence

This spec is split into three plans. Each produces working, testable software.

| Plan | Covers | Status |
|---|---|---|
| **1 — Characterization suite** (this document, Tasks 1–5) | Spec phase 0 | Execute first, must be green on `main` |
| **2 — The migration** (this document, Tasks 6–24) | Spec phases 1–9 | Depends on Plan 1 |
| **3 — Store unification** | Spec phase 12 item 10 | Separate spec + plan, written after Plan 2 lands |

Plan 3 is deliberately not detailed here. It is a data refactor, not migration work, and the spec sequences it after the parity gate specifically so the suite from Plan 1 guards it.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node >= 22.** `node:sqlite`'s `DatabaseSync` and `node:test` are both built-ins; do not add `better-sqlite3`, `vitest`, `jest`, or `supertest`.
- **SvelteKit 2.70.3 — not 3.x.** Config lives in `svelte.config.js` under a `kit: {}` key. The published docs at svelte.dev are already on v3, where config moved into `vite.config.js` and `csrf.checkOrigin` became `csrf.trustedOrigins`. **v3 guidance does not apply to this codebase.** If a doc example puts `adapter` inside `vite.config.js`, it is v3; ignore it.
- **Svelte 5 runes** — `$state`, `$derived`, `$props`, `$effect`. Not Svelte 4 `export let` / `$:`.
- **TypeScript strict mode**, `"moduleResolution": "bundler"`.
- **No new runtime dependencies** beyond the SvelteKit toolchain itself. Existing deps stay: `@anthropic-ai/sdk`, `node-ical`, `nodemailer`. `express` is removed at the end of Plan 2.
- **Hebrew RTL is load-bearing.** Every page keeps `<html lang="he" dir="rtl">`. Every user-facing string is Hebrew and must be copied **verbatim** — byte-for-byte, including emoji and punctuation. Never translate, paraphrase, or "improve" a Hebrew string.
- **`ORIGIN` must be set** in production (`https://meabeclick.com`) so `adapter-node` knows its public origin behind Caddy. Also set `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`.
- **CSRF is not a concern for the API.** SvelteKit's check only fires for form content types; every POST in this app sends `application/json`. Do not disable CSRF.
- **Never log secrets.** `SESSION_SECRET`, `ADMIN_PASSWORD`, `CLAUDE_CODE_OAUTH_TOKEN`, `GMAIL_APP_PASSWORD`, and `GOOGLE_SERVICE_ACCOUNT_KEY` must never reach stdout, an error message, or a test fixture.
- **Commit after every task.** Small commits, imperative subject lines.

---

# Plan 1 — Characterization Suite

Written against today's Express app, on branch `worktree-sveltekit-migration`. Must be green before Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `tests/characterization/harness.mjs` | Boot a server (Express *or* SvelteKit) on a temp DB, wait for readiness, tear down |
| `tests/characterization/expected-changes.mjs` | The named list of deliberate behavior changes from spec §9 |
| `tests/characterization/auth.test.mjs` | `/api/login`, `/api/logout`, `/api/me`, guard behavior |
| `tests/characterization/portal.test.mjs` | `/api/portal/:code` PIN boundary, `/api/portal-students` |
| `tests/characterization/booking.test.mjs` | `/api/book` reservation ordering, 409, release |
| `tests/characterization/students.test.mjs` | students CRUD, results, lessons, game-result |

The harness is one file because every test needs it and it changes as one unit. Tests split by domain because they are read and rejected independently.

---

### Task 1: Test harness

**Files:**
- Create: `tests/characterization/harness.mjs`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Consumes: nothing
- Produces: `startServer(opts?: { target?: 'express' | 'sveltekit', env?: Record<string,string> }): Promise<{ baseUrl: string, stop: () => Promise<void>, dbPath: string }>`

The harness spawns the server as a child process rather than importing it, because `server/app.mjs` calls `app.listen()` at module scope and cannot be imported without binding a port.

**Env deliberately unset** so no test touches the network: `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `CLAUDE_CODE_OAUTH_TOKEN`, `CALLMEBOT_API_KEY`, `ANTHROPIC_API_KEY`. With these unset, `book.js` returns before any Google call and `sendBookingEmail` returns `false` immediately (`api/book.js:225-228`).

- [ ] **Step 1: Write the harness**

```js
// tests/characterization/harness.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ports are allocated per-call so parallel test files never collide. */
let nextPort = 8200;

const BLOCKED = [
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILE', 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_SERVICE_ACCOUNT_KEY', 'GMAIL_USER', 'GMAIL_APP_PASSWORD',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CALLMEBOT_API_KEY', 'ANTHROPIC_API_KEY',
];

export async function startServer({ target = 'express', env = {} } = {}) {
  const port    = nextPort++;
  const dataDir = await mkdtemp(join(tmpdir(), 'meabeclick-test-'));
  const dbPath  = join(dataDir, 'results.db');

  const childEnv = { ...process.env };
  for (const key of BLOCKED) delete childEnv[key];
  Object.assign(childEnv, {
    PORT: String(port),
    DB_PATH: dbPath,
    DATA_DIR: dataDir,
    ADMIN_PASSWORD: 'test-password',
    SESSION_SECRET: 'test-secret-not-a-real-one',
    SITE_URL: `http://127.0.0.1:${port}`,
    ORIGIN: `http://127.0.0.1:${port}`,
    ...env,
  });

  const entry = target === 'express' ? 'server/app.mjs' : 'build/index.js';
  const child = spawn('node', [entry], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', c => { stderr += c; });
  child.stdout.resume();

  const baseUrl = `http://127.0.0.1:${port}`;

  // Poll until it answers. /api/me is unauthenticated and always 200.
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`server exited ${child.exitCode} before listening:\n${stderr}`);
    }
    try {
      const r = await fetch(`${baseUrl}/api/me`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never listened:\n${stderr}`);
    await new Promise(res => setTimeout(res, 100));
  }

  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise(res => child.once('exit', res));
    await rm(dataDir, { recursive: true, force: true });
  };

  return { baseUrl, stop, dbPath, dataDir };
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
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `scripts`:

```json
"test": "node --test tests/characterization/"
```

- [ ] **Step 3: Write a smoke test proving the harness works**

```js
// tests/characterization/harness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

test('harness boots the express app and tears it down', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/me`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { authenticated: false });
  } finally {
    await stop();
  }
});

test('harness can log in and return a usable cookie', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.deepEqual(await r.json(), { authenticated: true });
  } finally {
    await stop();
  }
});
```

- [ ] **Step 4: Run it**

Run: `npm test`
Expected: 2 tests pass. If the server fails to boot, the thrown error contains its stderr — read it rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add tests/characterization/harness.mjs tests/characterization/harness.test.mjs package.json
git commit -m "test: add characterization harness for the express app"
```

---

### Task 2: Auth characterization

**Files:**
- Create: `tests/characterization/auth.test.mjs`

**Interfaces:**
- Consumes: `startServer`, `login` from `./harness.mjs`
- Produces: nothing

Behavior being frozen, read from `server/auth.mjs`: wrong password → 401 with the Hebrew message; correct password → `HttpOnly` cookie; guarded API path without session → 401 JSON; guarded *page* without session → 302 to `/login.html`.

- [ ] **Step 1: Write the tests**

```js
// tests/characterization/auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

test('rejects a wrong password with 401 and the Hebrew message', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'סיסמה שגויה' });
  } finally { await stop(); }
});

test('issues an HttpOnly session cookie on correct password', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().find(c => c.startsWith('maab_session='));
    assert.ok(cookie, 'expected a maab_session cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  } finally { await stop(); }
});

test('guarded API route answers 401 JSON without a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/results`);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
  } finally { await stop(); }
});

test('guarded page redirects to login without a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/app/dashboard`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/login.html');
  } finally { await stop(); }
});

test('logout clears the cookie', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const cleared = r.headers.getSetCookie().find(c => c.startsWith('maab_session='));
    assert.match(cleared, /Max-Age=0/);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: all pass. A failure here means the harness env differs from what `auth.mjs` expects — check `ADMIN_PASSWORD`.

- [ ] **Step 3: Commit**

```bash
git add tests/characterization/auth.test.mjs
git commit -m "test: characterize auth and session behavior"
```

---

### Task 3: Portal PIN boundary characterization

**Files:**
- Create: `tests/characterization/portal.test.mjs`

**Interfaces:**
- Consumes: `startServer`, `login` from `./harness.mjs`
- Produces: nothing

The security-critical property from `server/app.mjs:194-215`: a bad code, a wrong PIN, a nonexistent student, and a missing file must all answer **identically**, so the endpoint cannot be used to discover who exists. This test is the one that must not regress.

- [ ] **Step 1: Write the tests**

```js
// tests/characterization/portal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const DENIED = { status: 401, body: { error: 'קוד או סיסמה שגויים' } };

async function createStudent(baseUrl, cookie, code = 'testkid') {
  const r = await fetch(`${baseUrl}/api/students`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ code, name: 'ילד בדיקה', subject: 'מתמטיקה', level: 'כיתה י' }),
  });
  assert.equal(r.status, 200);
  return (await r.json()).student;
}

test('every failure mode of /api/portal answers identically', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await createStudent(baseUrl, cookie, 'testkid');

    const cases = {
      'invalid code format': `${baseUrl}/api/portal/BAD_CODE?pin=1234`,
      'nonexistent student': `${baseUrl}/api/portal/nosuchkid?pin=1234`,
      'wrong pin':           `${baseUrl}/api/portal/testkid?pin=0000`,
      'missing pin':         `${baseUrl}/api/portal/testkid`,
    };

    for (const [label, url] of Object.entries(cases)) {
      const r = await fetch(url);
      assert.equal(r.status, DENIED.status, `${label}: status`);
      assert.deepEqual(await r.json(), DENIED.body, `${label}: body`);
    }
  } finally { await stop(); }
});

test('portal-students exposes names but never pins or codes-with-pins', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    await createStudent(baseUrl, cookie, 'testkid');

    const r = await fetch(`${baseUrl}/api/portal-students`);
    assert.equal(r.status, 200);
    const { students } = await r.json();
    assert.ok(students.length >= 1);
    for (const s of students) {
      assert.deepEqual(Object.keys(s).sort(), ['code', 'name', 'subject']);
      assert.ok(!('student_pin' in s) && !('parent_pin' in s) && !('password' in s));
    }
  } finally { await stop(); }
});

test('students list requires a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/students`);
    assert.equal(r.status, 401);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/characterization/portal.test.mjs
git commit -m "test: characterize the portal PIN boundary"
```

---

### Task 4: Booking characterization

**Files:**
- Create: `tests/characterization/booking.test.mjs`

**Interfaces:**
- Consumes: `startServer` from `./harness.mjs`
- Produces: nothing

The invariant from `server/app.mjs:100-124`: `reserveBooking()` runs synchronously before any async work, so a second booking of the same hour gets 409 and never reaches `book()`. With Google and Gmail env unset, a successful booking returns `{ ok: false, fallback: true, emailed: false }` at status 200.

- [ ] **Step 1: Write the tests**

```js
// tests/characterization/booking.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

/** A fixed future slot. Dates are literals so the test never depends on "now". */
const SLOT = { start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T10:45:00+02:00' };

const booking = (over = {}) => ({
  name: 'דנה כהן', subject: 'מתמטיקה', topic: 'פונקציות',
  phone: '0501234567', level: 'כיתה י', durationMin: 45,
  ...SLOT, ...over,
});

test('rejects a booking missing required fields', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'דנה' }),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'חסרים פרטים' });
  } finally { await stop(); }
});

test('books an hour and falls back to email when no calendar is configured', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, false, 'no service account → not a calendar write');
    assert.equal(body.fallback, true);
    assert.equal(body.emailed, false, 'no GMAIL_* → email skipped, not attempted');
  } finally { await stop(); }
});

test('the same hour cannot be booked twice', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const first = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking()),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ name: 'יוסי לוי', phone: '0527654321' })),
    });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'השעה הזו כבר תפוסה' });
  } finally { await stop(); }
});

test('two simultaneous bookings of one hour produce exactly one winner', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const post = name => fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ name })),
    });

    const [a, b] = await Promise.all([post('הורה א'), post('הורה ב')]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 409], 'exactly one booking must win the hour');
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run**

Run: `npm test`
Expected: all pass. If the concurrency test is flaky, that is a **real finding** about `reserveBooking` — do not paper over it with a retry; report it.

- [ ] **Step 3: Commit**

```bash
git add tests/characterization/booking.test.mjs
git commit -m "test: characterize booking reservation and double-book rejection"
```

---

### Task 5: Students, results, lessons + the expected-changes list

**Files:**
- Create: `tests/characterization/students.test.mjs`
- Create: `tests/characterization/expected-changes.mjs`

**Interfaces:**
- Consumes: `startServer`, `login` from `./harness.mjs`
- Produces: `EXPECTED_CHANGES: Array<{ id: string, route: string, was: string, now: string, why: string }>` — read by a human when a diff appears, and referenced by later tasks that flip a test's expectation.

- [ ] **Step 1: Write the expected-changes list**

```js
// tests/characterization/expected-changes.mjs
/**
 * Deliberate behavior changes introduced by the SvelteKit migration.
 *
 * The characterization suite is a DIFF DETECTOR, not a parity gate: a test
 * that fails is either a regression or an entry in this list. Anything not
 * listed here that changed is a regression until proven otherwise.
 *
 * See docs/superpowers/specs/2026-08-27-sveltekit-migration-design.md §9.
 */
export const EXPECTED_CHANGES = [
  {
    id: 'todoist-6hJh33RvfVc8r84H',
    route: 'startup',
    was: "SITE_URL unset falls back to 'http://76.13.59.4:8080', leaking the server IP into parent emails",
    now: 'the app refuses to boot without SITE_URL',
    why: 'p2 bug — a raw IP in a parent inbox; missing config should fail loudly at boot',
  },
  {
    id: 'todoist-6hJh32VVc5VH2jVq',
    route: 'POST /api/game-result',
    was: 'accepts any anonymous body, so results can be forged',
    now: 'requires a valid &t=<hmac> signature over {dataId, student}; unsigned posts are rejected',
    why: 'p2 bug — cheap to fix once URL construction is centralized in urls.ts',
  },
  {
    id: 'todoist-6hJh337GrfGQj5Hq',
    route: 'games/speed-drill',
    was: "personal best kept in localStorage, wiped by WhatsApp's in-app WebView between opens",
    now: 'personal best read from the results table via getBest(student, dataId)',
    why: 'p3 bug — the data was already server-side; localStorage never survived the delivery channel',
  },
  {
    id: 'page-urls',
    route: 'all pages',
    was: '/booking.html, /login.html, /portal.html',
    now: '/booking, /login, /portal',
    why: 'SvelteKit routing; no live users depend on the old URLs',
  },
  {
    id: 'game-urls',
    route: 'games',
    was: '/games/<template>.html?d=&s=',
    now: '/app/play/<template>?d=&s=&t=',
    why: 'spec §6 — puts the homework loop inside a future PWA scope',
  },
];
```

- [ ] **Step 2: Write the tests**

```js
// tests/characterization/students.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

test('creating a student rejects a non-slug code', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'Bad Code', name: 'שם' }),
    });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'הקוד חייב להיות באנגלית קטנה, בלי רווחים' });
  } finally { await stop(); }
});

test('creating a duplicate code is rejected', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const body = JSON.stringify({ code: 'dana', name: 'דנה' });
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };

    const first = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/students`, { method: 'POST', headers, body });
    assert.equal(second.status, 409);
    assert.deepEqual(await second.json(), { error: 'הקוד הזה כבר תפוס' });
  } finally { await stop(); }
});

test('a student added by hand always gets a password', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: 'noam', name: 'נועם' }),
    });
    const { student } = await r.json();
    assert.ok(student.password, 'a manually added student must not be locked out');
  } finally { await stop(); }
});

test('game-result never fails loudly, even on a storage problem', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: 'דנה', dataId: 'x-quiz', template: 'quiz', score: 5, total: 6 }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  } finally { await stop(); }
});

test('game-result rejects an empty student name', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/game-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student: '   ' }),
    });
    assert.equal(r.status, 400);
  } finally { await stop(); }
});

test('lessons are readable unauthenticated but filterable by student', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/lessons?student=דנה`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(Array.isArray((await r.json()).lessons));
  } finally { await stop(); }
});
```

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: every test across all five files passes. **This is the Plan 1 gate.** Do not start Task 6 until it is green.

- [ ] **Step 4: Commit**

```bash
git add tests/characterization/students.test.mjs tests/characterization/expected-changes.mjs
git commit -m "test: characterize students, results and lessons; record expected changes"
```

---

# Plan 2 — The Migration

Begins only once `npm test` is green. Tasks 6–24.

## File Structure

| File | Responsibility |
|---|---|
| `svelte.config.js` | adapter-node, `paths`, alias config (SvelteKit **2.x** shape) |
| `src/app.d.ts` | `App.Locals` typing — `locals.authenticated` |
| `src/hooks.server.ts` | Validate session cookie once per request |
| `src/lib/server/singleton.ts` | `globalThis` guard so Vite HMR does not duplicate stateful modules |
| `src/lib/server/db.ts` | SQLite access, typed rows (from `server/db.mjs`) |
| `src/lib/server/auth.ts` | HMAC cookie crypto (from `server/auth.mjs`) |
| `src/lib/server/urls.ts` | The only place a game/lesson URL is built or signed |
| `src/lib/server/content.ts` | Reads generated content out of `DATA_DIR` |
| `src/lib/server/boot-checks.ts` | Startup verification of external dependencies |
| `src/lib/server/pricing.ts` | KB balance parsing, path from env |
| `src/lib/server/calendar.ts`, `email.ts` | Ported from `server/calendar.mjs`, `api/book.js` |
| `src/lib/server/lesson/*.ts` | Ported from `server/lesson-prep.mjs`, `lesson-queue.mjs` |
| `src/lib/games/engine.ts` | The typed replacement for `games/game.js` |
| `src/lib/games/*.svelte` | 12 game bodies |
| `src/routes/**` | Pages and API |

---

### Task 6: Scaffold SvelteKit alongside Express

Express keeps working; this only adds the new app so both can run during the port.

**Files:**
- Create: `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.d.ts`, `src/app.html`, `src/routes/+layout.svelte`, `src/routes/+page.svelte`
- Modify: `package.json`, `.gitignore`

- [ ] **Step 1: Install the toolchain**

```bash
npm install -D @sveltejs/kit@2.70.3 @sveltejs/adapter-node@5.5.7 @sveltejs/vite-plugin-svelte svelte@5 svelte-check typescript vite@8
```

- [ ] **Step 2: Write `svelte.config.js`**

Note the `kit: {}` key — this is the 2.x shape. Do not follow v3 docs that move this into `vite.config.ts`.

```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: { $server: 'src/lib/server' },
  },
};
```

- [ ] **Step 3: Write `src/app.html` preserving RTL**

```html
<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/images/favicon.svg" />
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 4: Write `src/app.d.ts`**

```ts
declare global {
  namespace App {
    interface Locals {
      /** True when a valid tutor session cookie was presented. */
      authenticated: boolean;
    }
  }
}
export {};
```

- [ ] **Step 5: Add scripts and ignore build output**

`package.json` scripts gain:

```json
"dev": "vite dev",
"build": "vite build",
"check": "svelte-check --tsconfig ./tsconfig.json"
```

`.gitignore` gains:

```
/build/
/.svelte-kit/
```

- [ ] **Step 6: Verify it builds and the old suite still passes**

Run: `npm run build && npm test`
Expected: build succeeds, all Plan 1 tests still pass (Express is untouched).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "build: scaffold SvelteKit alongside the express app"
```

---

### Task 7: Port the database layer with an HMR-safe singleton

**Files:**
- Create: `src/lib/server/singleton.ts`, `src/lib/server/db.ts`
- Test: `tests/unit/db.test.mjs`

**Interfaces:**
- Produces:
  - `singleton<T>(key: string, make: () => T): T`
  - `type StudentRow = { code: string; name: string; subject: string | null; level: string | null; student_pin: string; parent_pin: string; phone: string | null; password: string | null; created_at: string }`
  - `type ResultRow = { id: number; student: string; at: string; data_id: string | null; template: string | null; score: number | null; total: number | null; tries: number | null; stars: number | null; seconds: number | null; missed: string | null }`
  - Every function currently exported by `server/db.mjs`, same names and semantics, plus `getBest(student: string, dataId: string): number | null`

- [ ] **Step 1: Write the singleton guard**

Without this, Vite HMR re-evaluates the module in dev and opens a second `DatabaseSync` handle against the same file.

```ts
// src/lib/server/singleton.ts
const store = globalThis as unknown as { __meabeclick?: Map<string, unknown> };
store.__meabeclick ??= new Map();

/** Survives Vite HMR module re-evaluation in dev; a plain call in production. */
export function singleton<T>(key: string, make: () => T): T {
  const cache = store.__meabeclick!;
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}
```

- [ ] **Step 2: Write the failing test for the new `getBest`**

```js
// tests/unit/db.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('getBest returns the highest score for a student on one game', async () => {
  process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'db-')), 'results.db');
  const { writeResult, getBest } = await import('../../src/lib/server/db.ts');

  writeResult({ student: 'דנה', dataId: 'x-speed', template: 'speed-drill', score: 12, total: 20 });
  writeResult({ student: 'דנה', dataId: 'x-speed', template: 'speed-drill', score: 17, total: 20 });
  writeResult({ student: 'דנה', dataId: 'y-quiz',  template: 'quiz',        score: 30, total: 30 });

  assert.equal(getBest('דנה', 'x-speed'), 17);
  assert.equal(getBest('דנה', 'nothing'), null);
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --test tests/unit/db.test.mjs`
Expected: FAIL — `src/lib/server/db.ts` does not exist.

- [ ] **Step 4: Port `server/db.mjs` to `src/lib/server/db.ts`**

Copy the file verbatim, then: add the row types above, wrap the `DatabaseSync` construction in `singleton('db', () => …)`, replace the `DB_PATH` default with `join(env.DATA_DIR ?? './data', 'results.db')`, and append:

```ts
export function getBest(student: string, dataId: string): number | null {
  const row = db.prepare(
    `SELECT MAX(score) AS best FROM results WHERE student = ? AND data_id = ?`
  ).get(student, dataId) as { best: number | null } | undefined;
  return row?.best ?? null;
}
```

Keep the two `ALTER TABLE` migrations and their comments — existing databases depend on them.

- [ ] **Step 5: Run**

Run: `node --test tests/unit/db.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/singleton.ts src/lib/server/db.ts tests/unit/db.test.mjs
git commit -m "feat: port the database layer to typescript with an HMR-safe singleton"
```

---

### Task 8: Port auth into hooks

**Files:**
- Create: `src/lib/server/auth.ts`, `src/hooks.server.ts`
- Test: covered by re-running Plan 1's `auth.test.mjs` against the new app in Task 13

**Interfaces:**
- Produces:
  - `makeToken(): string`, `validToken(token: string | null): boolean`
  - `requireAuth(event: RequestEvent): void` — throws `error(401)` for `/api/*`, `redirect(302, '/login')` otherwise
  - `COOKIE_NAME = 'maab_session'`

- [ ] **Step 1: Port the crypto verbatim**

Copy `sign`, `makeToken`, `validToken` from `server/auth.mjs` into `src/lib/server/auth.ts` unchanged — the HMAC construction, the constant-time compare, and the length check before `timingSafeEqual` are all deliberate. Replace `readCookie` with SvelteKit's `event.cookies.get()`.

- [ ] **Step 2: Write the hook**

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit';
import { validToken, COOKIE_NAME } from '$server/auth';
import { runBootChecks } from '$server/boot-checks';

runBootChecks();

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.authenticated = validToken(event.cookies.get(COOKIE_NAME) ?? null);
  return resolve(event);
};
```

- [ ] **Step 3: Write `requireAuth`**

```ts
// in src/lib/server/auth.ts
import { error, redirect, type RequestEvent } from '@sveltejs/kit';

export function requireAuth(event: RequestEvent): void {
  if (event.locals.authenticated) return;
  if (event.url.pathname.startsWith('/api/')) error(401, 'unauthorized');
  redirect(302, '/login');
}
```

Note the redirect target changes from `/login.html` to `/login` — this is the `page-urls` entry in `EXPECTED_CHANGES`, so `auth.test.mjs` must be updated when it runs against SvelteKit in Task 13.

- [ ] **Step 4: Verify it compiles**

Run: `npm run check`
Expected: no errors. `boot-checks` does not exist yet — create it as a stub exporting `runBootChecks() {}` and fill it in Task 21.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/auth.ts src/hooks.server.ts src/lib/server/boot-checks.ts
git commit -m "feat: port auth into hooks.server.ts"
```

---

### Task 9: Port the remaining server modules

**Files:**
- Create: `src/lib/server/calendar.ts`, `src/lib/server/pricing.ts`, `src/lib/server/email.ts`, `src/lib/server/enroll.ts`

**Interfaces:**
- Produces: `fetchBusy`, `icsUrls` (from `calendar.mjs`); `getBalance(studentName: string)` (from `pricing.mjs`); `sendBookingEmail(b, inCalendar, enrolled)` (extracted from `api/book.js:217+`); `enrollFromBooking(...)` (from `enroll.mjs`)

These are **mechanical ports**. Translate types, change nothing else. The one required behavior change:

- [ ] **Step 1: Make the pricing path configurable**

`server/pricing.mjs` resolves its path from `import.meta.url + '..'`, which breaks once the build output relocates.

```ts
// src/lib/server/pricing.ts
import { env } from '$env/dynamic/private';

const SUMMARY_PATH = env.KB_PRICING_PATH ?? '/app/mea-beclick-kb/pricing/Summary.md';
```

Keep `parseOverviewTable` and `getBalance` byte-identical otherwise — the table parsing handles a hand-edited Markdown file and its skip rules are load-bearing.

- [ ] **Step 2: Extract the email module**

Move `sendBookingEmail` and its helpers out of `api/book.js` into `src/lib/server/email.ts` unchanged, except: remove the `'http://76.13.59.4:8080'` fallback and read `SITE_URL` from `$env/dynamic/private`, which `boot-checks` guarantees is set (Task 21). This is the `todoist-6hJh33RvfVc8r84H` entry in `EXPECTED_CHANGES`.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/calendar.ts src/lib/server/pricing.ts src/lib/server/email.ts src/lib/server/enroll.ts
git commit -m "feat: port calendar, pricing, email and enrolment modules"
```

---

### Task 10: The URL builder and signer

This is the keystone: it removes stored URLs, enables the forgery fix, and makes future URL changes free.

**Files:**
- Create: `src/lib/server/urls.ts`
- Test: `tests/unit/urls.test.mjs`

**Interfaces:**
- Produces:
  - `gameUrl(input: { template: string; dataId: string; student: string }): string` — returns `/app/play/<template>?d=<dataId>&s=<student>&t=<sig>`
  - `verifyGameSignature(input: { dataId: string; student: string; t: string }): boolean`
  - `lessonUrl(slug: string): string` — returns `/lessons/<slug>`
  - `type GameRef = { template: string; dataId: string }` — the shape now stored in records instead of a URL

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/urls.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = 'test-secret-not-a-real-one';
const { gameUrl, verifyGameSignature } = await import('../../src/lib/server/urls.ts');

test('gameUrl builds a site-absolute signed url under /app/play', async () => {
  const url = gameUrl({ template: 'memory', dataId: 'noga-integrals-memory', student: 'נוגה' });
  assert.ok(url.startsWith('/app/play/memory?'), url);
  const q = new URL(url, 'http://x').searchParams;
  assert.equal(q.get('d'), 'noga-integrals-memory');
  assert.equal(q.get('s'), 'נוגה');
  assert.ok(q.get('t'), 'expected a signature');
});

test('a valid signature verifies and a tampered one does not', async () => {
  const url = gameUrl({ template: 'quiz', dataId: 'x-quiz', student: 'דנה' });
  const t = new URL(url, 'http://x').searchParams.get('t');

  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'דנה', t }), true);
  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'יוסי', t }), false,
    'a signature must not transfer to another student');
  assert.equal(verifyGameSignature({ dataId: 'other', student: 'דנה', t }), false,
    'a signature must not transfer to another assignment');
  assert.equal(verifyGameSignature({ dataId: 'x-quiz', student: 'דנה', t: 'forged' }), false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --test tests/unit/urls.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/urls.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export type GameRef = { template: string; dataId: string };

const secret = () => env.SESSION_SECRET ?? '';

/** Signed over the pair, so a signature is useless for another student or assignment. */
function sign(dataId: string, student: string): string {
  return createHmac('sha256', secret()).update(`${dataId} ${student}`).digest('base64url');
}

export function gameUrl({ template, dataId, student }: GameRef & { student: string }): string {
  const q = new URLSearchParams({ d: dataId, s: student, t: sign(dataId, student) });
  return `/app/play/${template}?${q}`;
}

export function verifyGameSignature({ dataId, student, t }: { dataId: string; student: string; t: string | null }): boolean {
  if (!t) return false;
  const want = Buffer.from(sign(dataId, student));
  const got  = Buffer.from(t);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function lessonUrl(slug: string): string {
  return `/lessons/${slug}`;
}
```

- [ ] **Step 4: Run**

Run: `node --test tests/unit/urls.test.mjs`
Expected: PASS, all four assertions in the second test included.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/urls.ts tests/unit/urls.test.mjs
git commit -m "feat: add the signed url builder that replaces stored urls"
```

---

### Task 11: Port the lesson pipeline

**Files:**
- Create: `src/lib/server/lesson/prep.ts`, `src/lib/server/lesson/queue.ts`, `src/lib/server/lesson/registry.ts`
- Modify: `games/registry.json`

**Interfaces:**
- Consumes: `gameUrl`, `GameRef` from `$server/urls`; `singleton` from `$server/singleton`
- Produces: `triggerForBooking(booking, opts)`, `generateLesson`, `renderSlides`, `validateLesson`, `TEMPLATE_FILES`, `toTemplateShape` — same names as today

**This is the highest-risk port** (spec §14). Translate mechanically. Do not restructure the prompt construction, the schema validation, the timeout ladder, or the unpiped stdout in `runClaudeCode` — each is load-bearing and is explained in a comment at its site.

- [ ] **Step 1: Wrap the rate-limit state in the singleton**

`recent[]` in `lesson-queue.mjs:22` is module-level and must survive HMR:

```ts
const recent = singleton('lesson-recent', () => [] as number[]);
```

- [ ] **Step 2: Store refs, not URLs**

Replace `lesson-queue.mjs:127`:

```ts
// was: url: `games/${template}.html?d=${dataId}&s=${...}`
games.push({ title: data.title, template, dataId });
```

and the return value:

```ts
return { slug, games };   // was: { slidesUrl: `lessons/${slug}/slides.html`, games }
```

Callers now derive URLs through `gameUrl()` / `lessonUrl()` at render time.

- [ ] **Step 3: Update the registry contract**

In `games/registry.json`:

```json
"urlPattern": "/app/play/{template}?d={dataId}&s={student}&t={signature}",
"dataPath": "/app/play/data/{dataId}.json",
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/lesson games/registry.json
git commit -m "feat: port the lesson pipeline and store game refs instead of urls"
```

---

### Task 12: The generated-content plane

**Files:**
- Create: `src/lib/server/content.ts`, `src/routes/app/play/data/[id].json/+server.ts`, `src/routes/lessons/[slug]/+server.ts`, `src/routes/drafts/[slug]/[...file]/+server.ts`
- Test: `tests/unit/content.test.mjs`

**Interfaces:**
- Produces: `readContent(kind: 'lessons' | 'games-data' | 'drafts' | 'portal', ...segments: string[]): Promise<Buffer>`, `dataDir(): string`

- [ ] **Step 1: Write the failing traversal test**

The single most important property: a URL segment must never escape `DATA_DIR`.

```js
// tests/unit/content.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), 'content-'));
const { readContent } = await import('../../src/lib/server/content.ts');

for (const evil of ['../secrets', '..%2Fsecrets', 'a/../../etc/passwd', 'Nope', 'has space', '']) {
  test(`rejects the segment ${JSON.stringify(evil)}`, async () => {
    await assert.rejects(() => readContent('games-data', evil));
  });
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `node --test tests/unit/content.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/server/content.ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from '$env/dynamic/private';

const SEGMENT = /^[a-z0-9-]+$/;   // same guard as server/app.mjs:200, applied everywhere

export const dataDir = () => env.DATA_DIR ?? './data';

export async function readContent(
  kind: 'lessons' | 'games-data' | 'drafts' | 'portal',
  ...segments: string[]
): Promise<Buffer> {
  for (const s of segments) {
    if (!SEGMENT.test(s)) throw new Error(`illegal path segment: ${s}`);
  }
  return readFile(join(dataDir(), kind, ...segments));
}
```

Segments are validated against an allowlist rather than checking for `..`, so nothing under `DATA_DIR` is reachable except by an exact slug match.

- [ ] **Step 4: Run**

Run: `node --test tests/unit/content.test.mjs`
Expected: all six rejection cases PASS.

- [ ] **Step 5: Write the routes**

```ts
// src/routes/app/play/data/[id].json/+server.ts
import { error } from '@sveltejs/kit';
import { readContent } from '$server/content';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const body = await readContent('games-data', `${params.id}.json`);
    return new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    error(404, 'לא נמצא');
  }
};
```

`drafts` gets the same shape with `requireAuth(event)` as its first line.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/content.ts src/routes/app/play/data src/routes/lessons src/routes/drafts tests/unit/content.test.mjs
git commit -m "feat: serve generated content through routes instead of static"
```

---

### Task 13: Port the API — auth, results, lessons

**Files:**
- Create: `src/routes/api/login/+server.ts`, `src/routes/api/logout/+server.ts`, `src/routes/api/me/+server.ts`, `src/routes/api/results/+server.ts`, `src/routes/api/lessons/+server.ts`, `src/routes/api/game-result/+server.ts`
- Modify: `tests/characterization/auth.test.mjs` (the `/login` redirect target)

- [ ] **Step 1: Port the six routes**

Each is a direct translation of its Express handler. `/api/game-result` gains signature verification:

```ts
// src/routes/api/game-result/+server.ts
import { json } from '@sveltejs/kit';
import { writeResult } from '$server/db';
import { verifyGameSignature } from '$server/urls';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const student = String(body?.student ?? '').trim();
  if (!student) return json({ error: 'no student' }, { status: 400 });

  if (!verifyGameSignature({ dataId: body?.dataId, student, t: body?.t ?? null })) {
    return json({ error: 'bad signature' }, { status: 403 });
  }

  // Never fail loudly: a storage problem must not make finished homework look broken.
  try {
    writeResult(body);
    return json({ ok: true, stored: true });
  } catch (err) {
    console.error('game-result', err);
    return json({ ok: true, stored: false, reason: 'store error' });
  }
};
```

- [ ] **Step 2: Update the redirect assertion**

In `tests/characterization/auth.test.mjs`, change the expected `location` from `/login.html` to `/login`, and add a comment citing the `page-urls` entry in `EXPECTED_CHANGES`.

- [ ] **Step 3: Build and run the suite against SvelteKit**

```bash
npm run build
node --test tests/characterization/auth.test.mjs
```

Run each test file with `startServer({ target: 'sveltekit' })`. Add a `TARGET` env switch to the harness so one command runs the suite against either server.

Expected: auth tests pass against both. `game-result` tests fail — they post unsigned bodies. Update them to sign, and record it as the `todoist-6hJh32VVc5VH2jVq` expected change.

- [ ] **Step 4: Commit**

```bash
git add src/routes/api tests/characterization
git commit -m "feat: port auth, results and lessons endpoints to sveltekit"
```

---

### Task 14: Port the API — students, portal, calendar failures

**Files:**
- Create: `src/routes/api/students/+server.ts`, `src/routes/api/students/[code]/+server.ts`, `src/routes/api/students/[code]/regenerate/+server.ts`, `src/routes/api/portal/[code]/+server.ts`, `src/routes/api/portal-students/+server.ts`, `src/routes/api/calendar-failures/+server.ts`, `src/routes/api/calendar-failures/[id]/resolve/+server.ts`, `src/routes/api/verify-account/+server.ts`, `src/routes/api/ask/+server.ts`

Direct translations. **The portal route's uniform denial is the one property that must not drift** — a bad code, a wrong PIN, a missing student, and a missing file all return the same 401 body. Keep the single `deny()` helper.

- [ ] **Step 1: Port them**
- [ ] **Step 2: Run `portal.test.mjs` and `students.test.mjs` against SvelteKit**

Run: `TARGET=sveltekit node --test tests/characterization/portal.test.mjs tests/characterization/students.test.mjs`
Expected: PASS with no expected-changes entries needed.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api
git commit -m "feat: port students, portal and calendar-failure endpoints"
```

---

### Task 15: Port `/api/book`

The highest-value single route. Porting it deletes both Vercel artifacts.

**Files:**
- Create: `src/routes/api/book/+server.ts`, `src/routes/api/availability/+server.ts`, `src/routes/api/remind/+server.ts`

- [ ] **Step 1: Port book, collapsing the `res.on('finish')` hook**

The hook existed only because the Express wrapper could not observe the ported handler's outcome. Owning the handler, the outcome is known inline:

```ts
// src/routes/api/book/+server.ts — shape only; port the body from api/book.js
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();

  // Reserve synchronously BEFORE any async work — this is the race defense.
  let bookingId: number | null = null;
  if (body?.start && body?.end) {
    bookingId = reserveBooking(body);
    if (bookingId == null) return json({ error: 'השעה הזו כבר תפוסה' }, { status: 409 });
  }

  const result = await book(body);          // ported from api/book.js

  if (result.status === 200 && body?.name && body?.subject) {
    try {
      triggerForBooking(body, { notify: sendWhatsApp, enrolledCode: result.enrolledCode ?? null });
    } catch (e) { console.error('trigger', e); }
  } else if (bookingId != null) {
    try { cancelBooking(bookingId); } catch (e) { console.error('booking release', e); }
  }

  return json(result.body, { status: result.status });
};
```

- [ ] **Step 2: Run the booking suite against SvelteKit**

Run: `TARGET=sveltekit node --test tests/characterization/booking.test.mjs`
Expected: all four tests PASS, including the concurrency test. If the concurrency test fails here but passed against Express, the reservation moved after an `await` — fix the ordering, do not adjust the test.

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/book src/routes/api/availability src/routes/api/remind
git commit -m "feat: port the booking endpoint and drop the res.on(finish) workaround"
```

---

### Task 16: Design tokens and the shared layout

**Files:**
- Create: `src/lib/styles/tokens.css`, `src/routes/+layout.svelte`, `src/lib/components/*.svelte`

- [ ] **Step 1: Extract tokens**

Read the custom properties already defined at the top of `pages/styles.css` and `games/game.css` (`--brand`, `--brand-d`, `--muted`, `--text`, …). Where a page's inline `<style>` defines the same concept with a different value, pick the treatment used by the most pages and note the drift in the commit message.

- [ ] **Step 2: Build the shared layout**

Header, footer, and the Heebo font link (currently duplicated in all 12 game templates plus every page) move here.

- [ ] **Step 3: Verify**

Run: `npm run build && npm run check`

- [ ] **Step 4: Commit**

```bash
git add src/lib/styles src/lib/components src/routes/+layout.svelte
git commit -m "feat: extract design tokens and the shared layout"
```

---

### Task 17: Port the landing pages

**Files:**
- Create: `src/routes/+page.svelte`, `src/routes/booking/+page.svelte`, `src/routes/login/+page.svelte`, `src/routes/portal/+page.svelte`

Port `pages/index.html` (728 lines), `booking.html` (990), `login.html` (74), `portal.html` (134). Inline `<script>` becomes component logic with runes; inline `<style>` becomes scoped component styles that consume the tokens from Task 16.

**Every Hebrew string is copied verbatim.**

- [ ] **Step 1: Port each page**
- [ ] **Step 2: Click through each at `npm run dev`** — confirm RTL, fonts, and that the booking form posts and renders slots
- [ ] **Step 3: Commit**

```bash
git add src/routes
git commit -m "feat: port the landing pages to svelte components"
```

---

### Task 18: Port the app pages with in-app navigation

**Files:**
- Create: `src/routes/app/+layout.svelte`, `src/routes/app/dashboard/+page.svelte`, `src/routes/app/dashboard/+page.server.ts`, `src/routes/app/games/+page.svelte`, `src/routes/app/parent/+page.svelte`, `src/routes/app/student/+page.svelte`

`+layout.svelte` owns the app shell and the nav — this is sub-project #4, folded in because excluding it would mean keeping `target="_blank"` hops between pages that now share a layout.

**`/app/` means PWA scope and navigation, not authentication** (spec §6). `dashboard` and `games` call `requireAuth` in their `+page.server.ts`; `parent`, `student`, and `play` must **not**. Do not add a guard to the layout.

- [ ] **Step 1: Port the four pages**
- [ ] **Step 2: Replace `target="_blank"` hops with `<a href>` in-app links**
- [ ] **Step 3: Click through: log in, reach the dashboard, navigate to games, open parent and student pages with a real `?s=` code**
- [ ] **Step 4: Commit**

```bash
git add src/routes/app
git commit -m "feat: port the app pages with a shared layout and in-app nav"
```

---

### Task 19: The games engine module

**Files:**
- Create: `src/lib/games/engine.ts`, `src/lib/games/GameShell.svelte`, `src/routes/app/play/[template]/+page.svelte`, `src/routes/app/play/[template]/+page.server.ts`

**Interfaces:**
- Produces:
  - `type GameData = { title: string; subject?: string; [k: string]: unknown }`
  - `type FinishInput = { template: string; score: number; total: number; extraLine?: string; missed?: string[] }`
  - `GameShell` props: `{ title: string; subject: string; best: number | null; children }` — replaces the eight unchecked `el('...')` lookups in `games/game.js`

`GameShell` owns the scaffold every template currently duplicates: `.wrap`, `#app`, `.stats`, `.progress-outer`, `#done`, `#stars`, `#done-stats`, `#msg`, `<header>`. Roughly 450 duplicated lines collapse here.

- [ ] **Step 1: Write the engine module** — timer, progress, star calculation (`>=90%` → 3, `>=65%` → 2, else 1), shuffle, and the fire-and-forget result POST, now including `t` from the URL
- [ ] **Step 2: Write `GameShell.svelte`** with typed props
- [ ] **Step 3: Write the route** — `+page.server.ts` loads the game JSON via `readContent`, verifies the signature, and calls `getBest(student, dataId)` so the shell can show the personal best from the database instead of `localStorage`
- [ ] **Step 4: Commit**

```bash
git add src/lib/games src/routes/app/play
git commit -m "feat: add the typed games engine and shared shell"
```

---

### Task 20: Port the 12 game templates

**Files:**
- Create: `src/lib/games/{Memory,Quiz,Matching,Sequence,Sort,Table,Labelling,NumberLine,SpeedDrill,ErrorHunt,GraphMatch,TwoTruths}.svelte`

- [ ] **Step 1: Port the eleven that use the shared engine**

Each becomes a component receiving typed `GameData` and rendering inside `GameShell`. Per-template inline `<style>` becomes scoped styles.

- [ ] **Step 2: Port `memory.html` and reconcile its fork**

`memory.html` is 296 lines with 128 lines of inline CSS and does **not** load `game.js` — it reimplemented timing, scoring, and reporting. Diff its logic against `game.js` before porting. Where it diverges, decide deliberately: fold it back into the shared engine, or extend the engine to cover what it needed. Record the decision in the commit message.

- [ ] **Step 3: Preserve `number-line`'s touch handling**

`touch-action: none`, `pointerdown`/`pointermove`, and the `e.touches?.[0].clientX ?? e.clientX` fallback are what make it work on phones. Port them intact.

- [ ] **Step 4: Play every one of the 12 in a browser** against real data from `games/data/`, on a narrow viewport
- [ ] **Step 5: Commit**

```bash
git add src/lib/games
git commit -m "feat: port all 12 game templates to components"
```

---

### Task 21: Boot checks and the personal-best fix

**Files:**
- Modify: `src/lib/server/boot-checks.ts`
- Test: `tests/unit/boot-checks.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/unit/boot-checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('refuses to boot without SITE_URL', async () => {
  delete process.env.SITE_URL;
  const { checkEnv } = await import('../../src/lib/server/boot-checks.ts');
  assert.throws(() => checkEnv(), /SITE_URL/);
});
```

- [ ] **Step 2: Implement**

```ts
// src/lib/server/boot-checks.ts
import { execFileSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { env } from '$env/dynamic/private';
import { dataDir } from './content';

export function checkEnv(): void {
  for (const key of ['SITE_URL', 'ADMIN_PASSWORD', 'SESSION_SECRET']) {
    if (!env[key]) throw new Error(`${key} is not set — refusing to start`);
  }
}

export function runBootChecks(): void {
  checkEnv();

  try {
    accessSync(dataDir(), constants.W_OK);
  } catch {
    throw new Error(`DATA_DIR (${dataDir()}) is not writable — refusing to start`);
  }

  // Generation shells out to the claude CLI. A multi-stage build that drops it
  // fails only at the first real booking, which no test covers — so check here.
  try {
    execFileSync(env.CLAUDE_BIN ?? 'claude', ['--version'], { stdio: 'ignore' });
  } catch {
    console.error('WARNING: the claude CLI is not runnable — lesson generation will fail');
  }
}
```

`SITE_URL` throws because a wrong value leaks a server IP to parents. The `claude` check warns rather than throws, so the site still serves if only generation is broken.

- [ ] **Step 3: Run**

Run: `node --test tests/unit/boot-checks.test.mjs`
Expected: PASS.

- [ ] **Step 4: Wire the personal best into `SpeedDrill.svelte`**

Delete the `localStorage` read and write; take `best` from the `GameShell` prop fed by `getBest()` in Task 19.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/boot-checks.ts src/lib/games/SpeedDrill.svelte tests/unit/boot-checks.test.mjs
git commit -m "feat: add boot checks and read personal best from the database"
```

---

### Task 22: Multi-stage Dockerfile and compose

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Write the multi-stage Dockerfile**

**The `claude` CLI must be installed in the runtime stage.** Installing it only in the builder is the failure spec §11 warns about.

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Lesson generation spawns this binary (server/lesson-prep.mjs:411).
# It MUST be in the runtime stage — a build-stage-only install fails
# silently until the first real booking.
RUN npm install -g @anthropic-ai/claude-code@2.1.241

COPY --from=builder --chown=node:node /app/build ./build
COPY --chown=node:node static ./static

USER node
EXPOSE 3000
CMD ["node", "build/index.js"]
```

- [ ] **Step 2: Consolidate volumes**

Replace the five app-owned mounts with one `./data:/app/data`, and set `DATA_DIR=/app/data`. **Keep `./mea-beclick-kb/pricing:/app/mea-beclick-kb/pricing:ro` as its own read-only mount** — it is the tutor's externally-synced vault, not app state (spec §7). Add `ORIGIN`, `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host`.

- [ ] **Step 3: Update the Caddyfile** — `reverse_proxy app:3000`

- [ ] **Step 4: Build and run locally**

```bash
docker compose build && docker compose up -d
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
```
Expected: 200.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml server/Caddyfile
git commit -m "build: multi-stage image keeping the claude CLI in the runtime stage"
```

---

### Task 23: CI builds the image, VPS pulls it

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Build and push to GHCR on push to main**, tagged with the commit SHA and `latest`
- [ ] **Step 2: Run `npm test` and `npm run check` in CI before the build** — a broken build must fail in CI, not on the box serving users
- [ ] **Step 3: Update the VPS forced command**

The server-side forced command in `meabeclick`'s `~/.ssh/authorized_keys` changes from `git pull && docker compose up -d --build` to a pull-and-up. **This is a manual step on the VPS** and must be done before the first image-based deploy, or the deploy silently keeps building from git.

- [ ] **Step 4: Verify `/api/remind` has a trigger**

`vercel.json` is gone, so the Saturday cron that called it no longer exists. Confirm whether a systemd timer or cron on the VPS calls it. If nothing does, the endpoint is dead — say so rather than porting it silently.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: build the image in CI and push to GHCR"
```

---

### Task 24: Cutover verification and deleting the old app

**Files:**
- Delete: `server/app.mjs`, `server/auth.mjs`, `server/db.mjs`, `server/calendar.mjs`, `server/enroll.mjs`, `server/pricing.mjs`, `server/lesson-prep.mjs`, `server/lesson-queue.mjs`, `api/`, `pages/`, `games/*.html`, `games/game.js`, `games/game.css`
- Modify: `package.json` (drop `express`), `mea-beclick-kb/notes/Architecture Overview.md`

- [ ] **Step 1: Run the full suite against SvelteKit**

Run: `TARGET=sveltekit npm test`
Expected: green, with every difference traceable to an entry in `EXPECTED_CHANGES`.

- [ ] **Step 2: The generation smoke (spec §11)**

Run the built image with a real `CLAUDE_CODE_OAUTH_TOKEN` against a **copy** of prod data. Book a lesson. Verify the whole chain: `claude` resolves on PATH, the tmpdir is writable under `USER node`, `plan.json` is produced, slides render, game data lands in `DATA_DIR`, and the lesson record carries `{template, dataId}` rather than a baked URL. **This is the only check that covers the generation path.**

- [ ] **Step 3: Click-through checklist** — every page, all 12 games, and explicitly **a homework link opened from `/app/student`**, which is the only way a broken stored URL surfaces

- [ ] **Step 4: Regenerate `portal/noga.json`** into the new ref shape. No redirects; old links die (spec §8).

- [ ] **Step 5: Delete the old app and update the KB**

`mea-beclick-kb/notes/Architecture Overview.md` still describes two backend generations and asks which is deployed. Rewrite it to describe the single SvelteKit process.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove express, the vercel handlers and the vanilla pages"
```

---

## Self-Review

**Spec coverage.** §5 architecture → Tasks 6–11. §6 `/app/` boundary and PWA scope → Tasks 18, 19. §7 content plane → Task 12. §8 derived URLs → Tasks 10, 11, 24. §9 three bugs → Tasks 9 (SITE_URL), 13 (signatures), 21 (personal best). §10 boot checks → Task 21. §11 generation gate → Tasks 22, 24. §12 phases 0–9 → Tasks 1–24. §13 gates → Task 24. §12 phase 10 (store unification) → **deliberately deferred to Plan 3**, per the Plan Sequence table.

**Type consistency.** `GameRef` is defined in Task 10 and consumed in Tasks 11 and 19. `getBest` is defined in Task 7 and consumed in Tasks 19 and 21. `requireAuth(event)` is defined in Task 8 and consumed in Tasks 12, 13, 14, 18. `readContent` is defined in Task 12 and consumed in Task 19. `singleton` is defined in Task 7 and consumed in Tasks 7 and 11.

**Known thin spots**, called out rather than hidden: Tasks 17, 18, and 20 port roughly 3,100 lines of inline JS and CSS and are described by deliverable rather than line-by-line, because the port is mechanical but voluminous — the executor reads the source file and reproduces it. Task 15's `book()` body is shown as shape, not full text, for the same reason; `api/book.js` is the reference and every comment in it explains a decision worth preserving.
