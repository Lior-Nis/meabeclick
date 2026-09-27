# Design — Separate the landing site from the app under /app/

Status: approved, ready for implementation plan
Origin: Todoist MeaBeclick p1 — "Make it a PWA for the parents" (broken into
sub-projects; this is sub-project #1 of 4 — see §7)

## 1. Context

The task started as "make the parent dashboard installable as a PWA." Working
through it surfaced that the site has no boundary between the public
marketing/booking pages and the operational tool the tutor, parents, and
students actually use day to day — everything is a flat file under `pages/`
with ad hoc routing in `server/app.mjs`. That flat structure makes PWA scoping
awkward (a manifest `scope` needs a clean subtree) and mixes two very
different audiences under one routing scheme.

No bookings are currently flowing through the system — the site is in active
development/UX-redesign mode, with no real parents/students hitting these
URLs in production. That removes any backward-compatibility constraint: old
URLs can be retired outright, no redirects needed.

Investigation of the current routing (`server/app.mjs:217-256`) and pages
found four distinct access patterns, not two:

1. **Public marketing** — `index.html`, `booking.html`, `login.html`,
   `portal.html`. Always public, never installed as an app.
2. **Public one-off content links** — individual game pages
   (`games/error-hunt.html?d=<dataId>&s=<student>`, etc.) reached only via a
   direct link in a student's homework message, and portal JSON served
   through `/api/portal/:code`. Same access pattern as the portal: a link
   someone was given, not a destination someone navigates to. **Not part of
   the app boundary.**
3. **Tutor app** — `dashboard.html` (session-cookie gated via
   `requireAuth`, `server/auth.mjs`) and `games/index.html`, the games
   *catalog* (also `requireAuth`-gated — a tool for picking a template, not
   the games themselves).
4. **Parent/student app** — `parent-dashboard.html`, `student.html`. Both
   take a `?s=<code>` and a PIN (checked against `/api/portal/:code`,
   cached client-side in `localStorage`); no server session is issued today.

A prior spec (`docs/superpowers/specs/2026-08-22-file-organization-proposal.md`,
"Option C", executed 2026-08-23) already moved these 8 pages from the repo
root into `pages/` without changing their public URLs, and verified the move
by running the server on a scratch port and curling every route. This design
reuses that same verification discipline for the URL change this time.

## 2. Goals

1. A clean `/app/*` URL and file boundary covering exactly the tutor app and
   the parent/student app (categories 3 and 4 above) — nothing else.
2. `pages/app/` as the on-disk home for these four pages, mirroring the URL
   structure.
3. Existing auth mechanisms relocate unchanged: `requireAuth` (tutor cookie)
   still gates `/app/dashboard` and `/app/games`; the parent/student
   code+PIN check against `/api/portal/:code` is untouched.
4. Old flat routes (`/dashboard.html`, `/parent-dashboard.html`,
   `/student.html`, `/games`, `/games/index.html`) are removed outright.
5. A verification pass (scratch server + curl + manual click-through) proves
   every new route resolves correctly and every relative asset reference
   still loads, before this is considered done.

## 3. Non-goals

- **Parent/student session tokens, PIN rate-limiting, expiry** — real
  "best-practice login lifecycle" work, but a separate, security-sensitive
  change deserving its own design and testing pass. Sub-project #2.
- **PWA manifest, icons, service worker** — the actual "make it installable"
  work. Needs the `/app/` boundary from this design as its `scope`, and
  ideally a real parent/student session (#2) to resume into. Sub-project #3.
- **In-app navigation** — turning today's `target="_blank"` links between
  `dashboard.html` → `parent-dashboard.html`/games into same-tab in-app
  navigation. Cosmetic/UX layer on top of #1–#3. Sub-project #4.
- Redirects/back-compat for the old flat URLs — confirmed unnecessary; no
  live traffic depends on them.
- Any change to `games/` itself (the actual game templates, `game.css`,
  `game.js`, `registry.json`, `data/`) beyond fixing the catalog's own
  references after it moves out. The `dataPath` contract documented in the
  prior file-organization spec is untouched.

## 4. URL scheme

```
Landing (public, unchanged, no PWA scope):
  /                       → pages/index.html
  /booking.html           → pages/booking.html
  /login.html             → pages/login.html
  /portal.html            → pages/portal.html

App (new /app/ prefix):
  /app/dashboard          → pages/app/dashboard.html      (requireAuth)
  /app/games              → pages/app/games.html          (requireAuth)
  /app/parent?s=<code>    → pages/app/parent.html          (code+PIN, client-side)
  /app/student?s=<code>   → pages/app/student.html         (code+PIN, client-side)

Untouched (public, link-based, not "the app"):
  /games/<template>.html?d=<dataId>&s=<student>   → games/<template>.html
  /api/portal/:code                                → portal/<code>.json
```

## 5. File layout

```
pages/
  index.html, booking.html, login.html, portal.html, styles.css   ← unchanged
  app/
    dashboard.html    (was pages/dashboard.html)
    parent.html        (was pages/parent-dashboard.html)
    student.html        (was pages/student.html)
    games.html          (was games/index.html — catalog only)
games/
  error-hunt.html, memory.html, ... (all other templates)   ← unchanged
  game.css, game.js, registry.json, data/                    ← unchanged
```

Relative references that break on the move and must be fixed to
site-absolute paths. An initial pass of this design only checked `href=`/
`src=` attributes and missed several relative `fetch()` calls to the API;
a follow-up single-line `grep -n "fetch("` pass caught most of those but
still missed calls whose template-literal URL and options object sit on a
following line (`fetch(\n  ...)`) rather than the same line as `fetch(` —
Task 1's implementer caught one such case in `dashboard.html` by reading
the file directly rather than trusting the grep, and a subsequent
line-number-only `grep -n "fetch("` pass (not requiring the closing paren
on the same line) caught a second, more serious one in
`parent-dashboard.html`. Both are folded in below:

- `games.html` (was `games/index.html`): `href="game.css"` →
  `/games/game.css`; `fetch('./registry.json')` → `fetch('/games/registry.json')`;
  the constructed play-link `href="${url}"` needs a `/games/` prefix added
  since `url` values in `registry.json` are given relative to the old
  `games/` location.
- `dashboard.html`:
  - `href="index.html"` → `href="/"`
  - `href="parent-dashboard.html"` (tutor's "open parent portal" button,
    `target="_blank"`) → `href="/app/parent"`. Note: this link is already
    unparameterized in the current code (no `?s=` even though it sits in a
    per-student edit panel) — this move preserves that existing behavior
    exactly, it does not add parameterization. Fixing that is out of scope
    here; same-tab in-app nav is sub-project #4.
  - `fetch('./api/calendar-failures')` → `fetch('/api/calendar-failures')`
  - `` fetch(`./api/calendar-failures/${id}/resolve`) `` →
    `` fetch(`/api/calendar-failures/${id}/resolve`) ``
  - `addStudent()`'s multi-line call — `fetch('./api/students', {` (with
    `method: 'POST'` and the request body on following lines; a single-line
    grep for `fetch('./api/students'` misses this because the closing paren
    isn't on the same line) → `fetch('/api/students', {`
  - `fetch('./api/students', { cache: 'no-store' })` (the students-list
    load) → `fetch('/api/students', { cache: 'no-store' })`
  - `` fetch(`./api/students/${code}/regenerate`) `` →
    `` fetch(`/api/students/${code}/regenerate`) ``
  - (`/api/me`, `/api/lessons`, `/api/results` calls in the same file are
    already absolute — no change needed)
Both `student.html` and `parent-dashboard.html` also render three values
that come from `server/lesson-queue.mjs` (via the student's portal JSON)
directly as `href="..."`, with no leading slash added: `homework[].url` and
`games[].url` (`` `games/${template}.html?d=...` ``, from
`lesson-queue.mjs:127`) and `lessons[].slidesUrl`
(`` `lessons/${slug}/slides.html` ``, from `lesson-queue.mjs:131`) — both
written *without* a leading slash. This has been harmless up to now only
because these pages happened to live at the site root, where a relative
`games/x.html` and an absolute `/games/x.html` resolve identically; once
the page is a path segment under `/app/`, the two diverge and the relative
form breaks. `dashboard.html` already renders the same two values with a
leading slash added at render time (`href="/${esc(g.url)}"`,
`href="/${esc(l.slides)}"`, `server/app.mjs`-served, unaffected by this
move) — student.html and parent-dashboard.html do not follow that pattern
today and must be brought in line with it. This is a real, previously
unnoticed gap in this design's original file-by-file review (which checked
literal `href=`/`src=`/`fetch()` strings *inside* each page, not values a
page renders from external data) — found while implementing Task 2. The
fix stays scoped to the two render sites already being touched, matching
`dashboard.html`'s existing convention, rather than changing the data
format at its source (`server/lesson-queue.mjs`, a file outside this
sub-project's scope — see §9).

- `student.html`:
  - `href="./images/favicon.svg"` → `/images/favicon.svg`
  - `href="index.html"` → `href="/"`
  - `` fetch(`./api/portal/${encodeURIComponent(code)}...`) `` →
    `` fetch(`/api/portal/${encodeURIComponent(code)}...`) ``
  - `href="${esc(h.url)}"` (homework play link) → `href="/${esc(h.url)}"`
  - `href="${esc(l.slidesUrl)}"` (lesson slides link) →
    `href="/${esc(l.slidesUrl)}"`
  - `href="${esc(g.url)}"` (games section link) → `href="/${esc(g.url)}"`
- `parent-dashboard.html` (parent.html):
  - `fetch('./api/portal-students')` → `fetch('/api/portal-students')`
  - `fetchPortal(code, pin)`'s multi-line call —
    `` fetch(`./api/portal/${encodeURIComponent(code)}?kind=parent&pin=${encodeURIComponent(pin)}`, { cache: 'no-store' }) ``
    (the `` `./api/... ` `` template literal and its options object sit on
    the next line, so a single-line grep for `fetch(` misses it entirely —
    this is the core parent-login fetch, used by both `tryAutoLogin()` and
    the main unlock flow, and moving the page without fixing it would break
    every parent login) → `` fetch(`/api/portal/${encodeURIComponent(code)}?kind=parent&pin=${encodeURIComponent(pin)}`, { cache: 'no-store' }) ``
  - `href="${h.url}"` (homework play link) → `href="/${h.url}"`

## 6. Routing (`server/app.mjs`)

Replace the current scattered routes for these four pages
(`server/app.mjs:221`, `228-229`, `251-252`'s four filenames) with one
Express Router mounted at `/app`:

```js
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
```

`requireAuth`'s existing behavior (redirect to `/login.html` for page
requests, 401 JSON for `/api/*`) is unchanged — it's just applied at the new
path. `/app/parent` and `/app/student` get no server-side auth middleware,
exactly like today's `parent-dashboard.html`/`student.html` — identity is
still established client-side against `/api/portal/:code`.

`pages/login.html`'s post-login redirect (`location.href = '/dashboard.html'`)
updates to `/app/dashboard`.

The old individual routes and the four old filenames are deleted, not kept
as redirects (see Non-goals). `/games` and `/games/index.html` (the catalog's
old location) simply stop resolving — the `games/` static middleware
(`server/app.mjs:249`, unchanged) will 404 them like any other missing file,
since the catalog HTML no longer lives there. One caveat found during
implementation and confirmed intentional: the bare path `GET /games` (no
trailing slash) returns a 301 to `/games/` before that 404s, rather than a
direct 404 — this is generic Express `serve-static` directory-URL
canonicalization (confirmed identical on the unrelated, unchanged `/images`
mount), not a new compatibility redirect for a deprecated page URL, and it
still terminates in 404. Accepted as-is.

**Incoming links from other pages.** The original design only reviewed
relative references *inside* the four pages being moved — it missed that
two pages that are *not* moving link *into* them by their old paths. Found
during Task 5's review:

- `pages/index.html:40` — the sidebar's "לוח בקרה מורה" (teacher dashboard)
  link, `href="dashboard.html"`, always visible, no JS override → must
  become `href="/app/dashboard"`. This is the most serious of the four: a
  permanently broken primary navigation link for the tutor once the old
  route is removed.
- `pages/index.html:32` — the sidebar's "הדף שלי" (my page) link,
  `href="student.html"` by default, hidden unless a saved student slug
  exists in `localStorage`, in which case JS overwrites its `href` to
  `portal.html?s=...` before showing it (`pages/index.html:619`). The
  static fallback href is never actually reachable as-is, but should still
  be corrected to `href="/app/student"` for consistency.
- `pages/portal.html:97-98` — after a code+pin gate, JS sets
  `` el('link-student').href = `student.html?s=${...}` `` and
  `` el('link-parent').href = `parent-dashboard.html?s=${...}` `` — both
  live, clicked links in the actual parent/student entry flow. Must become
  `` `/app/student?s=${...}` `` and `` `/app/parent?s=${...}` ``
  respectively.

## 7. Relationship to the other sub-projects

This is #1 of 4, built in order because each depends on the one before it:

1. **This design** — `/app/` boundary (routing + file layout only).
2. **Parent/student session lifecycle** — real signed session tokens
   (mirroring `auth.mjs`'s existing tutor-cookie approach), PIN
   rate-limiting, expiry. Naturally belongs at the `/app/` boundary this
   design creates.
3. **PWA installability** — one shared manifest/icon identity across
   everything under `/app/`, service worker, per-entry-point `start_url`.
   Wants both the clean scope from #1 and a real session from #2.
4. **In-app navigation** — replace `target="_blank"` cross-links with
   same-tab navigation once there's a real app shell to navigate within.

Only #1 is designed and scoped here. #2–#4 get their own design pass when
their turn comes.

## 8. Testing / verification plan

Following the same discipline the prior file-move spec used:

1. Run `server/app.mjs` on a scratch port locally.
2. Curl every new route: `/app/dashboard` and `/app/games` unauthenticated
   (expect redirect/401 per `requireAuth`'s existing behavior), then with a
   valid session cookie (expect 200); `/app/parent?s=<code>` and
   `/app/student?s=<code>` (expect 200 — no server-side gate).
3. Curl the five old routes (`/dashboard.html`, `/parent-dashboard.html`,
   `/student.html`, `/games`, `/games/index.html`) and confirm they now 404.
4. Browser-driven check (headless, e.g. via the webapp-testing skill) of all
   four `/app/*` pages, watching the console for failed requests — catching
   relative-path/fetch breakage that curl alone wouldn't show (curl doesn't
   execute JS `fetch()` calls or load stylesheets):
   - `/app/dashboard`: loads lessons/results (`/api/lessons`, `/api/results`
     already absolute, sanity check only), opens the calendar-failures panel
     (`/api/calendar-failures`), and the students panel including a
     regenerate click (`/api/students`, `/api/students/:code/regenerate`)
   - `/app/games`: catalog loads (`/games/registry.json`, `/games/game.css`),
     a play link opens the correct `/games/<template>.html` URL
   - `/app/parent?s=<code>`: student picker loads (`/api/portal-students`),
     PIN unlock flow, homework play links resolve
   - `/app/student?s=<code>`: favicon loads, portal fetch
     (`/api/portal/:code`) succeeds, homework play links resolve
   - `/` (index.html): the "לוח בקרה מורה" sidebar link resolves to
     `/app/dashboard`
   - `/portal.html?s=<code>`: after the pin gate, both generated links
     resolve to `/app/student?s=<code>` and `/app/parent?s=<code>`
5. Only then commit and consider this sub-project done.

## 9. Open items carried forward (not blocking this work)

- Sub-projects #2–#4 (§7) — each needs its own design when its turn comes.
- The Todoist p1 item "decide: does the booking form need real-time phone
  validation" and other unrelated backlog items are untouched by this work.
- `server/lesson-queue.mjs` emits `games[].url`, `homework[].url`, and
  `lessons[].slidesUrl` as paths relative to the site root (no leading
  slash), and consuming pages are expected to add the slash themselves at
  render time (see §5). That convention is easy to get wrong (two of three
  consumers didn't follow it) and worth revisiting — either documenting it
  clearly at the source or just emitting absolute paths there instead — but
  changing `server/lesson-queue.mjs` is outside this sub-project's scope
  (it touches lesson generation, not the app/landing boundary), so it's
  flagged here rather than fixed.
