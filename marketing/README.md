# Marketing assets

Social-media campaign material. Nothing in this folder is served by the live
site (`server/app.mjs` only exposes `images/`, `games/`, `lessons/`, and a
fixed page list — verified by grep before this folder existed).

- `2025-v1/`, `2025-v2/` — frozen archives of earlier campaign designs, kept
  for reference. Not in active use.
- `2026/` — the active campaign: build scripts (`build*.mjs`, `render*.mjs`,
  `style2.mjs`, etc.) plus the HTML/PNG/GIF they generate. **Stays flat on
  purpose** — `render.mjs` and `checkfit.mjs` glob every `.html` file in the
  current directory, and several render scripts import puppeteer from
  `../2025-v2/node_modules/`. Splitting the generated posts into topic
  subfolders would break that tooling; it would need rewriting first if that
  reorganization is wanted later.
- `copy/` — campaign copywriting (captions, schedule, platform notes), kept
  separate from code and generated images. Staged here, not yet moved into
  `mea-beclick-kb/` — that migration is a deliberate later step, not part of
  this reorganization.
