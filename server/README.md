# Self-hosted server — Docker Compose

One Node process (SvelteKit + adapter-node) serves the site *and* the API,
in a container. Caddy (also containerized) terminates TLS and
reverse-proxies to it.

```
browser ──HTTPS──> Caddy container :443 ──> app container :3000 ──> SQLite
                   (auto TLS)                (this app)              (bind-mounted)
```

The app image is built by CI (GitHub Actions) and pushed to GHCR — the VPS
pulls a pre-built, pre-tested image rather than building from source. See
**Deploy** below, and **the manual VPS step is required reading** before
the first image-based deploy.

## Isolation

Runs under a dedicated `meabeclick` system user — not a personal/shared
account. That user's only jobs are: hold the git checkout, run
`docker compose`, and run the daily backup timer.

## Install (as the meabeclick user, once)

**This section is for a brand-new VPS with no prior deployment.** If this
box already runs the old Express deployment with real, live data on it
(`portal/`, `lessons/`, `drafts/`, `games/data/`), stop and read **Cutover
from the Express deployment** below FIRST — doing the steps below on a live
box in the wrong order destroys real student data irrecoverably.

```bash
git clone https://github.com/Lior-Nis/meabeclick.git ~/mea-beclick
cd ~/mea-beclick
```

`data/` and `service-account.json` are gitignored, so a fresh clone doesn't
have them. Create `data/portal` and `data/games-data` **before the first
`docker compose up`** — otherwise Docker creates the bind-mount source
itself, root-owned, and the app container (which runs as uid 1000, the
`node` user) can't write to it. Both need seeding from git-tracked seed
directories — see **Portal data** below for why this is a separate step,
not something the image or a mount handles for you:

```bash
mkdir -p data/portal data/games-data
# Portal records are real student data and are not in git. On a box that
# replaces an existing one, restore data/ from the Drive backup (server/restore-db.sh,
# see "Backups"); a brand-new install starts with an empty data/portal.
cp seed/games-data/*.json data/games-data/
# Own by uid 1000 (the container's `node` user) but KEEP the host group
# that already owns data/ — on the live VPS that is meabeclick (gid 1002),
# and the backup timer runs as that user, so a blanket `1000:1000` would
# take away its group-write. Read the current group rather than assuming:
chown -R 1000:"$(stat -c %g data)" data
```

(`seed/games-data/` holds a dozen demo/example game-data files referenced
by `games/registry.json`'s `example` field — e.g. the "try the example"
links on `/app/games`. They used to be tracked directly at
`data/games-data/*.json`, inside the app's writable `DATA_DIR` mount; see
**Cutover** below for why that was a bug and why they moved to `seed/`.)

Put your Google service-account JSON key at `service-account.json` (chmod 600),
owned by uid 1000 so the container can read it.

Create `.env` (chmod 600) — secret values only; non-secret config
(`ORIGIN`, `PROTOCOL_HEADER`, `HOST_HEADER`, `DATA_DIR`) is already set in
`docker-compose.yml` and must NOT be duplicated here:

```
ADMIN_PASSWORD=<your dashboard password>
SESSION_SECRET=<openssl rand -hex 32>
CALLMEBOT_API_KEY=<optional — WhatsApp notifications; see "The weekly reminder" below>
CALENDAR_ICS_URLS=<private iCal URL, for reading availability>
AVAILABILITY_CALENDAR_IDS=<optional, comma-separated — only for the Google
  Calendar API fallback, which needs GOOGLE_API_KEY and is unused when
  CALENDAR_ICS_URLS is set. These are personal calendar ids; keep them here,
  never in source>
GMAIL_USER=<gmail address booking confirmations send from>
GMAIL_APP_PASSWORD=<gmail app password>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<service account email, for writing calendar events>
CALENDAR_ID=<calendar id events get written to — REQUIRED, no default>
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/app/service-account.json
SITE_URL=https://meabeclick.com
CRON_KEY=<openssl rand -hex 32>
```

### Calendar reads: what blocks a slot, and how fresh it is

`CALENDAR_ICS_URLS` is a comma/whitespace separated list of private iCal
URLs. **Production runs exactly one**, measured 2026-09-21. It is the read
side only — writing a booking into the calendar is a separate mechanism
(`GOOGLE_SERVICE_ACCOUNT_*` + `CALENDAR_ID`), and the two are fully
independent: availability can look healthy while an event failed to be
written, which is why write failures are recorded and surfaced separately.

**What counts as a blocking event.** A VEVENT blocks a slot unless it is:

| skipped | why |
|---|---|
| `STATUS:CANCELLED` | the event is off |
| `DTSTART;VALUE=DATE` (all-day) | an all-day marker is not a teaching conflict |
| `TRANSP:TRANSPARENT` | "free" in Google's own UI |
| an `EXDATE`'d occurrence | that instance was cancelled |
| a `RECURRENCE-ID` override with `STATUS:CANCELLED` | that instance was cancelled |

A moved instance (`RECURRENCE-ID` with new times) blocks at its **new**
time, not its original. Each of these has a test in
`tests/unit/calendar-ics.test.mjs`.

**Which feed shape production actually sends.** Measured 2026-09-21 on the
live feed: 4481 VEVENTs, 4341 of them `RECURRENCE-ID` instances, and
**zero RRULE**. That is Google's *expanded* shape — every occurrence ships
as its own VEVENT sharing one UID. node-ical keys its result by UID, so
those instances live in `ev.recurrences` and are invisible unless read
separately, which `busyFromIcs` does.

So the RRULE-expansion branch in `calendar.ts` is **not exercised in
production today**. It is kept because a private feed keeps RRULE and needs
expanding, and changing the feed URL can change the shape. Both paths are
tested; only one runs here.

**Refresh window: 5 minutes, and why that is the right number.** The iCal
read is cached for 5 minutes (`calendar.ts`). Measured on the live
endpoint:

```
cold (cache miss): 1.77s
warm (cached):     0.48-0.53s
```

Parsing 4481 events on every page load would make the booking page crawl,
and Google's own iCal publishing lag is longer than 5 minutes and outside
our control — so a shorter TTL buys accuracy we cannot actually have.

This is safe because **the cache is not what prevents double-booking**.
That is the booking *write* path: `readBookings()` folds lessons booked
here into the busy set, and the write path re-checks. A stale calendar read
can offer a slot Nicole has since filled in Google; it cannot let two
parents take the same slot through this site.

**When a feed cannot be read.** `/api/availability` returns
`calendarFailures` alongside `calendarConnected`, so a partial read is
never reported as a clean one, and the dashboard shows the tutor a banner:
«קריאת יומן נכשלה — ייתכן ששעות תפוסות מוצגות כפנויות». A failing feed is
identified **by position only** («יומן 1 מתוך 3»), never by URL — the URL is
a secret, and two tests assert that nothing derived from it reaches any
surfaced string, including when a fetch rejection carries the URL in its
own message.

**Not verified here.** That a change or cancellation made in Google appears
in the feed within a stated time. That is a property of Google's publishing
lag rather than of this code, and measuring it needs a calendar carrying no
real student data — see the Todoist task's own dependency note.

### The weekly reminder, and CALLMEBOT_API_KEY

`meabeclick-remind.timer` asks `/api/remind` once a week to nudge Nicole to
update her calendar before booking opens at 20:00. It prefers WhatsApp via
CallMeBot, because a Saturday-evening message gets read.

`CALLMEBOT_API_KEY` is **optional**. Without it the same reminder goes by
email, through the transport `/api/reports/prompt` already uses, and the
response says `{"ok":true,"channel":"email"}`. The route answers 503 — so
`curl --fail` fails the unit rather than recording a success that sent
nothing — only when neither channel can send, i.e. no CallMeBot key *and*
no `GMAIL_USER`/`GMAIL_APP_PASSWORD`.

Measured, 2026-09-20: the key was not set on this box, and the unit had
been failing with `curl (22) ... 503` since Sat 2026-09-19 — the first
Saturday after the 503 landed. The email fallback is what closes that.

To get the key anyway (WhatsApp is still the better channel): from the
phone that should receive the reminders, message `+34 644 59 78 46` with
"I allow callmebot to send me messages", then put the key it replies with
in `.env` and `docker compose up -d` with `APP_TAG` set.

**Rotating `CRON_KEY` needs a restart, not just an edit.** The app container
reads `process.env` once, at container start, so changing `.env` alone
leaves it checking requests against the OLD key until `docker compose up -d`
recreates it. The two timers (below) read `.env` fresh on every run, so
they pick up the new key immediately — meaning a rotation without a
restart makes every run in between answer 401: up to an hour for the
report-prompt timer, or up to a week for the Saturday reminder. Rotate with:

```bash
# edit CRON_KEY in .env, then recreate the app ON THE TAG IT IS ALREADY
# RUNNING — never a bare `docker compose up -d`:
APP_TAG=$(docker inspect mea-beclick-app-1 --format '{{.Config.Image}}' | sed 's/.*://') \
  docker compose up -d
```

> A bare `docker compose up -d` here used to roll production backwards. It
> resolved the image to `:latest` and started the **locally cached** copy
> without pulling — on this box, one old enough to predate both the
> `/api/reports/prompt` route and the cron-key guard on `/api/remind`.
> Nothing failed; the site stayed up serving old code. `docker-compose.yml`
> now refuses to start without an explicit `APP_TAG`, so that mistake is
> no longer available.

### Lesson-generation credentials

Lesson generation shells out to the Codex CLI, installed globally in the app
image's **runtime** stage (not just the builder — see the Dockerfile
comment), so `codex` is already on `PATH` inside the container. `CODEX_BIN` is
not needed.

Its credentials are **not** an entry in `.env`. `codex login` writes
`auth.json` into `$CODEX_HOME` and refreshes it in place, so it is a mounted
directory (`./codex-home` → `/app/.codex`, read-write, see
`docker-compose.yml`). Set it up once:

```bash
mkdir -p codex-home
# uid 1000 = the image's `node` user; keep the host group that owns data/,
# for the same reason as the data/ chown above.
chown -R 1000:"$(stat -c %g data)" codex-home
docker compose run --rm app codex login       # follow the printed URL
docker compose exec app codex login status    # expect: Logged in
```

**Create this directory before the first deploy of this change.** It is a
bind mount, so if it does not exist Docker creates it — as root, owned by
root, and therefore unwritable by the container's `node` user. The result is
a directory that looks correct, a `codex login` that cannot save its token,
and generation that fails on credentials with nothing obviously wrong.

The mount must stay writable. A read-only mount works right up until the
first token refresh and then starts failing as an auth error — the most
confusing form of this failure.

`codex-home/` is git-ignored and holds a live credential: don't commit it and
don't copy it into `mea-beclick-kb/`.

If `codex login` fails with `error sending request for url (...)` while DNS
and egress are fine, the image is missing `ca-certificates`. Codex is a Rust
binary and trusts the system store; Node carries its own, so the app's own
HTTPS calls keep working and nothing else looks wrong. The Dockerfile
installs it and boot warns if it ever goes missing again.

On a headless box use `codex login --device-auth` — plain `codex login`
starts a callback server on `localhost:1455` *inside the container*, which
your browser cannot reach.

**Verifying it works**, without waiting for a real family to book:

```bash
docker compose logs app | grep -i 'WARNING.*lesson\|no credentials'   # boot check
docker compose exec app codex exec --skip-git-repo-check -                   # then type a prompt
```

Boot warns (never fails) when the CLI is missing or unauthenticated, and the
tutor dashboard now names which of the two went wrong instead of showing one
generic "technical error" for every cause.

The same credential answers the student question box (`/api/ask`), which
used to need a separate `ANTHROPIC_API_KEY` and had been returning 503 for
its whole life because that key was never set here. There is nothing extra
to configure for it.

```bash
docker compose build   # or: docker compose pull, once CI is publishing images
APP_TAG=latest docker compose up -d   # bootstrap only; every later deploy names a commit
curl -s https://meabeclick.com/api/me
```

## Cutover from the Express deployment

**Read this whole section before touching the box.** It applies ONLY the
first time this VPS moves from the old Express deployment to the
image-based SvelteKit deployment. Run it ONCE, on the VPS, BEFORE the first
image-based deploy, and BEFORE any `git` operation (`git pull`, `git
checkout`, `git reset` — anything that can touch the working tree).

> ⚠️ **Doing step 5 before step 1 destroys a real student's record
> irrecoverably.** The old Express deployment bind-mounted `./portal`
> straight into the container, so `portal/*.json` in the git working tree
> IS the live data the tutor and families have been reading and writing to
> for weeks — not a snapshot. It is also git-tracked, because it started
> life as a seed file before it became a live one. That combination means
> the working tree is dirty on that path right now, on the box, and the
> ONLY safe way to make `git pull` succeed again is to copy the LIVE
> content out first (step 1) and only then discard the dirty tracked copy
> (step 5). Reaching for `git checkout -- portal/` or `git reset --hard`
> before step 1 overwrites the live file with whatever was last committed
> — silently deleting every lesson, homework state and `nextLesson` written
> since that commit. There is no undo.
>
> This is also why the deploy's forced SSH command
> (`git pull && docker compose pull app && docker compose up -d
> --no-build`) is chained with `&&`: if `git pull` aborts on the dirty
> `portal/` path (which it will, until this section is done), the pull AND
> the redeploy never run — the site just silently keeps serving whatever
> was already running, with no error visible anywhere. This section is
> what stops that abort from ever happening.

The old `docker-compose.yml` mounted five directories into the app
container: `./data`, `./lessons`, `./portal`, `./games/data`, `./drafts`.
The new one mounts `./data` alone (see **Data & generated content** below).
Nothing about the new image or its compose file moves the other four
directories' contents into `./data` for you — that is what steps 1–2 below
do, by hand, once.

1. **Seed portal from the WORKING TREE, not from git** — the live content
   on disk is what must survive, and it is newer than anything in git
   history:

   ```bash
   mkdir -p data/portal && cp -n portal/*.json data/portal/
   ```

2. **Move the other three generated-content directories** into their new
   homes under `./data`:

   ```bash
   mkdir -p data/lessons data/drafts data/games-data
   cp -rn lessons/* data/lessons/
   cp -rn drafts/* data/drafts/
   cp -n games/data/* data/games-data/
   ```

   (`lessons/` and `drafts/` are gitignored, so their contents are real,
   untracked, and invisible to `git status` — nothing about the migration
   flags them for you. Skipping this step means `/lessons/<slug>` 404s for
   every pre-cutover lesson ever sent to a family, and every draft the
   tutor hadn't reviewed yet is gone. `games/data/` is the OLD bind-mount
   source for per-lesson game JSON — distinct from this repo's
   `seed/games-data/`, which only holds a dozen demo fixtures.)

3. **Convert the LIVE portal file(s) to the new `{template,dataId}` record
   shape.** Ruling P13 required whole-file replacement before any
   new-shape generation could run, but the fix that actually shipped
   (commit 91bbf2a) only hand-edited the REPO's `portal/noga.json` — the
   file just copied into `data/portal/` in step 1 above is still old-shape,
   with `games`/`homework` entries pointing at `games/<template>.html`
   files that this deployment has deleted. Run the migration script
   against every file now in `data/portal/`:

   ```bash
   node scripts/migrate-portal-shape.mjs data/portal/*.json
   ```

   It is idempotent and leaves already-converted entries untouched, so
   it's safe to run even if some files (or none) still need it. See
   `scripts/migrate-portal-shape.mjs`'s header for the exact conversion
   recipe.

4. **Fix ownership** so the app container (uid 1000) can write to
   everything just copied in. Set the owner to 1000, but KEEP whatever
   group already owns `data/` — on this VPS that is `meabeclick` (gid
   1002), and the backup timer runs as that user, so a blanket
   `1000:1000` would silently remove its group-write access:

   ```bash
   chown -R 1000:"$(stat -c %g data)" data
   ```

   Verify it matches what already works — `data/results.db` has been
   written by the container for months, so its owner:group is the pattern
   to copy:

   ```bash
   stat -c '%n %u:%g' data data/results.db data/portal
   ```

5. **Only now discard the dirty tracked path** so `git pull` can proceed —
   the live content was already copied out in step 1, so this is safe:

   ```bash
   git checkout -- portal/
   ```

6. Then the documented **GHCR login** and **`authorized_keys`** steps
   under **Manual VPS steps** below, then deploy as normal.

## Data & generated content

One host directory and one file are mounted into the `app` container:

- `./data` (`DATA_DIR=/app/data`) — everything the app generates or writes
  at runtime under `DATA_DIR`: SQLite DB (`results.db`) + daily backups,
  generated lesson slides, games-data (per-lesson game JSON), and
  unreviewed drafts. This replaced five separate app-owned mounts; see
  `docker-compose.yml`'s comment.
- `./service-account.json` — Google service-account key (gitignored, never
  baked into the image)

**No longer mounted (as of 5.9.2026):** `./mea-beclick-kb/pricing`, the
tutor's hand-kept Markdown payment ledger. The parent portal's balance now
comes from the `payments` table inside `./data`'s SQLite DB, not from that
file. `mea-beclick-kb/pricing/Summary.md` still holds real payment records
(PII) as a historical record, but the app no longer reads it and the
container no longer has a path into that directory at all — the KB (student
records included) stays entirely out of the container.

`games/registry.json` (and the rest of `games/`) is static, checked-in
config, not generated content — it's baked into the image itself (see the
Dockerfile), not bind-mounted.

### Portal data

Per-student portal JSON does **not** live under `DATA_DIR` — it has its
own env var, `PORTAL_DIR`, deliberately kept separate (see the header
comment on `src/lib/server/paths.ts`: folding it into `DATA_DIR`'s
`contentPath()` would silently change where real student PII resolves to
for anyone relying on the unset default). `docker-compose.yml` sets
`PORTAL_DIR=/app/data/portal` — a subdirectory *inside* the `./data`
mount, so it persists across redeploys, without changing that code
default.

Because of this, portal data lives only in the mount. Portal records are
real student data, so they are not in git (the last tracked one,
`portal/noga.json`, left the index on 2026-09-25) and the Dockerfile never
copies them into the image (student PII is a mounted-volume concern, not
something baked into an image that ends up in a registry). A replacement
box gets them by restoring `data/` from the backup; a brand-new install
starts with an empty `data/portal`. On a
box that already has a live Express deployment on it, seed from the
WORKING TREE instead, per **Cutover from the Express deployment** above —
git's copy is stale the moment the old deployment starts writing to it. If
you skip this, `checkPortalDir()` (`src/lib/server/boot-checks.ts`) still
lets the container boot — the directory exists and is writable — but any
existing student's portal read 404s exactly like a wrong PIN (the
uniform-denial behavior in `/api/portal/[code]` that stops the endpoint
enumerating valid codes also hides this misconfiguration from an admin
just watching logs for errors).

`checkPortalDir()` logs the fully resolved `PORTAL_DIR` path at boot
(`[boot] PORTAL_DIR resolved to ...`) and refuses to start if that
directory doesn't exist or isn't writable — the same fail-fast treatment
`DATA_DIR` already gets. Confirm the logged path is `/app/data/portal`,
not something under `/app/build`.

## Caddy — TLS, containerized

No host-level Caddy install. `server/Caddyfile` is bind-mounted read-only
into the `caddy` service; it already lists `meabeclick.com` and
`www.meabeclick.com`. Point the domain's A record at the server (already
done — see the design spec), and Caddy fetches the certificate on first
request. Nothing else to do — renewal is automatic, and certs persist across
container recreates in the `caddy_data` named volume.

## Operating

```bash
docker compose logs -f app
docker compose logs -f caddy
docker compose restart app
APP_TAG=$(git rev-parse HEAD) docker compose pull app && APP_TAG=$(git rev-parse HEAD) docker compose up -d --no-build   # after a git pull
```

## Deploy

CI (`.github/workflows/deploy.yml`) runs `npm test` and `npm run check`,
builds the Docker image, and pushes it to GHCR tagged with both the commit
SHA and `latest` — **before** telling the VPS to deploy. A broken build or
failing test now fails in CI; it never reaches the VPS.

Pushing to `main` then triggers the SSH step, which connects to the VPS as
`meabeclick`. That SSH key is forced (via `command=` in `meabeclick`'s
`~/.ssh/authorized_keys`) to run exactly one command server-side and
nothing else, so a leaked key can only trigger a redeploy of this repo — it
can't open a shell. **The actual command CI's SSH client sends is ignored**;
only the forced command matters.

### Manual VPS steps — all done

One-time, on-the-box setup. Recorded because each one breaks the pipeline
silently when missing — no error surfaces in CI or in the workflow run — and
because a rebuilt box needs all three again.

**0. `codex-home/` created and authenticated.** ✅ See "Lesson-generation
credentials" above. Until this exists the site serves and books normally;
only lesson generation and the question box fail, and boot now says which.

**1. The VPS is authenticated to GHCR.** ✅ `docker compose pull app` needs
read access, and the package is private, so an unauthenticated pull 401s.
As the `meabeclick` user, once:

```bash
docker login ghcr.io -u <your-github-username>
# password: a GitHub personal access token (CLASSIC — GitHub Packages does
# not accept fine-grained tokens) with ONLY the read:packages scope.
```

The credential lands unencrypted in `~/.docker/config.json`, which is why the
token is scoped to reading packages and nothing else: a leak of it exposes
the container images and no more.

**Watch the expiry.** A classic PAT with a 90-day life stops every deploy on
day 91, and the failure reads as a registry problem rather than an expired
token. Either set no expiration or diary the renewal.

**2. The deploy runs CI's image instead of rebuilding.** ✅ The forced
command in `meabeclick`'s `~/.ssh/authorized_keys` is:

```
command="cd /home/meabeclick/mea-beclick && git pull --ff-only && export APP_TAG=$(git rev-parse HEAD) && docker compose pull app && docker compose up -d --no-build"
```

Three things in that line are load-bearing:

- `--ff-only` — a plain `git pull` on a diverged checkout tries to merge, and
  a deploy that quietly writes a merge commit on the box is worse than one
  that stops.
- `APP_TAG` — the commit just fetched. `docker-compose.yml` interpolates it,
  so the box runs the image built from exactly that checkout rather than
  whatever `:latest` happens to point at.
- `--no-build` — stops compose rebuilding from source and defeating the
  point.

A backup of the previous file is kept alongside it as
`authorized_keys.bak-<timestamp>`.

**When `main`'s history is rewritten, the box needs one manual reset.**
`--ff-only` is doing its job when it refuses a rewritten history — it cannot
tell a purge from an accident, and it should not guess. It fails with
`fatal: Not possible to fast-forward, aborting.`, which the deploy workflow
now recognises and reports as such instead of retrying it as a network
fault. The fix, once, as `meabeclick`:

```
sudo -u meabeclick git -C /home/meabeclick/mea-beclick fetch origin
sudo -u meabeclick git -C /home/meabeclick/mea-beclick reset --hard origin/main
```

Run it **as `meabeclick`**, not as root. `ssh mea` lands you on root, and
root in that directory gets `fatal: detected dubious ownership` — which git
is right about. The tempting fix, adding a `safe.directory` exception, would
work once and leave root-owned objects in a tree the deploy user has to
write to afterwards. Dropping to the owner costs nothing and leaves nothing.

The box has no local commits — it only ever reads — so the reset discards
nothing. After it, deploys fast-forward normally again. This happened on
2026-09-22, when student records were purged from history.

### Rollback

Re-pull a previous tag — every image is tagged with its commit SHA, so any
past build stays addressable in GHCR:

```bash
docker pull ghcr.io/lior-nis/meabeclick:<previous-sha>
docker tag ghcr.io/lior-nis/meabeclick:<previous-sha> ghcr.io/lior-nis/meabeclick:latest
docker compose up -d --no-build
```

(`<previous-sha>` is a full commit SHA from `git log` — GitHub Actions'
run history for `deploy.yml` also lists which SHA each successful build
pushed.)

## Backups

A `systemd --user` timer runs `server/backup-db.sh` daily, keeping 14 days in
`~/backups` (override with `BACKUP_DIR`). Install once:

```bash
cp server/meabeclick-backup.service server/meabeclick-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now meabeclick-backup.timer
```

By hand: `bash server/backup-db.sh`.

Each run produces two files:

| file | holds |
|---|---|
| `results-<date>.db` | the database, via `sqlite3 .backup` (a consistent snapshot of a live file, which `cp` is not) |
| `files-<date>.tar.gz` | `portal/`, `games-data/`, `lessons/`, `drafts/` |

### Why both, and what a drill proved

Until 2026-09-08 this backed up `results.db` alone, and a restore drill
showed what that was worth. The database came back perfectly — integrity
`ok`, zero foreign-key violations, every row count matching live — and a
legitimately authorised student's board answered **HTTP 500**, because
`/api/portal/[code]` reads a per-student JSON file that had never been in a
backup. The database records that a student exists; the portal file is what
they see. `drafts/` is worse still: lessons held for review exist nowhere
else at all.

Re-run with both files, the same board answers 200 and serves its content.

Backups also moved out of `data/backups`. They used to sit inside the
directory being backed up, on the same volume, inside the container's own
writable mount — so a bad cutover, an `rm -rf data`, or the app itself could
take the backups with the original. Old copies under `data/backups` are left
alone; delete them once you are happy with `~/backups`.

### Restoring

`server/restore-db.sh` restores into an isolated directory and checks it. It
**never writes to `./data`** — promoting a verified restore into production
is a separate, deliberate act, because overwriting live student records is
the mistake this exists to prevent.

```bash
bash server/restore-db.sh                    # newest -> ./restore-drill
bash server/restore-db.sh 2026-09-08 /tmp/r  # a specific day, elsewhere
```

It runs `integrity_check` and `foreign_key_check`, fails on any violation,
prints counts only (never records), and finishes by printing the `docker run`
that smoke-tests the restore on port 3100 without touching the live stack.

**Run it after any change to what gets backed up, and before any cutover.** A
backup nobody has restored is a hope, not a backup.

### Measured, 2026-09-18 — restored from Drive

The half that had never been done. `server/drive/fetch-backup.mjs` pulled
that morning's backup **back out of Google Drive**, `restore-db.sh` restored
it into a scratch directory, and it was booted on port 3101 against the
image production was running. Production was untouched; the copy, the
container and the downloaded bytes were deleted afterwards.

| | |
|---|---|
| Source | Google Drive, not the local backup |
| `foreign_key_check` | 0 violations |
| File state | portal 6, games-data 21, lessons 3, drafts 1 |
| Boot | clean |
| Portal board for a restored student | **HTTP 200**, name present, 4 homework entries, 5 games |

So "rebuild the box, restore from Drive, carry on" is now a measurement
rather than a claim.

**What it took to get there.** The off-box copy was write-only: the
uploader could put a backup on Drive and nothing in the tree could take one
back. `downloadFile` and `fetch-backup.mjs` are that missing half.

Two traps worth knowing, both of which cost time here:

1. `readConfig()` returns `{ cfg, missing }`. Passing the wrapper straight
   to `accessToken()` sends three undefined credentials, and Google answers
   **401** — indistinguishable from a revoked refresh token. The nightly
   upload was working the whole time.
2. The drill's own smoke-test command used to print
   `ghcr.io/lior-nis/meabeclick:latest`. On a box deployed by commit sha
   for months, `:latest` is whatever was cached long ago — testing a fresh
   restore against ancient code proves nothing. It now reuses the tag
   production is running.

**Still unproven:** every drill so far has run on the same box. Restoring
onto genuinely fresh hardware is the only thing that proves the VPS is
disposable rather than merely backed up.

### Measured, 2026-09-16

A full drill on the live box, restoring that morning's backup into
`/tmp/restore-drill-verify` and booting it on port 3100 against the image
production was running. Production was never touched, and the restored copy
and its container were deleted afterwards.

| | |
|---|---|
| Backup age when restored | under 9 hours (timer fires 00:00; drill ran ~08:50) |
| **RPO** | 24 hours — one backup a day, so up to a day of writes is at risk |
| **RTO** | about 4 minutes of commands, plus the two fixes below |
| `integrity_check` | ok |
| `foreign_key_check` | 0 violations |
| File state restored | portal 6, games-data 21, lessons 3, drafts 1 |
| Boot | clean, after the two fixes |
| Portal board for a restored student | **HTTP 200**, name present, 4 homework entries, 5 games |
| `/api/results`, `/api/students` | 200 |

The database and the file state both came back, and the 2026-09-08 failure
mode — a restored student whose board answered 500 — did not recur.

**Two defects in this runbook, found by running it and fixed in the same
change.** Both stopped the documented smoke test before it could start, which
is exactly how a restore procedure rots: it is written once and never
executed.

1. The printed `docker run` omitted `CALENDAR_ID`, which `boot-checks.ts`
   requires, so the drill container refused to start.
2. A restored `data/` carries the restoring user's ownership, but the
   container runs as uid 1000 and boot-checks demands DATA_DIR be
   **writable**. Production gets this from the setgid arrangement described
   above; a restore does not inherit it.

**Still unproven:** the Google Drive copy has not been restored from — this
drill used the local backup on the same box. A drill that rebuilds from Drive
onto a fresh box is what would actually prove the VPS is disposable.

### Measured, 2026-09-08

- **RPO — up to 24h.** The timer is daily at 00:00 UTC, so a failure at 23:00
  loses the day's writes.
- **RTO — seconds for the data.** Copy plus integrity check measured 21ms on
  a 160KB database; realistic recovery is dominated by provisioning a host,
  not by the restore.
- **Off-box copy: Google Drive**, owned by `mea.beclick@gmail.com`. See
  below. Until it is switched on, both files sit on the same VPS as the
  original and losing the box loses the backups.

### Off-box backups (Google Drive)

Backups upload to Drive at the end of every run, so the VPS becomes
disposable: rebuild the box, restore from Drive, carry on.

**Not the Calendar service account.** A service account has no Drive storage
quota and cannot own files — Google's guidance is a shared drive or OAuth on
behalf of a user, and a shared drive needs Workspace, which a
`@gmail.com` account is not. A service-account upload fails with 403
`storageQuotaExceeded` even into a folder shared with it, because what it
lacks is ownership, not permission. So this authenticates as the business
account itself, and the backups are owned by it — visible in its own Drive,
restorable by a human with no code at all.

Scope is `drive.file`: only files this app creates. It cannot read the rest
of that Drive, so a leaked refresh token exposes the backups it made and
nothing else.

**Setup, once.** Sign into the console as `mea.beclick@gmail.com` throughout
— the account that consents is the account that owns the backups.

1. **Project.** Use the one the Calendar service account already lives in
   (`zeta-instrument-492312-k7`). Same project, so there is one place to
   revoke everything.

2. **Enable the Drive API.** APIs & Services → Library → "Google Drive API"
   → Enable.

3. **OAuth consent screen.** APIs & Services → OAuth consent screen.
   - User type **External** — the only option for a `@gmail.com` account.
   - App name, support email, developer email. Nothing else is required.
   - Scopes: leave empty. The scope is requested at run time, and adding it
     here only affects the verification path.

4. **Publish it.** On the same screen, set publishing status to
   **In production**.

   This step is not optional and it is easy to skip. While the app is in
   **Testing**, Google expires refresh tokens after **seven days** — the
   backups would upload for a week and then stop, quietly, with a 401 in a
   log nobody reads. Publishing does not trigger a verification review here
   because `drive.file` is a non-sensitive scope: it grants access only to
   files this app itself creates.

5. **Create the client.** Credentials → Create credentials → OAuth client ID
   → **Desktop app**. Copy the client ID and secret.

   No redirect URI to fill in: a Desktop client accepts any port on
   `127.0.0.1`, which is what the next step uses.

6. **Consent, once**, on any machine with a browser:

   ```bash
   node server/drive/authorize.mjs <client-id> <client-secret>
   ```

   It opens a local listener, prints a URL, and captures the result when the
   browser returns — there is no code to copy. (Google blocked the
   copy-and-paste "out-of-band" flow in January 2023; anything still
   describing that will fail with `invalid_request`.)

   It prints the three values for `.env` on the VPS — chmod 600, never
   committed.

7. **Run it.** `bash server/backup-db.sh` uploads and prints the folder id.
   Setting `DRIVE_BACKUP_FOLDER_ID` to that skips a lookup on later runs.

To revoke later: myaccount.google.com/permissions, as
`mea.beclick@gmail.com`. Backups already in Drive are unaffected — they are
owned by the account, not by the app.

Retention matches the local copy: anything older than `BACKUP_KEEP_DAYS`
(default 14) is pruned, and only **after** a successful upload, so a failed
run never leaves Drive emptier than it found it.

**It cannot fail the nightly job.** With no credentials configured it says so
and exits 0; if Drive is down or the token is revoked it says that and exits
0. The local backup has already succeeded by then, and a Drive outage marking
the job failed would only train everyone to ignore it.

### Vision metrics

`scripts/vision-metrics.mjs` prints the PRODUCT.md targets (active students,
autogenerated share, last month's revenue, the 10-run gate). It is read-only
and not shipped in the image; pipe it in:

    ssh mea 'docker exec -i $(docker ps -qf name=mea-beclick-app) node --input-type=module -' < scripts/vision-metrics.mjs

## Scheduling: the lesson-report prompt and the booking reminder

Two more `systemd --user` timers, the same shape as the backup timer above:

- `meabeclick-report-prompt.timer` — hourly, `POST /api/reports/prompt`
  (emails the tutor about lessons that finished without a report).
- `meabeclick-remind.timer` — Saturday, `GET /api/remind` (the WhatsApp
  reminder to update the calendar before the booking window opens). This
  route used to run on a Vercel cron and has had no caller at all since
  that cron was deleted — closed by this section.
- `meabeclick-remind-family.timer` — **hourly**, `GET /api/remind-family`
  (emails the FAMILY before a booked lesson). Note the recipient: the
  reminder above goes to the tutor, so until this existed the only people
  nobody reminded were the ones who have to show up.

  Hourly rather than daily because the window is "between 2 and 24 hours
  before the lesson", not an hour of the day — a family booking tomorrow
  morning at 9pm tonight still gets reminded. Running it often is free:
  `UNIQUE (booking_id, kind)` on `lesson_reminders` means a double fire
  sends once, and that constraint IS the idempotency guarantee rather than
  a check some caller has to remember.

- `meabeclick-drive-sync.timer` — **every 10 minutes**, `GET /api/drive-sync`
  (keeps a Google Drive folder per student in step with their lessons, in
  the mea.beclick@gmail.com Drive: «מאה בקליק — תלמידים» / «<name> · <code>» /
  a document per lesson plus an index). A lesson the tutor edits in Drive is
  PUBLISHED to the student once the document has been untouched for 10
  minutes (so about 10–20 minutes after she stops typing), and she gets a
  WhatsApp with the editor link, where earlier versions can be restored.
  The site never overwrites an unsynced Drive edit. Uses the backups' Drive
  login (`GOOGLE_OAUTH_*`); without it the route answers `{ skipped }`.
  Design: `docs/superpowers/specs/2026-09-25-drive-student-folders-design.md`.

These endpoints are reachable from the internet and driven by a timer rather
than a person, so both check a shared secret, `CRON_KEY`, rather than a
session cookie (`src/lib/server/cron-auth.ts`; constant-time, and closed
when the key isn't configured — see `.env.example`). `CRON_KEY` lives in
`.env` too (see the secret-value listing near the top of this file) — the
app reads it from there. The two timers below do NOT read `.env`: they
point at a separate, dedicated `~/mea-beclick/.cron-key.env` holding only
`CRON_KEY=...`, not the app's full secret set. `EnvironmentFile=` puts
every name it loads somewhere `systemctl --user show <unit>` will print,
and a unit that only ever uses `CRON_KEY` has no reason to expose
`ADMIN_PASSWORD`, `SESSION_SECRET` or the Gmail credentials that way —
systemd's env-file parser also differs from dotenv's, so a value docker
accepts happily can make systemd silently skip a line in the full `.env`,
which reads here as an unexplained 401.

Keep both files' `CRON_KEY` in sync — same value, two files, on purpose:

```bash
grep ^CRON_KEY= .env | tee ~/mea-beclick/.cron-key.env
chmod 600 ~/mea-beclick/.cron-key.env
```

**Rotating the key means updating both files and restarting the app** (see
the `.env` section above) — the timers pick up `.cron-key.env` on their
next run automatically, but the app container itself only re-reads `.env`
at `docker compose up -d`.

Install once:

```bash
cp server/meabeclick-*.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now meabeclick-report-prompt.timer meabeclick-remind.timer meabeclick-remind-family.timer
systemctl --user list-timers
```

## Not done yet

- NotebookLM browser automation
