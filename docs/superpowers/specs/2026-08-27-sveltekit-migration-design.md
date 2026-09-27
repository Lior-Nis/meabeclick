# Design — Migrate to SvelteKit (full absorption)

Status: awaiting review, then implementation plan
Origin: Todoist MeaBeclick p3 `6hMrqpvv4vv3wCqq` — "לעבור לפריימוורק אמיתי
(Astro/SvelteKit) במקום HTML/JS ואנילי"

## 1. Context

The task asks to replace vanilla HTML/JS + Express with a real framework,
citing bugs from the app/landing separation — broken relative paths and
duplicated markup — as evidence that no build step and no shared components
is costing real defects.

Investigation confirmed the diagnosis and found it understated.

**There is essentially no shared frontend.** `pages/styles.css` is 1,933
lines and is loaded by exactly one page, `index.html`. The other six pages
each carry their own inline `<style>` (23–465 lines) and inline `<script>`
(25–766 lines). This is not "some duplicated HTML between pages"; the pages
share nothing.

**The games duplicate a full page scaffold twelve times.** All 12 templates
in `games/` repeat identical lines — doctype, `<html lang="he" dir="rtl">`,
both font preconnects, the Google Fonts link, `.wrap`, `#app`, `.stats`,
`.progress-outer`, `#done`, `#stars`, `#done-stats`, `#msg`, `<header>` —
roughly 450 lines of duplicated markup, plus a per-template inline `<style>`
of 4–128 lines. `game.js` and `game.css` being shared hid this.

**The drift this permits has already happened.** `games/memory.html` is 296
lines with 128 lines of inline CSS and does not load `game.js` at all. One of
the twelve templates has silently forked the timing, scoring, and
result-reporting logic.

**The engine/template contract is unchecked strings.** `game.js` reaches for
`el('msg')`, `el('app')`, `el('stars')`, `el('done')`, `el('done-stats')`,
`el('title')`, `el('subject')`, and `el('bar')` by ID with nothing verifying a
template defines them. A missing `id="stars"` throws inside `finish()` —
after a child has completed their homework, and before the result reaches
`/api/game-result`.

The backend, by contrast, is sound and carries real invariants worth not
disturbing: `reserveBooking()` runs synchronously before `book()`'s async
work (the race defense against double-booking an hour), lesson generation is
fire-and-forget off `res.on('finish')`, and `recent[]` plus `node:sqlite`'s
`DatabaseSync` are module-level in-process state.

Two artifacts of the Vercel port are worth deleting rather than carrying
forward: the `mount()` helper catches import failures and only `console.warn`s
(`server/app.mjs:88-95`), so a typo in `book.js` starts a healthy server that
silently 404s every booking; and the `res.on('finish')` hook exists only
because that wrapper cannot otherwise observe a ported handler's outcome.

There are no tests, no build step, and no linter.

## 2. Goals

1. One SvelteKit process, TypeScript throughout, replacing Express entirely.
2. One design system replacing seven independent styling approaches.
3. Games as components behind a type-checked contract, not string IDs.
4. Generated content served through explicit routes, never static serving.
5. URLs derivable from data, never persisted into it.
6. A characterization test suite — the repo's first — written before the
   migration and outliving it.
7. A URL layout a future PWA can scope over without changing URLs again.

## 3. Non-goals

- **Sub-project #2 (parent/student sessions, PIN rate-limiting, expiry)** —
  security-sensitive, deserves its own design.
- **Sub-project #3 (PWA manifest, icons, service worker)** — but §6 settles
  the URL layout it depends on, so #3 becomes a manifest-and-worker task.
- **Visual redesign** beyond consolidating what exists.
- **CRM/KB decoupling** (`6hMjCvfjpp2Vm5hq`) beyond making the pricing path
  configurable.
- Redirects for old URLs. Confirmed unnecessary — no live users, and records
  carrying old URLs are regenerated rather than migrated.

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Full absorption — SvelteKit owns pages and API | Deletes the `mount()` footgun and the `res.on('finish')` workaround |
| 2 | SvelteKit + `adapter-node` | `hooks.server.ts` houses auth; a single long-lived process is required by `DatabaseSync` and `recent[]` |
| 3 | Full TypeScript | Prop and shape checking is what makes the games contract real |
| 4 | Big-bang cutover on a branch | No live users; strangler machinery would be pure cost |
| 5 | Consolidate design, minimal drift | Folding 6 inline stylesheets into components forces choosing whose styling wins |
| 6 | Games as one route + 12 components | Removes ~450 duplicated lines; makes the `memory.html` fork impossible |
| 7 | Games live at `/app/play/[template]` | Puts the homework loop inside a future PWA scope (§6) |
| 8 | Characterization suite as a diff detector | Named expected-changes list, not pass/fail parity |
| 9 | Fold in sub-project #4 (in-app nav) only | Free consequence of a shared layout |
| 10 | CI builds the image, VPS pulls it | Atomic deploys, no devDeps in prod, rollback by tag |
| 11 | Fix three known bugs during the migration (§9) | All three sit in code being rewritten; the forgery fix is nearly free given centralized URL construction |
| 12 | Unify the two lesson stores, but after the parity gate (§12, phase 10) | The suite built in phase 0 then guards the data refactor — coverage this repo has never had |

## 5. Target architecture

One process, `node build/index.js`, behind Caddy (`reverse_proxy app:3000`).
Express is removed.

```
src/
  hooks.server.ts          # validates the HMAC cookie → event.locals
  lib/
    server/                # server-only; never bundled clientward
      db.ts                ← server/db.mjs, typed row shapes
      auth.ts              ← server/auth.mjs, crypto unchanged
      calendar.ts          ← server/calendar.mjs
      email.ts             ← extracted from api/book.js
      pricing.ts           ← server/pricing.mjs, path from env
      content.ts           # the generated-content plane (§7)
      urls.ts              # the single URL builder (§8)
      boot-checks.ts       # startup verification (§10)
      lesson/{prep,queue,registry}.ts
    components/            # shared UI
    styles/                # design tokens
    games/                 # engine module + 12 game components
  routes/
    +layout.svelte
    +page.svelte  booking/  login/  portal/
    app/
      +layout.svelte       # app shell, owns in-app nav (#4)
      dashboard/  games/  parent/  student/
      play/[template]/     # the 12 games
      play/data/[id].json/ # game data, served from DATA_DIR
    api/…                  # every /api/* path, unchanged
static/                    # build-time assets only: images, fonts
tests/characterization/    # node:test, runs against old and new
```

**Routing parity splits deliberately.** `/api/*` URLs are byte-identical
before and after, so the characterization suite is the same requests against
two servers. Page URLs drop `.html` (`/booking.html` → `/booking`), matching
`/app/*`, and are verified by click-through.

**Auth maps directly.** `hooks.server.ts` validates the cookie once per
request into `event.locals`; `requireAuth` becomes a helper called from
`+page.server.ts` and `+server.ts`. The crypto in `auth.mjs` — HMAC-signed
self-expiring token, constant-time compare, padded-buffer password
comparison — ports unchanged; it already reads `req.headers.cookie` and sets
`Set-Cookie` by hand.

**Module singletons must survive Vite HMR.** In dev, HMR re-evaluates
modules, which would create a second `DatabaseSync` handle and reset
`recent[]`. Singletons (`db`, `recent`, config) are stashed on `globalThis`
behind a guard.

## 6. The `/app/` boundary and PWA scope

The app/landing separation design placed games outside `/app/`, reasoning
that a game is "a link someone was given, not a destination". It also scoped
the future PWA to `/app/`. Those two decisions conflict: a manifest scoped to
`/app/` means tapping homework inside the installed app navigates outside
scope and drops the child into a browser tab — breaking the app illusion at
the exact moment the product is being used.

URL structure is expensive to change: URLs get persisted into records and
sent to students over WhatsApp. Deferring this to sub-project #3 means
changing game URLs a second time, after more links have gone out.

**Therefore games move to `/app/play/[template]`,** with game data at
`/app/play/data/[id].json`, so the whole homework loop and its cacheable
assets sit under one prefix.

**`/app/` means PWA scope and navigation, not authentication.** Inside it:
`/app/dashboard` and `/app/games` require a session; `/app/parent`,
`/app/student`, and `/app/play/*` do not. This is stated explicitly so no
later change adds a blanket guard over the prefix and locks children out of
their homework.

## 7. The generated-content plane

Four directories hold runtime-written content, all gitignored, all separately
bind-mounted today:

| Directory | Written by | Served today |
|---|---|---|
| `games/data/` | `lesson-queue.mjs:113-124` | `express.static` — public |
| `lessons/<slug>/` | `lesson-queue.mjs:109-111` | `express.static` — public |
| `drafts/<slug>/` | `lesson-queue.mjs:135-138` | `express.static` + `requireAuth` |
| `portal/<code>.json` | `lesson-queue.mjs:154-172` | deny-listed; via `/api/portal/:code` + PIN |

None of these can live in SvelteKit's `static/`, which is copied into the
build at build time — every lesson generated after the last deploy would 404.

**Target.** One `DATA_DIR` (env, default `./data`) holding `lessons/`,
`games-data/`, `drafts/`, `portal/`, and `results.db`: one volume, one backup
target, one "everything here is state" boundary. Nothing under it is
statically served. Each path gets an explicit route:

- `/app/play/data/[id].json` — public
- `/lessons/[slug]` — public, link-based
- `/drafts/[slug]/…` — `requireAuth`
- portal JSON — unchanged, only via `/api/portal/[code]` behind the PIN

`mea-beclick-kb/pricing` stays a **separate read-only mount**. It is not app
state — it is the tutor's externally-synced Obsidian vault. Keeping that
distinction visible in `docker-compose.yml` prevents a later tidy-up from
folding it into the data volume and pointing a backup script at it.

**Why this matters.** Today's protection is an opt-out deny-list —
`app.use(['/Students','/students'], …404)` and `app.use('/portal', …404)`
(`app.mjs:222-230`) — added reactively after student material was found
publicly served on Vercel. Every future generated directory is public until
someone remembers to block it. Route handlers invert the default: nothing is
served unless a route exists, and each route is the natural home for its own
auth check. The `/Students` deny-list disappears; the vault is simply never
in the served tree.

Every `[slug]`/`[id]` is validated against `/^[a-z0-9-]+$/` before touching
the filesystem — the guard `app.mjs:200` already applies to portal codes,
extended to every URL segment that becomes a path.

## 8. URLs are derived, never stored

`portal/noga.json` contains nine URLs of the form
`games/memory.html?d=noga-integrals-memory&s=נוגה`, and the `lessons` table
stores `games TEXT — JSON array of {title,url}` and `slides TEXT — public
URL`. Both stores bake routing decisions into data, so any URL change breaks
stored records — and the characterization suite cannot detect it, because
`/api/portal/:code` faithfully returns whatever JSON is on disk.

**Records store facts only** — `{ template, dataId }` — and every URL is
built at render time by `src/lib/server/urls.ts`. A future URL change then
touches one function and zero data files.

That helper also **signs game URLs**: it appends `&t=<hmac>` over
`{dataId, student}` using the HMAC machinery already in `auth.mjs`, and
`/api/game-result` verifies it before writing. This closes
`6hJh32VVc5VH2jVq` (forgeable results) properly rather than by patch, and it
is cheap only because URL construction is centralized. The same signature
identifies the student for the personal-best lookup in §9.

Existing records are regenerated, not migrated. No redirects.

## 9. Bugs fixed during the migration

Deliberate behavior changes, each listed in the suite's expected-changes list.

**`6hJh33RvfVc8r84H` (p2) — booking email exposes the raw server IP.**
`book.js:249` falls back to `'http://76.13.59.4:8080'` when `SITE_URL` is
unset. The fallback is removed and the app refuses to boot without
`SITE_URL`, turning missing config into a loud startup failure rather than a
raw IP in a parent's inbox.

**`6hJh32VVc5VH2jVq` (p2) — `/api/game-result` accepts anonymous writes.**
Closed by the signed URLs in §8.

**`6hJh337GrfGQj5Hq` (p3) — speed-drill personal best never persists.**
Diagnosed: the code at `speed-drill.html:136-138` is correct. The medium is
wrong. It uses `localStorage` in a page opened from a WhatsApp link, and
WhatsApp's in-app WebView has its own storage context that is routinely
cleared between opens. The value saves and is gone by the next session.

The fix is already in the database: every finished game POSTs to
`/api/game-result`, which writes `results(student, at, data_id, template,
score, total, stars, seconds…)` indexed on `(student, at DESC)`. A
`getBest(student, dataId)` query returned alongside the game data replaces
`localStorage` entirely — and follows the child across devices, which
`localStorage` never could. The `t=<hmac>` from §8 identifies the student, so
no extra parameter is needed.

## 10. Startup checks

The system has repeatedly been bitten by silent failure — `mount()` warning
and continuing, calendar writes failing invisibly until `flagCalendarFailure`
was added. `boot-checks.ts` verifies every external dependency once at start
and fails loudly:

- `claude --version` runs (see §11)
- `DATA_DIR` exists and is writable
- `SITE_URL` is set (§9)
- `ADMIN_PASSWORD` and `SESSION_SECRET` are set — today these only `console.warn`

## 11. The generation path is the one gate nothing else covers

Lesson generation spawns the `claude` CLI as a subprocess in an
`os.tmpdir()` job directory (`lesson-prep.mjs:300,408-425`), with
`--permission-mode dontAsk --allowedTools Write`, a SIGTERM→SIGKILL timeout,
and stdout deliberately unpiped to avoid a full-pipe deadlock. The Dockerfile
installs `@anthropic-ai/claude-code@2.1.241` globally to provide it.

**A multi-stage Dockerfile that copies only `build/` and production
`node_modules` silently drops that binary.** Generation then fails with
`failed to start claude`, and neither verification gate catches it — the
suite deliberately does not run generation, and click-through never triggers
a booking. It would surface at the first real booking as a lesson that never
appears.

Two defenses: the boot check in §10, and a pre-cutover end-to-end smoke —
run the built image with a real `CLAUDE_CODE_OAUTH_TOKEN`, book a lesson, and
verify the chain end to end: `claude` on PATH, tmpdir writable under `USER
node`, `plan.json` produced, slides rendered, game data written into
`DATA_DIR`, and the lesson record carrying `{template, dataId}` rather than a
baked URL.

## 12. Migration sequence

**Phase 0 — the net.** Characterization suite against today's Express app,
green on `main`: auth (login/logout/me, 401 shapes), booking (reservation
ordering, 409 on double-book, release on downstream failure), the portal PIN
boundary (wrong pin / missing student / missing file answering identically),
students CRUD, `game-result` never failing loudly, `results`, `lessons`.
Temp `DB_PATH` per run. Feasible with zero network: with `GOOGLE_SERVICE_
ACCOUNT_*` unset `book.js` returns before any Google call, and
`sendBookingEmail` returns `false` immediately when `GMAIL_USER`/
`GMAIL_APP_PASSWORD` are unset (`book.js:225-228`) — no connection attempt,
no hang. `node:test`, no new dependencies.

1. Scaffold SvelteKit + TS + `adapter-node`; extract design tokens from
   `styles.css` and the six inline `<style>` blocks.
2. Port `src/lib/server/*` — typed, no logic changes.
3. Port `/api/*` route by route, re-running the suite after each group.
4. `DATA_DIR` consolidation + content routes (§7).
5. Pages — landing, then `/app/*` with the shared layout and in-app nav (#4).
6. Games — layout, engine module, 12 components; `urls.ts` and the
   `{template, dataId}` record shape (§8); `registry.json`'s `urlPattern`
   *and* `dataPath`, since game data moves under `/app/play/data/`.
7. Bug fixes (§9) and boot checks (§10).
8. Deploy — multi-stage Dockerfile keeping the `claude` binary in the runtime
   stage, CI build → GHCR, VPS forced command becomes pull-and-up. Cut over.
9. Delete `server/`, `api/`, `pages/`, `games/*.html`.
10. **Unify the stores.** Collapse `portal/<code>.json` into SQLite, closing
    `6hM24q3XQH678Jgq` — the dashboard reads homework from the DB while the
    student page reads it from portal JSON, and they drift because
    `lesson-queue.mjs` writes both in different shapes. Deliberately after
    the parity gate, so the data refactor happens with the suite already
    guarding it.

## 13. Verification gates

- Suite green against SvelteKit after phases 3–4, allowing for the named
  expected changes from §9.
- Manual click-through of every page and all 12 game templates against real
  data after 5–6 — explicitly including a homework link from `/app/student`,
  the only way a broken stored URL surfaces.
- The §11 generation smoke on the built image before cutover.
- Rollback is re-pulling the previous image tag.

## 14. Known risk

Phase 2 ports roughly 1,900 lines of backend that the suite covers only
through HTTP. `lesson-prep.mjs` (647 lines) is largely LLM prompt
construction and schema validation reachable only when generation actually
runs, which the suite deliberately does not do. It is ported mechanically —
translation, not improvement — and its real verification is the §11 smoke.
