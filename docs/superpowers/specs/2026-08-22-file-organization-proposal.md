# Repo file-organization proposal

Nikol asked for a cleanup pass over the whole repo. Pick an option (or mix
pieces of them) and we'll turn it into an actual plan.

**Status (2026-08-23): Option A executed**, plus a text/code split and a
content dedup pass on top of it — see `marketing/README.md`. `social_posts`,
`social_posts_v2`, and `social_posts_2026` are now `marketing/2025-v1`,
`marketing/2025-v2`, and `marketing/2026`. `marketing/2026/captions.md` moved
to `marketing/copy/social-2026-campaign.md`, deduplicated (two posts had
reused the exact same caption text under a different heading — merged into
one entry each, referenced by number, nothing lost) and staged there ahead
of an eventual move into `mea-beclick-kb/` (not done yet, by request). The
puppeteer import path in `marketing/2026/*.mjs` was updated to match the
folder rename.

**Status (2026-08-23, later): Option C executed too.** All 8 root-level
pages (`index.html`, `login.html`, `booking.html`, `student.html`,
`parent-dashboard.html`, `dashboard.html`, `portal.html`, `styles.css`) moved
to `pages/`. `server/app.mjs`'s three sendFile/static routes were updated to
read from `pages/` while keeping the public URLs unchanged (`/booking.html`
etc. still resolve — only the on-disk lookup path changed, so relative links
and asset references inside the pages were unaffected). Verified by running
the server on a scratch port and curling all 8 routes (200) plus the
auth-gated `/dashboard.html` (302, as expected unauthenticated) before
committing. Option B (repo-map note) is still open.

## Current state

```
mea-beclick/
├── index.html, login.html, booking.html, student.html,
│   parent-dashboard.html, dashboard.html, styles.css   ← site pages, repo root
├── api/                  ← 4 Vercel serverless functions (ask, availability, book, remind)
├── server/               ← main web app (Express) + its systemd/Caddy config
├── vps/                  ← SEPARATE results microservice + its own systemd config
├── games/                ← game templates + games/data/*.json (per-assignment data)
├── images/               ← site images (has games/, logos/, slides/ subfolders)
├── portal/                ← per-student portal JSON (auth-gated, not statically served)
├── drafts/                ← unreviewed lesson drafts (auth-gated)
├── data/results.db        ← sqlite db
├── mea-beclick-kb/        ← Obsidian vault (already documented as self-contained)
├── social_posts/          ← marketing assets, v1 (40K)
├── social_posts_v2/       ← marketing assets, v2 (53M, own node_modules)
├── social_posts_2026/     ← marketing assets, latest (10M, own node_modules)
└── docs/superpowers/       ← specs and plans
```

## What I checked before proposing anything

- `server/app.mjs:184-219` — the exact allowlist of what the live server
  serves: `images`, `games`, `lessons` as static dirs, plus a hardcoded file
  list (`booking.html`, `login.html`, `student.html`,
  `parent-dashboard.html`, `styles.css`, `index.html`). `dashboard.html` is
  served separately behind `requireAuth`. `portal` and `drafts` explicitly
  404/auth-gate direct access. Everything *not* on this list is invisible to
  the public — which is also why root-level HTML files are routing-coupled,
  not just clutter.
- `grep -rn "social_posts"` across `.mjs`/`.js`/`.json`/Caddyfile — zero
  hits outside the folders' own `package.json`. **None of the three
  `social_posts*` folders are referenced by any served code.** They're
  build-your-own-image source trees for social media, generated and posted
  manually.
- `server/` vs `vps/` looked like a duplicate at first glance (both have
  systemd `.service` files) but are two independently-deployed services:
  `server/app.mjs` is the main site, deployed to `~/maabeclick-web`
  (`server/maabeclick-web.service`); `vps/server.mjs` is a separate
  results-DB microservice deployed to `~/maabeclick` or `/opt/maabeclick`
  (`vps/maabeclick.service` = root-owned system unit,
  `vps/maabeclick-user.service` = the same thing as a user unit — README
  says to pick one, not both). **This is intentional, not a mess. Proposal
  does not touch it.**
- `games/registry.json:1-6` — `dataPath: "/games/data/{dataId}.json"` is a
  documented contract the lesson-prep pipeline relies on. The flat
  `games/data/noga-derivatives-matching.json` naming is by design, not
  drift. **Proposal does not touch it.**

## Option A — safe cleanup only (recommended)

Touches zero server code. Pure filesystem move + a couple of README notes.

```
marketing/
├── 2025-v1/        (was social_posts/)
├── 2025-v2/        (was social_posts_v2/)
└── 2026/           (was social_posts_2026/)
```

- Rename `social_posts` → `marketing/2025-v1`, `social_posts_v2` →
  `marketing/2025-v2`, `social_posts_2026` → `marketing/2026`.
- No code changes needed anywhere — confirmed nothing references these
  paths.
- Optional: add a one-line `marketing/README.md` noting `2026/` is the
  current generation, older folders are kept for reference only.

**Effort:** ~5 minutes. **Risk:** none (verified no references).

## Option B — Option A + documentation

Same moves as Option A, plus a short `docs/superpowers/notes/repo-map.md`
(or an addition to `CLAUDE.md`) spelling out the `server/` vs `vps/`
distinction and the `games/data/` naming contract, so it stops looking like
duplication/mess to the next person (or agent) who opens the repo.

**Effort:** ~15 minutes. **Risk:** none.

## Option C — Option B + move root pages into `pages/`

```
pages/
├── index.html, login.html, booking.html, student.html,
│   parent-dashboard.html, dashboard.html, styles.css
```

Requires updating `server/app.mjs` in the same change:
- Line 184: `res.sendFile(join(SITE, 'dashboard.html'))` → `join(SITE, 'pages', 'dashboard.html')`
- Line 211-213 (the `for (const file of [...])` loop): update the base dir to `pages/`
- Line 217: `index.html` sendFile path → `pages/index.html`
- Any relative asset links *inside* those HTML files (`<link>`, `<script src>`,
  relative image paths) need checking — they currently assume they sit next
  to `images/`, `styles.css`, etc. at repo root; moving them a level deeper
  breaks any relative (non-`/`-prefixed) reference.

**Effort:** ~30-45 minutes plus a full manual click-through of every page
post-move (this is the part that touches live routing). **Risk:** low-medium
— straightforward but must be tested end-to-end before deploying, since a
missed relative path silently 404s a page.

## Recommendation

Start with **Option A**. It's the only real mess (three unlabeled,
undated marketing folders competing for "which one is current"), it's
zero-risk, and it doesn't require touching anything that's live. Option C is
worth doing at some point for tidiness but isn't blocking anything — I'd
treat it as a separate, deliberate task with its own testing pass, not
bundled into a general cleanup.

## Not proposed (checked, left alone on purpose)

- `server/` vs `vps/` — two real, separate services.
- `games/data/` — flat naming is a documented contract.
- `api/` + `vercel.json` + `.vercel/` — deploy topology; touching this needs
  clarity on current Vercel vs. VPS deploy state first, not a filesystem
  reorg call.
- `portal/`, `drafts/`, `mea-beclick-kb/` — already access-gated /
  self-contained appropriately.
