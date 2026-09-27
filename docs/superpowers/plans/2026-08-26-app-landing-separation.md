# App/Landing Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tutor dashboard, games catalog, parent dashboard, and student page under a new `/app/` URL and file boundary, separate from the public marketing/booking site — with zero behavior change beyond the URL/file move itself.

**Architecture:** Four HTML pages move from their current flat locations into `pages/app/`, with their relative asset/API references rewritten to absolute paths (the move breaks relative resolution). `server/app.mjs` gets a new `express.Router()` mounted at `/app` replacing the old scattered routes; old routes are deleted outright (no redirects — confirmed no live traffic depends on them).

**Tech Stack:** Plain Node/Express (`.mjs`, ESM), static HTML/CSS/vanilla JS pages, SQLite via `node:sqlite`. No test framework in this repo — verification is grep-based content assertions plus live curl/browser checks against a scratch server instance, matching the prior file-move spec's methodology.

**Spec:** `docs/superpowers/specs/2026-08-26-app-landing-separation-design.md`

## Global Constraints

- No redirects for the five old routes (`/dashboard.html`, `/parent-dashboard.html`, `/student.html`, `/games`, `/games/index.html`) — they must 404 after this work, not redirect. Exception, confirmed intentional: bare `GET /games` (no trailing slash) 301s to `/games/` before that 404s — this is generic Express `serve-static` directory-canonicalization plumbing (identical behavior on the unrelated, unchanged `/images` mount), not a new compatibility redirect, and it still terminates in 404. (Spec §2.4, §6)
- `requireAuth` (the existing tutor session-cookie middleware, `server/auth.mjs`) must gate `/app/dashboard` and `/app/games` exactly as it gated the old routes — same behavior, new path only. (Spec §2.3, §6)
- `/app/parent` and `/app/student` get **no** server-side auth middleware — identity stays client-side (code+PIN against `/api/portal/:code`), unchanged from today. Do not add session logic here — that's a separate future sub-project. (Spec §2.3, §3)
- `games/` (the actual game template files, `game.css`, `game.js`, `registry.json`, `data/`) is not touched except for the one file leaving it (`index.html` → `pages/app/games.html`). (Spec §3, §5)
- Every relative `href=`/`src=`/`fetch()` reference must become a site-absolute path (`/...`) — including calls whose URL/options span multiple lines (a same-line-anchored grep misses these; use a substring search instead) and href values built from external data (e.g. `h.url`, `g.url`, `l.slidesUrl` from `server/lesson-queue.mjs`, which are written slash-less by convention — the fix is a single `/` prepended at the render site, never a change to the underlying data; double-prepending produces a protocol-relative `//...` URL bug). Do not add new parameters or behavior while fixing these (e.g. the parent-portal link stays unparameterized, matching current behavior). (Spec §5)
- Pages that are *not* moving but link *into* the four that are must also be updated (`pages/index.html`, `pages/portal.html`) — the original audit only checked references *inside* the moved pages and missed these. (Spec §6)

---

## Task 1: Move and fix `dashboard.html`

**Files:**
- Create: `pages/app/dashboard.html` (moved from `pages/dashboard.html`)
- Delete: `pages/dashboard.html`

**Interfaces:**
- Produces: a file at `pages/app/dashboard.html`, self-contained, with all internal references site-absolute. Task 5 will wire `GET /app/dashboard` to serve this exact path.

- [ ] **Step 1: Move the file**

```bash
mkdir -p pages/app
git mv pages/dashboard.html pages/app/dashboard.html
```

- [ ] **Step 2: Fix the "back to site" link**

In `pages/app/dashboard.html`:

```html
    <a href="index.html" class="btn btn-ghost">← האתר</a>
```
→
```html
    <a href="/" class="btn btn-ghost">← האתר</a>
```

- [ ] **Step 3: Fix the "open parent portal" link**

```html
            <a href="parent-dashboard.html" target="_blank" class="btn btn-outline btn-sm" style="text-align:center;text-decoration:none">
```
→
```html
            <a href="/app/parent" target="_blank" class="btn btn-outline btn-sm" style="text-align:center;text-decoration:none">
```

(No `?s=` added — this link has no student parameter today even though it sits in a per-student panel; this move preserves that exactly.)

- [ ] **Step 4: Fix the calendar-failures fetch calls**

```js
    const r = await fetch('./api/calendar-failures');
```
→
```js
    const r = await fetch('/api/calendar-failures');
```

```js
  await fetch(`./api/calendar-failures/${id}/resolve`, { method: 'POST' }).catch(() => {});
```
→
```js
  await fetch(`/api/calendar-failures/${id}/resolve`, { method: 'POST' }).catch(() => {});
```

- [ ] **Step 5: Fix the students fetch calls**

```js
    const r = await fetch('./api/students', { cache: 'no-store' });
```
→
```js
    const r = await fetch('/api/students', { cache: 'no-store' });
```

```js
  const r = await fetch(`./api/students/${code}/regenerate`, { method: 'POST' });
```
→
```js
  const r = await fetch(`/api/students/${code}/regenerate`, { method: 'POST' });
```

- [ ] **Step 6: Verify no relative references remain**

Run:
```bash
grep -n 'href="index\.html"\|href="parent-dashboard\.html"\|fetch(.\./api' pages/app/dashboard.html
```
Expected: no output (exit code 1).

Run:
```bash
grep -c 'href="/"' pages/app/dashboard.html
grep -c 'href="/app/parent"' pages/app/dashboard.html
grep -c "fetch('/api/calendar-failures')" pages/app/dashboard.html
grep -c 'calendar-failures/\${id}/resolve' pages/app/dashboard.html
grep -c "fetch('/api/students'" pages/app/dashboard.html
grep -c 'students/\${code}/regenerate' pages/app/dashboard.html
```
Expected: each prints `1`.

- [ ] **Step 7: Commit**

```bash
git add pages/app/dashboard.html
git commit -m "Move dashboard.html to pages/app/, fix relative refs to absolute"
```

---

## Task 2: Move and fix `parent-dashboard.html`

**Files:**
- Create: `pages/app/parent.html` (moved from `pages/parent-dashboard.html`)
- Delete: `pages/parent-dashboard.html`

**Interfaces:**
- Produces: a file at `pages/app/parent.html`. Task 5 wires `GET /app/parent` to serve it.

- [ ] **Step 1: Move the file**

```bash
mkdir -p pages/app
git mv pages/parent-dashboard.html pages/app/parent.html
```

- [ ] **Step 2: Fix the students-picker fetch**

```js
    const r = await fetch('./api/portal-students', { cache: 'no-store' });
```
→
```js
    const r = await fetch('/api/portal-students', { cache: 'no-store' });
```

- [ ] **Step 3: Fix `fetchPortal()`'s multi-line relative fetch call**

This is the core parent-login fetch — used by both `tryAutoLogin()` and the
main unlock flow. Its URL and options object sit on the lines *after*
`fetch(`, which is why a single-line `grep` for `fetch('./api` would miss
it entirely:

```js
async function fetchPortal(code, pin) {
  const r = await fetch(
    `./api/portal/${encodeURIComponent(code)}?kind=parent&pin=${encodeURIComponent(pin)}`,
    { cache: 'no-store' });
```
→
```js
async function fetchPortal(code, pin) {
  const r = await fetch(
    `/api/portal/${encodeURIComponent(code)}?kind=parent&pin=${encodeURIComponent(pin)}`,
    { cache: 'no-store' });
```

- [ ] **Step 4: Fix the homework play link**

`h.url` comes from `server/lesson-queue.mjs` (via the student's portal
JSON) as a path relative to the site root (`games/<template>.html?...`,
no leading slash) — harmless while this page lived at the site root, but
broken once it's a path segment under `/app/`. `dashboard.html` already
prepends `/` for the equivalent value; bring this page in line with that:

```js
        ? `<a class="hw-play" href="${h.url}" target="_blank" rel="noopener">🎮 שחקו</a>`
```
→
```js
        ? `<a class="hw-play" href="/${h.url}" target="_blank" rel="noopener">🎮 שחקו</a>`
```

- [ ] **Step 5: Verify no relative references remain**

Use a substring search (not anchored to `fetch(` on the same line — the
call fixed in Step 3 spans multiple lines, so a same-line-anchored pattern
would silently miss a leftover):

```bash
grep -n "'\./api\|\`\./api\|href=\"\./" pages/app/parent.html
```
Expected: no output.

Run:
```bash
grep -c "fetch('/api/portal-students'" pages/app/parent.html
grep -c '`/api/portal/\${encodeURIComponent(code)}' pages/app/parent.html
grep -c 'href="/\${h.url}"' pages/app/parent.html
```
Expected: each prints `1`.

- [ ] **Step 6: Commit**

```bash
git add pages/app/parent.html
git commit -m "Move parent-dashboard.html to pages/app/parent.html, fix relative fetch and homework link"
```

---

## Task 3: Move and fix `student.html`

**Files:**
- Create: `pages/app/student.html` (moved from `pages/student.html`)
- Delete: `pages/student.html`

**Interfaces:**
- Produces: a file at `pages/app/student.html`. Task 5 wires `GET /app/student` to serve it.

- [ ] **Step 1: Move the file**

```bash
mkdir -p pages/app
git mv pages/student.html pages/app/student.html
```

- [ ] **Step 2: Fix the favicon link**

```html
<link rel="icon" type="image/svg+xml" href="./images/favicon.svg">
```
→
```html
<link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
```

- [ ] **Step 3: Fix the "back to site" link**

```html
    + '<a href="index.html" style="background:#2563EB;color:#fff;padding:10px 20px;'
```
→
```html
    + '<a href="/" style="background:#2563EB;color:#fff;padding:10px 20px;'
```

- [ ] **Step 4: Fix the portal fetch**

```js
    const r = await fetch(`./api/portal/${encodeURIComponent(code)}?pin=${encodeURIComponent(pin)}`);
```
→
```js
    const r = await fetch(`/api/portal/${encodeURIComponent(code)}?pin=${encodeURIComponent(pin)}`);
```

- [ ] **Step 5: Fix the homework, slides, and games links**

All three values come from `server/lesson-queue.mjs` (via the student's
portal JSON) as paths relative to the site root (no leading slash) —
harmless while this page lived at the site root, but broken once it's a
path segment under `/app/`. `dashboard.html` already prepends `/` for the
equivalent values; bring this page in line with that:

```js
          ${h.url ? `<a class="play" href="${esc(h.url)}">🎮 ${h.done ? 'לשחק שוב' : 'התחילו'}</a>` : ''}
```
→
```js
          ${h.url ? `<a class="play" href="/${esc(h.url)}">🎮 ${h.done ? 'לשחק שוב' : 'התחילו'}</a>` : ''}
```

```js
      ${l.slidesUrl ? `<a class="play" href="${esc(l.slidesUrl)}">📊 המצגת</a>` : ''}
```
→
```js
      ${l.slidesUrl ? `<a class="play" href="/${esc(l.slidesUrl)}">📊 המצגת</a>` : ''}
```

```js
      <a class="play" href="${esc(g.url)}">שחקו עכשיו ←</a>
```
→
```js
      <a class="play" href="/${esc(g.url)}">שחקו עכשיו ←</a>
```

- [ ] **Step 6: Verify no relative references remain**

Run:
```bash
grep -n "href=\"\./images\|href=\"index\.html\"\|'\./api\|\`\./api" pages/app/student.html
```
Expected: no output.

Run:
```bash
grep -c 'href="/images/favicon.svg"' pages/app/student.html
grep -c 'href="/" style' pages/app/student.html
grep -c 'fetch(`/api/portal/' pages/app/student.html
grep -c 'href="/\${esc(h.url)}"' pages/app/student.html
grep -c 'href="/\${esc(l.slidesUrl)}"' pages/app/student.html
grep -c 'href="/\${esc(g.url)}"' pages/app/student.html
```
Expected: each prints `1`.

- [ ] **Step 7: Commit**

```bash
git add pages/app/student.html
git commit -m "Move student.html to pages/app/, fix relative refs to absolute"
```

---

## Task 4: Move and fix the games catalog (`games/index.html` → `pages/app/games.html`)

**Files:**
- Create: `pages/app/games.html` (moved from `games/index.html`)
- Delete: `games/index.html`

**Interfaces:**
- Produces: a file at `pages/app/games.html`. Task 5 wires `GET /app/games` to serve it.
- Consumes: `games/game.css`, `games/registry.json` (both stay in place, unchanged — only referenced by absolute path now).

- [ ] **Step 1: Move the file**

```bash
mkdir -p pages/app
git mv games/index.html pages/app/games.html
```

- [ ] **Step 2: Fix the stylesheet link**

```html
<link rel="stylesheet" href="game.css">
```
→
```html
<link rel="stylesheet" href="/games/game.css">
```

- [ ] **Step 3: Fix the registry fetch**

```js
fetch('./registry.json')
```
→
```js
fetch('/games/registry.json')
```

- [ ] **Step 4: Fix the play link (leave the `<code>` label text untouched)**

```html
        ${url ? `<div style="margin-top:.7rem"><a class="play" href="${url}">▶ נסו את הדוגמה</a><code class="url">games/${url}</code></div>` : ''}
```
→
```html
        ${url ? `<div style="margin-top:.7rem"><a class="play" href="/games/${url}">▶ נסו את הדוגמה</a><code class="url">games/${url}</code></div>` : ''}
```

- [ ] **Step 5: Verify no relative references remain**

Run:
```bash
grep -n "href=\"game\.css\"\|'\./registry\|href=\"\${url}\"" pages/app/games.html
```
Expected: no output.

Run:
```bash
grep -c 'href="/games/game.css"' pages/app/games.html
grep -c "fetch('/games/registry.json')" pages/app/games.html
grep -c 'href="/games/\${url}"' pages/app/games.html
```
Expected: each prints `1`.

- [ ] **Step 6: Commit**

```bash
git add pages/app/games.html
git commit -m "Move games catalog to pages/app/games.html, fix relative refs to absolute"
```

---

## Task 5: Rewire `server/app.mjs` routing and fix the login redirect

**Files:**
- Modify: `server/app.mjs:217-254`
- Modify: `pages/login.html:60`

**Interfaces:**
- Consumes: `pages/app/dashboard.html`, `pages/app/parent.html`, `pages/app/student.html`, `pages/app/games.html` (from Tasks 1-4 — must already exist on disk).
- Produces: live routes `GET /app/dashboard`, `GET /app/games` (both `requireAuth`-gated), `GET /app/parent`, `GET /app/student` (ungated). Old routes (`/dashboard.html`, `/parent-dashboard.html`, `/student.html`, `/games`, `/games/`, `/games/index.html`) no longer exist and fall through to the catch-all 404.

- [ ] **Step 1: Replace the static-site routing block**

In `server/app.mjs`, replace this entire block:

```js
/* ── Static site ──────────────────────────────────────────────── */

// The tutor dashboard is behind the session, so it is served before the
// static middleware that would otherwise hand it out to anyone.
app.get('/dashboard.html', requireAuth, (_req, res) => res.sendFile(join(SITE, 'pages', 'dashboard.html')));

// Students' lesson material must never be web-served (it was public on Vercel).
app.use(['/Students', '/students'], (_req, res) => res.status(404).end());

/* The games catalog is a tutor tool for picking a template — students reach a
   game through the direct link in their homework, never through a menu. */
app.get(['/games', '/games/', '/games/index.html'], requireAuth,
  (_req, res) => res.sendFile(join(SITE, 'games', 'index.html')));

// Portal files now go out through /api/portal/:code, which checks the pin.
// Left static, the pin would be theatre — anyone could read the file directly.
app.use('/portal', (_req, res) => res.status(404).end());

// Unreviewed generated lessons. Visible to the tutor once logged in, never to
// the public — material goes out under her name, so she approves it first.
app.use('/drafts', requireAuth, express.static(join(SITE, 'drafts')));

/* Serving the whole repo root let anyone download the server's source code,
   private pricing notes, and unrelated content that happens to sit in this
   checkout — the same mistake /Students had, just not yet noticed here. Only
   what a page actually links to is public; everything else 404s below. */
const staticOpts = {
  setHeaders: (res, path) => {
    if (path.endsWith('.json')) res.set('Cache-Control', 'no-store');
  },
};
for (const dir of ['images', 'games', 'lessons']) {
  app.use(`/${dir}`, express.static(join(SITE, dir), staticOpts));
}
for (const file of ['booking.html', 'login.html', 'student.html', 'parent-dashboard.html', 'portal.html', 'styles.css']) {
  app.get(`/${file}`, (_req, res) => res.sendFile(join(SITE, 'pages', file), staticOpts));
}
app.get(['/', '/index.html'], (_req, res) => res.sendFile(join(SITE, 'pages', 'index.html'), staticOpts));
```

with:

```js
/* ── Static site ──────────────────────────────────────────────── */

// Students' lesson material must never be web-served (it was public on Vercel).
app.use(['/Students', '/students'], (_req, res) => res.status(404).end());

// Portal files now go out through /api/portal/:code, which checks the pin.
// Left static, the pin would be theatre — anyone could read the file directly.
app.use('/portal', (_req, res) => res.status(404).end());

// Unreviewed generated lessons. Visible to the tutor once logged in, never to
// the public — material goes out under her name, so she approves it first.
app.use('/drafts', requireAuth, express.static(join(SITE, 'drafts')));

/* The app: tutor dashboard and games catalog are session-gated (requireAuth);
   parent/student pages check a code+pin client-side against
   /api/portal/:code instead of a server session. Everything not under here
   (marketing/booking pages, individual game-play links reached from a
   homework message) is public and outside the app boundary. */
const appRouter = express.Router();
appRouter.get('/dashboard', requireAuth, (_req, res) =>
  res.sendFile(join(SITE, 'pages', 'app', 'dashboard.html')));
appRouter.get('/games', requireAuth, (_req, res) =>
  res.sendFile(join(SITE, 'pages', 'app', 'games.html')));
appRouter.get('/parent', (_req, res) =>
  res.sendFile(join(SITE, 'pages', 'app', 'parent.html')));
appRouter.get('/student', (_req, res) =>
  res.sendFile(join(SITE, 'pages', 'app', 'student.html')));
app.use('/app', appRouter);

/* Serving the whole repo root let anyone download the server's source code,
   private pricing notes, and unrelated content that happens to sit in this
   checkout — the same mistake /Students had, just not yet noticed here. Only
   what a page actually links to is public; everything else 404s below. */
const staticOpts = {
  setHeaders: (res, path) => {
    if (path.endsWith('.json')) res.set('Cache-Control', 'no-store');
  },
};
for (const dir of ['images', 'games', 'lessons']) {
  app.use(`/${dir}`, express.static(join(SITE, dir), staticOpts));
}
for (const file of ['booking.html', 'login.html', 'portal.html', 'styles.css']) {
  app.get(`/${file}`, (_req, res) => res.sendFile(join(SITE, 'pages', file), staticOpts));
}
app.get(['/', '/index.html'], (_req, res) => res.sendFile(join(SITE, 'pages', 'index.html'), staticOpts));
```

- [ ] **Step 2: Fix the login redirect**

In `pages/login.html`:

```js
    if (r.ok) { location.href = '/dashboard.html'; return; }
```
→
```js
    if (r.ok) { location.href = '/app/dashboard'; return; }
```

- [ ] **Step 3: Syntax-check the server file**

Run:
```bash
node --check server/app.mjs
```
Expected: no output, exit code 0.

- [ ] **Step 4: Live route smoke test on a scratch server**

Run:
```bash
DB_PATH=/tmp/app-sep-scratch.db ADMIN_PASSWORD=test-pw SESSION_SECRET=test-secret PORT=8099 node server/app.mjs &
sleep 1

# Old routes must now 404:
for path in /dashboard.html /parent-dashboard.html /student.html /games /games/index.html; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8099$path")
  echo "$path -> $code"
done

# New unauthenticated app routes:
curl -s -o /dev/null -w 'GET /app/dashboard (no auth) -> %{http_code}\n' http://localhost:8099/app/dashboard
curl -s -o /dev/null -w 'GET /app/games (no auth) -> %{http_code}\n' http://localhost:8099/app/games
curl -s -o /dev/null -w 'GET /app/parent -> %{http_code}\n' http://localhost:8099/app/parent
curl -s -o /dev/null -w 'GET /app/student -> %{http_code}\n' http://localhost:8099/app/student

# Log in, then re-check the gated routes with a session cookie:
curl -s -c /tmp/app-sep-cookie.txt -X POST http://localhost:8099/api/login \
  -H 'Content-Type: application/json' -d '{"password":"test-pw"}' -o /dev/null
curl -s -b /tmp/app-sep-cookie.txt -o /dev/null -w 'GET /app/dashboard (auth) -> %{http_code}\n' http://localhost:8099/app/dashboard
curl -s -b /tmp/app-sep-cookie.txt -o /dev/null -w 'GET /app/games (auth) -> %{http_code}\n' http://localhost:8099/app/games

kill %1
rm -f /tmp/app-sep-scratch.db /tmp/app-sep-cookie.txt
```

Expected:
- All five old routes: `404`
- `/app/dashboard` and `/app/games` without auth: `302` (redirect to `/login.html`, per `requireAuth`'s existing page-request behavior)
- `/app/parent` and `/app/student`: `200`
- `/app/dashboard` and `/app/games` with the session cookie: `200`

- [ ] **Step 5: Commit**

```bash
git add server/app.mjs pages/login.html
git commit -m "Route the app under /app/, remove old flat routes, fix login redirect"
```

---

## Task 6: Fix incoming links from `index.html` and `portal.html`

**Files:**
- Modify: `pages/index.html:32,40`
- Modify: `pages/portal.html:97-98`

**Interfaces:**
- Consumes: the `/app/dashboard`, `/app/student`, `/app/parent` routes from Task 5.

Tasks 1-4 fixed references *inside* the four moved pages; this task fixes
two pages that are not moving but link *into* them by their old, now-dead
paths. `pages/index.html:40`'s "לוח בקרה מורה" (teacher dashboard) link is
always visible with no JS override — the most serious of the four, since it
would otherwise be a permanently broken primary navigation link.
`pages/portal.html:97-98`'s two links are live, clicked links in the actual
parent/student entry flow (set by JS after a code+pin gate). `index.html`'s
"הדף שלי" link is hidden by default and JS always overwrites its `href`
before ever showing it — the static fallback is unreachable as-is, but
still worth correcting for consistency.

- [ ] **Step 1: Fix the always-visible teacher-dashboard link**

In `pages/index.html`:

```html
      <a href="dashboard.html" class="sidebar-btn" style="text-decoration:none;display:block;text-align:right;">🖥️ לוח בקרה מורה</a>
```
→
```html
      <a href="/app/dashboard" class="sidebar-btn" style="text-decoration:none;display:block;text-align:right;">🖥️ לוח בקרה מורה</a>
```

- [ ] **Step 2: Fix the "my page" link's static fallback**

In `pages/index.html`:

```html
      <a href="student.html" id="myPageLink" class="sidebar-btn" style="text-decoration:none;display:none;text-align:right;">🎒 הדף שלי</a>
```
→
```html
      <a href="/app/student" id="myPageLink" class="sidebar-btn" style="text-decoration:none;display:none;text-align:right;">🎒 הדף שלי</a>
```

Leave the JS at `pages/index.html:619` (`myPage.href = 'portal.html?s=' + ...`) untouched — it already points at a page unaffected by this sub-project and is out of scope here.

- [ ] **Step 3: Fix the portal gate's two generated links**

In `pages/portal.html`:

```js
  el('link-student').href = `student.html?s=${encodeURIComponent(code)}`;
  el('link-parent').href  = `parent-dashboard.html?s=${encodeURIComponent(code)}`;
```
→
```js
  el('link-student').href = `/app/student?s=${encodeURIComponent(code)}`;
  el('link-parent').href  = `/app/parent?s=${encodeURIComponent(code)}`;
```

- [ ] **Step 4: Verify**

Run:
```bash
grep -n 'href="dashboard\.html"\|href="student\.html"\|`student\.html?s=\|`parent-dashboard\.html?s=' pages/index.html pages/portal.html
```
Expected: no output.

Run:
```bash
grep -c 'href="/app/dashboard"' pages/index.html
grep -c 'href="/app/student"' pages/index.html
grep -c '`/app/student?s=' pages/portal.html
grep -c '`/app/parent?s=' pages/portal.html
```
Expected: each prints `1`.

- [ ] **Step 5: Commit**

```bash
git add pages/index.html pages/portal.html
git commit -m "Fix index.html and portal.html links to the four moved pages' new /app/ paths"
```

---

## Task 7: End-to-end verification (headless browser)

**Files:** none (verification only, no code changes expected — if this task finds a bug, fix it here and note the fix in the commit).

**Interfaces:**
- Consumes: the fully wired app from Tasks 1-6.

- [ ] **Step 1: Start a scratch server**

```bash
DB_PATH=/tmp/app-sep-e2e.db ADMIN_PASSWORD=test-pw SESSION_SECRET=test-secret PORT=8099 node server/app.mjs &
sleep 1
```

- [ ] **Step 2: Seed one test student for the parent/student checks**

`checkPin` (`server/db.mjs:337`) checks a single `password` column shared by
both the parent and student portal views — there's no separate PIN to look
up. `/api/portal/:code` additionally requires a `portal/<code>.json` file to
exist (normally written by `server/enroll.mjs` on a booking's first lesson;
there's no booking flow running here, so write one directly):

```bash
curl -s -c /tmp/app-sep-cookie.txt -X POST http://localhost:8099/api/login \
  -H 'Content-Type: application/json' -d '{"password":"test-pw"}' -o /dev/null

curl -s -b /tmp/app-sep-cookie.txt -X POST http://localhost:8099/api/students \
  -H 'Content-Type: application/json' \
  -d '{"code":"e2e-test","name":"בדיקה","subject":"מתמטיקה","password":"4321"}'

mkdir -p portal
cat > portal/e2e-test.json <<'JSON'
{
  "name": "בדיקה",
  "emoji": "🎓",
  "subject": "מתמטיקה",
  "level": "",
  "tutor": "ניקול",
  "tutorPhone": "972546969891",
  "updated": "2026-08-26",
  "nextLesson": null,
  "progress": 0,
  "progressNote": "",
  "lessons": [{"date": "2026-08-26", "topic": "test", "summary": "", "slidesUrl": "lessons/e2e-test-demo/slides.html"}],
  "homework": [{"url": "games/error-hunt.html?d=e2e-test-demo", "done": false}],
  "games": []
}
JSON
```

Note: `homework[].url` and `lessons[].slidesUrl` are written **without** a
leading slash — matching the real format `server/lesson-queue.mjs` produces
(see spec §5). This is deliberate: it's what actually exercises the
render-time `/${...}` fix Tasks 2 and 3 applied. If either value here
started with a slash instead, the fixed render code would double-slash it
(`href="//games/..."`) and the check below would wrongly appear to pass on
a page that's actually broken for real data.

Use `code=e2e-test`, `password=4321` in Steps 5-6 below (both the parent and
student view unlock with the same password, per `checkPin`'s behavior above).

- [ ] **Step 3: Browser-driven check of `/app/dashboard`**

Using the webapp-testing skill (Playwright), navigate to `http://localhost:8099/app/dashboard` after establishing the session cookie, and confirm via the browser console / network log:
- No failed (4xx/5xx) requests on page load
- The calendar-failures panel loads without a console error (exercises the fixed `/api/calendar-failures` call)
- The students panel loads (exercises the fixed `/api/students` call) and, if a test student exists, clicking "regenerate password" succeeds (exercises `/api/students/:code/regenerate`)
- The "open parent portal" link's `href` is `/app/parent`

- [ ] **Step 4: Browser-driven check of `/app/games`**

Navigate to `http://localhost:8099/app/games` (with the session cookie) and confirm:
- No failed requests (exercises `/games/registry.json`, `/games/game.css`)
- At least one "▶ נסו את הדוגמה" play link is present with an `href` starting with `/games/`

- [ ] **Step 5: Browser-driven check of `/app/parent?s=e2e-test`**

Navigate to `http://localhost:8099/app/parent?s=e2e-test` and confirm:
- Without a code, `/app/parent` (no query) loads the student picker
  (`/api/portal-students`) without a console error
- With `?s=e2e-test` and PIN `4321` entered, the dashboard unlocks and the
  seeded homework "play" link's rendered `href` is exactly
  `/games/error-hunt.html?d=e2e-test-demo` (one leading slash — confirms
  the Task 2 render-time fix applied and did not double-slash) and the
  link resolves (200, not 404 — the game's own internal data fetch failing
  on the nonexistent `e2e-test-demo` data file is expected and irrelevant
  here; only the page route itself is under test)

- [ ] **Step 6: Browser-driven check of `/app/student?s=e2e-test`**

Navigate to `http://localhost:8099/app/student?s=e2e-test` and confirm:
- The favicon request (`/images/favicon.svg`) succeeds
- The portal fetch (`/api/portal/e2e-test?pin=4321`) succeeds once PIN
  `4321` is entered
- The homework play link's rendered `href` is exactly
  `/games/error-hunt.html?d=e2e-test-demo` (one leading slash, not two) and
  resolves (same 200-on-the-route caveat as Step 5)
- The lesson's slides link resolves to `/lessons/e2e-test-demo/slides.html`
  (one leading slash) — a 404 here is expected and fine (no such lesson
  file was generated), the check is only that the URL has exactly one
  leading slash, confirming the Task 3 render-time fix applied

- [ ] **Step 7: Browser-driven check of `/` and `/portal.html?s=e2e-test`**

Navigate to `http://localhost:8099/` and confirm:
- The sidebar's "לוח בקרה מורה" link's `href` is `/app/dashboard`

Navigate to `http://localhost:8099/portal.html?s=e2e-test`, enter PIN `4321`
at the gate, and confirm:
- The two generated links resolve to `/app/student?s=e2e-test` and
  `/app/parent?s=e2e-test` (not the old `student.html`/`parent-dashboard.html`
  paths)

- [ ] **Step 8: Clean up**

```bash
curl -s -b /tmp/app-sep-cookie.txt -X DELETE http://localhost:8099/api/students/e2e-test -o /dev/null
rm -f portal/e2e-test.json
kill %1
rm -f /tmp/app-sep-e2e.db /tmp/app-sep-cookie.txt
```

- [ ] **Step 9: Final commit (only if Step 2-7 surfaced a fix)**

If any check in Steps 3-7 failed and required a code fix, stage and commit that fix now with a message describing exactly what was broken and how it was found. If everything passed with no changes needed, there is nothing to commit for this task — the commits from Tasks 1-6 already represent the complete, verified change.
