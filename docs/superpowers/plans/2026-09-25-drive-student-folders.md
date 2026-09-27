# Drive student folders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Spec:** `docs/superpowers/specs/2026-09-25-drive-student-folders-design.md`

## Review Focus
1. A tutor edit in Drive **and** a newer site publish in the same window: the Drive edit wins as a draft, and nothing is pushed over it.
2. A document trashed in Drive: recreated once, not recreated every run.
3. The job running twice at once (timer + manual): no duplicate folders or documents.
4. A Drive document parsed to nothing valid: nothing saved, the tutor told once.
5. Our own update bumping `modifiedTime`: it must not read as her edit on the next run.

### Task 1 — `drive_items` store: migration 019, `src/lib/server/drive/store.ts` (`getItem(key)`, `putItem(...)`), storage-inventory status.
### Task 2 — `src/lib/server/drive/format.ts`: `planToHtml(plan, meta)`, `indexHtml(student, lessons)`, `parseDriveMarkdown(md) → edit input`. Fixtures are the two real exports from the probe.
### Task 3 — `src/lib/server/drive/api.ts`: a thin client over fetch (token via `server/drive/client.mjs`): `createFolder`, `createDoc(html, parent, name)`, `updateDoc(id, html)`, `meta(id)` (modifiedTime, trashed), `exportMarkdown(id)`. Tested with a fake fetch.
### Task 4 — `src/lib/server/drive/sync.ts`: `syncDrive({ api, notify, now })` per D3, with an in-memory fake api in tests covering every branch and Review Focus 1–5. A process-level lock covers #3.
### Task 5 — `GET /api/drive-sync` (cron key), the systemd service/timer (10 min), the harness blocking `GOOGLE_OAUTH_*`, README.
### Task 6 — Proof on production: one run creates the tree. A document edited through the API is pulled as a draft on the next run. Then review, PR, merge, and install the timer on the box.
