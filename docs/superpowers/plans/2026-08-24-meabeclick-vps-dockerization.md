# Dockerize & Cut Over meabeclick on the Hostinger VPS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live meabeclick site from an ad-hoc, unencrypted, `claw`-owned deployment to an isolated `meabeclick` user running a `docker compose` stack (app + Caddy) that actually serves `https://meabeclick.com`.

**Architecture:** `docker compose` on the VPS runs two services on a private network: `app` (Node 22 + the app + the Claude Code CLI, not published to the host) and `caddy` (TLS termination + reverse proxy, the only thing bound to 80/443). SQLite data, generated lesson content, and the two git-tracked-but-runtime-mutable directories (`portal/`, `games/data/`) are host bind-mounts so they survive image rebuilds.

**Tech Stack:** Docker Engine + Compose v2, Node 22 (`node:22-slim`), `caddy:2-alpine`, systemd (`--user` units for the app's own backup timer — Docker's restart policy handles the app/Caddy containers themselves), `ufw`.

**Spec:** `docs/superpowers/specs/2026-08-24-meabeclick-vps-dockerization-design.md`

## Global Constraints

- Target host: SSH alias `mea` (`76.13.59.4`, root access), Ubuntu 24.04.
- No active users on the site right now — a hard cutover (stop old, start new) is acceptable. No blue-green needed.
- `claw`'s other services on this box (Obsidian vault, other repos, `openclaw-gateway`) must not be touched or broken.
- Secrets never get baked into a Docker image layer — always injected via `env_file` at container-start time.
- The app's `DB_PATH` default (`./data/results.db`, relative to `process.cwd()`) and `lesson-queue.mjs`'s `SITE_ROOT = process.cwd()` mean the container's `WORKDIR` must be `/app` and bind mounts must line up with that — `./data:/app/data`, `./lessons:/app/lessons`, `./portal:/app/portal`, `./games/data:/app/games/data`.
- `portal/*.json` and `games/data/*.json` are **git-tracked** (not gitignored) but also written at runtime by `lesson-queue.mjs` when a lesson auto-generates. Bind-mounting them (rather than only baking them into the image) is required so runtime writes aren't lost on the next `docker compose up -d --build`. This also means a future `git pull` on the VPS could, in principle, race a manual edit to the same file pushed from a laptop — worth documenting, not worth solving today (YAGNI, low-traffic two-person site).
- `server/app.mjs` dynamically `import()`s `../api/*.js` at runtime — the `api/` directory must ship inside the image (do not `.dockerignore` it).
- `ufw` changes must never be able to lock out SSH — always `allow OpenSSH` before `enable`.

---

## Task 1: Dockerfile, .dockerignore, docker-compose.yml, and the Caddyfile update

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Modify: `server/Caddyfile`

**Interfaces:**
- Produces: an image buildable as `docker compose build`, tagged `meabeclick-app`, exposing port `8080` inside the compose network only (not published to the host). `docker-compose.yml` defines services `app` and `caddy` and volumes `caddy_data`, `caddy_config`.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

RUN npm install -g @anthropic-ai/claude-code

COPY . .
RUN chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "server/app.mjs"]
```

- [ ] **Step 2: Write `.dockerignore`**

```
.git
.claude
.superpowers
docs
mea-beclick-kb
marketing
scripts
vps
node_modules
data
lessons
.vercel
.vercelignore
.env
*.md
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    image: meabeclick-app
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
      - ./lessons:/app/lessons
      - ./portal:/app/portal
      - ./games/data:/app/games/data
    networks:
      - internal

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./server/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - internal

networks:
  internal:

volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 4: Update `server/Caddyfile`**

Replace the file's contents with:

```
# Caddy runs as the "caddy" service in docker-compose.yml — this file is
# bind-mounted read-only into it. Caddy gets and renews the Let's Encrypt
# certificate automatically; no host-level Caddy install needed.

meabeclick.com, www.meabeclick.com {
	encode zstd gzip
	reverse_proxy app:8080

	# The app sets HttpOnly/SameSite on the session cookie; Secure is set from
	# req.secure, which works because the app trusts this proxy's headers.
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options    "nosniff"
		X-Frame-Options           "SAMEORIGIN"
		Referrer-Policy           "strict-origin-when-cross-origin"
		-Server
	}

	log {
		output stdout
		format console
	}
}
```

(`output stdout` instead of the old `output file /var/log/caddy/...` — a file path inside the container isn't persisted across recreates; stdout goes through Docker's own log driver, inspectable with `docker compose logs caddy`.)

- [ ] **Step 5: Validate the compose file and Dockerfile build syntactically**

Run (from the repo root, wherever Docker is available — locally if installed, otherwise this step repeats as part of Task 7 on the VPS where it must succeed regardless):

```bash
docker compose config -q && echo "compose file OK"
docker build -t meabeclick-app:test .
```

Expected: `compose file OK` printed, and the build finishes with `naming to docker.io/library/meabeclick-app:test` and exit code 0. If Docker isn't available in this environment, note that and defer verification to Task 7 — do not skip silently.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml server/Caddyfile
git commit -m "Add Docker Compose deployment: app + Caddy stack"
```

---

## Task 2: Backup automation files

**Files:**
- Create: `server/backup-db.sh`
- Create: `server/meabeclick-backup.service`
- Create: `server/meabeclick-backup.timer`

**Interfaces:**
- Consumes: none.
- Produces: a script and systemd `--user` unit pair that Task 11 installs on the VPS. Assumes `sqlite3` CLI is on the host `PATH` (installed in Task 4) and is run with `WorkingDirectory` set to the app's repo checkout, where `data/results.db` is the bind-mounted path shared with the `app` container.

- [ ] **Step 1: Write `server/backup-db.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/backups
sqlite3 data/results.db ".backup 'data/backups/results-$(date +%F).db'"
find data/backups -type f -mtime +14 -delete
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x server/backup-db.sh
```

- [ ] **Step 3: Write `server/meabeclick-backup.service`**

```
# User-level unit — installs with NO sudo, same pattern as
# maabeclick-web.service:
#   cp server/meabeclick-backup.service server/meabeclick-backup.timer \
#     ~/.config/systemd/user/
#   systemctl --user daemon-reload
#   systemctl --user enable --now meabeclick-backup.timer

[Unit]
Description=מאה בקליק — daily SQLite backup

[Service]
Type=oneshot
WorkingDirectory=%h/mea-beclick
ExecStart=/bin/bash server/backup-db.sh
```

- [ ] **Step 4: Write `server/meabeclick-backup.timer`**

```
[Unit]
Description=Run מאה בקליק DB backup daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Verify the script's logic locally (dry run without a real DB)**

```bash
mkdir -p /tmp/backup-test/data && cd /tmp/backup-test
cp /home/liornisimov/Projects/mea-beclick/server/backup-db.sh server/backup-db.sh 2>/dev/null || { mkdir -p server; cp /home/liornisimov/Projects/mea-beclick/server/backup-db.sh server/; }
sqlite3 data/results.db "CREATE TABLE t(x);" 2>&1 || echo "sqlite3 not installed locally — this step only proves script syntax, real verification happens on the VPS in Task 11"
bash -n server/backup-db.sh && echo "syntax OK"
cd /home/liornisimov/Projects/mea-beclick && rm -rf /tmp/backup-test
```

Expected: `syntax OK` at minimum; the `CREATE TABLE`/backup round-trip only if `sqlite3` happens to be installed locally.

- [ ] **Step 6: Commit**

```bash
git add server/backup-db.sh server/meabeclick-backup.service server/meabeclick-backup.timer
git commit -m "Add automated daily SQLite backup timer"
```

---

## Task 3: Rewrite server/README.md for the Docker-based deployment

**Files:**
- Modify: `server/README.md` (full replacement of the "Install" through "Backups" sections; the "Not done yet" section stays as-is at the end)

**Interfaces:**
- Consumes: the exact commands from Tasks 4–11 below (this doc is the human-facing summary of the runbook those tasks execute).
- Produces: nothing consumed by later tasks — this is the terminal documentation artifact.

- [ ] **Step 1: Replace the file's content from the top through the old "Backups" section**

```markdown
# Self-hosted server — Docker Compose

One Node process serves the static site *and* the API, in a container. Caddy
(also containerized) terminates TLS and reverse-proxies to it.

```
browser ──HTTPS──> Caddy container :443 ──> app container :8080 ──> SQLite
                   (auto TLS)                (this app)              (bind-mounted)
```

## Isolation

Runs under a dedicated `meabeclick` system user — not a personal/shared
account. That user's only jobs are: hold the git checkout, run
`docker compose`, and run the daily backup timer.

## Install (as the meabeclick user, once)

```bash
git clone git@github.com:Lior-Nis/mea-beclick.git ~/mea-beclick
cd ~/mea-beclick
```

Create `.env` (chmod 600) — same variables as before, values are per-deployment
secrets so they're never committed:

```
PORT=8080
DB_PATH=/app/data/results.db
ADMIN_PASSWORD=<your dashboard password>
SESSION_SECRET=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<key, still needed by /api/ask>
CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`>
CALLMEBOT_API_KEY=<key, needed for lesson-generation WhatsApp notifications>
```

`CLAUDE_BIN` is no longer needed — the Claude Code CLI is installed globally
in the app image, so `claude` is already on `PATH` inside the container.

```bash
docker compose up -d --build
curl -s localhost:8080/api/me   # from inside the box, or docker compose exec app curl ...
```

## Data & generated content

Four host directories are bind-mounted into the `app` container so nothing
generated at runtime is lost on the next `docker compose up -d --build`:

- `./data` — SQLite DB + daily backups
- `./lessons` — generated lesson slides (gitignored)
- `./portal` — per-student portal JSON (git-tracked, but also written at
  runtime by lesson generation)
- `./games/data` — per-lesson game JSON (git-tracked, same situation)

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
docker compose up -d --build   # after a git pull, to redeploy
```

## Backups

Automated: a `systemd --user` timer runs `server/backup-db.sh` daily,
keeping the last 14 days in `./data/backups/`. Install once:

```bash
cp server/meabeclick-backup.service server/meabeclick-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now meabeclick-backup.timer
```

To back up by hand: `bash server/backup-db.sh`.
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "Rewrite server/README.md for the Docker Compose deployment"
```

---

## Task 4: Provision the `meabeclick` user and Docker Engine on the VPS

**Files:** none (VPS system state only).

**Interfaces:**
- Consumes: root SSH access to `mea` (`76.13.59.4`).
- Produces: a `meabeclick` system user in the `docker` group, Docker Engine + Compose v2 installed, `sqlite3` CLI installed (needed by Task 2's backup script). Task 5 consumes this user.

- [ ] **Step 1: Create the `meabeclick` user**

```bash
ssh mea 'useradd --create-home --shell /bin/bash meabeclick'
```

Expected: no output, exit code 0.

- [ ] **Step 2: Verify the user exists**

```bash
ssh mea 'id meabeclick'
```

Expected: prints `uid=...(meabeclick) gid=...(meabeclick) groups=...(meabeclick)`.

- [ ] **Step 3: Install Docker Engine (official convenience script) and sqlite3**

```bash
ssh mea 'curl -fsSL https://get.docker.com | sh && apt-get install -y sqlite3'
```

Expected: script completes with Docker installed; `apt-get install` reports `sqlite3` installed or already the newest version.

- [ ] **Step 4: Add `meabeclick` to the `docker` group and enable Docker at boot**

```bash
ssh mea 'usermod -aG docker meabeclick && systemctl enable --now docker'
```

- [ ] **Step 5: Verify Docker and Compose work as the new user**

```bash
ssh mea 'sudo -iu meabeclick docker run --rm hello-world'
ssh mea 'sudo -iu meabeclick docker compose version'
```

Expected: `hello-world` prints its "Hello from Docker!" message; `docker compose version` prints a `v2.x` version string. If `hello-world` fails with a permission error, the group membership from Step 4 hasn't taken effect in the current login session — re-run via `sudo -iu meabeclick` (a fresh login shell) rather than `su meabeclick`, which is what the command above already does.

(No git commit — this task only changes VPS system state.)

---

## Task 5: Deploy key and repo checkout

**Files:** none (VPS + GitHub state only).

**Interfaces:**
- Consumes: the `meabeclick` user from Task 4; local `gh` CLI authenticated against the `Lior-Nis/mea-beclick` GitHub repo.
- Produces: `/home/meabeclick/mea-beclick`, a git checkout of `main` at the commit that includes Tasks 1–3. Task 6 consumes this checkout path.

- [ ] **Step 1: Generate a deploy-only SSH keypair as `meabeclick`**

```bash
ssh mea "sudo -iu meabeclick ssh-keygen -t ed25519 -C 'meabeclick-vps-deploy' -f /home/meabeclick/.ssh/id_ed25519 -N ''"
```

Expected: prints the key fingerprint and randomart; no passphrase prompt (empty passphrase supplied via `-N ''`, appropriate for an unattended deploy key).

- [ ] **Step 2: Fetch the public key and register it as a read-only GitHub deploy key**

```bash
ssh mea "cat /home/meabeclick/.ssh/id_ed25519.pub" > /tmp/meabeclick-deploy-key.pub
gh repo deploy-key add /tmp/meabeclick-deploy-key.pub --repo Lior-Nis/mea-beclick --title "meabeclick-vps (read-only)"
rm /tmp/meabeclick-deploy-key.pub
```

Expected: `gh` prints confirmation the deploy key was added. (This key is read-only by default — `gh repo deploy-key add` only grants write with an explicit `--allow-write` flag, which we do not pass.)

- [ ] **Step 3: Clone the repo as `meabeclick`**

```bash
ssh mea "sudo -iu meabeclick bash -c 'ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null; git clone git@github.com:Lior-Nis/mea-beclick.git ~/mea-beclick'"
```

Expected: `Cloning into '/home/meabeclick/mea-beclick'...` followed by a successful checkout (no `Permission denied (publickey)` — that would mean Step 2's deploy key didn't register correctly).

- [ ] **Step 4: Verify the checkout has today's Docker files**

```bash
ssh mea "sudo -iu meabeclick ls /home/meabeclick/mea-beclick/Dockerfile /home/meabeclick/mea-beclick/docker-compose.yml"
```

Expected: both paths printed, no "No such file" error.

(No git commit — this task only changes VPS + GitHub state.)

---

## Task 6: Migrate secrets and data from `claw` to `meabeclick`

**Files:** none (VPS state only — copies real secrets/data, must not be committed anywhere).

**Interfaces:**
- Consumes: `/home/meabeclick/mea-beclick` from Task 5; the existing `/home/claw/maabeclick-web/.env` and `/home/claw/maabeclick-web/data/` on the VPS.
- Produces: `/home/meabeclick/mea-beclick/.env` (mode 600, owned by `meabeclick`) and `/home/meabeclick/mea-beclick/data/results.db` (+ existing `.bak-*` file), plus `portal/` and `games/data/` re-owned — all three data directories owned by numeric UID/GID `1000` to match the container's `node` user, not by `meabeclick`. Task 7 consumes all of it.

- [ ] **Step 1: Read the current secret values (without printing them to this session's transcript any more than necessary)**

```bash
ssh mea "cat /home/claw/maabeclick-web/.env" > /tmp/claw-meabeclick.env
```

This lands the file locally in `/tmp` only long enough to build the new one — treat it as sensitive, delete it in Step 4.

- [ ] **Step 2: Build the new `.env` on the VPS**

Generate a fresh session secret and write the new file directly on the box (values other than `SESSION_SECRET` and `DB_PATH` are carried over from the old file read in Step 1 — copy them in manually when running this, since they're real secrets that shouldn't be echoed through extra shell hops):

```bash
ssh mea "sudo -iu meabeclick bash -c 'umask 077; cat > ~/mea-beclick/.env'" <<EOF
PORT=8080
DB_PATH=/app/data/results.db
ADMIN_PASSWORD=<copy from /tmp/claw-meabeclick.env>
SESSION_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=<copy from /tmp/claw-meabeclick.env>
CLAUDE_CODE_OAUTH_TOKEN=<copy from /tmp/claw-meabeclick.env>
CALLMEBOT_API_KEY=<copy from /tmp/claw-meabeclick.env>
EOF
```

The executor running this task fills in the four `<copy from ...>` placeholders with the actual values read in Step 1 before running the command — those values are real production secrets and are deliberately not written into this plan document itself.

- [ ] **Step 3: Verify `.env` permissions**

```bash
ssh mea "sudo -iu meabeclick stat -c '%a %U %n' /home/meabeclick/mea-beclick/.env"
```

Expected: `600 meabeclick /home/meabeclick/mea-beclick/.env`.

- [ ] **Step 4: Delete the local temp copy of the old `.env`**

```bash
rm /tmp/claw-meabeclick.env
```

- [ ] **Step 5: Migrate the database via `.backup` (not `cp`, to avoid a torn copy while `claw`'s service may still be writing)**

```bash
ssh mea "mkdir -p /home/meabeclick/mea-beclick/data && sqlite3 /home/claw/maabeclick-web/data/results.db \".backup '/home/meabeclick/mea-beclick/data/results.db'\" && cp /home/claw/maabeclick-web/data/results.db.bak-20260818 /home/meabeclick/mea-beclick/data/"
```

- [ ] **Step 6: Fix ownership for the container's UID, not the host user's UID**

The `app` container runs as the `node:22-slim` image's built-in `node` user, which is always UID/GID `1000` — regardless of what UID the `meabeclick` host account itself got assigned (likely *not* 1000, since Ubuntu cloud images typically give the first login user, `ubuntu`, UID 1000 already). Bind mounts map by raw UID number, not username, so the directories the container needs to *write* to must be owned by numeric `1000:1000` on the host, not by `meabeclick:meabeclick`. This applies to `data/` (migrated just now) and also to `portal/` and `games/data/` (present from the Task 5 git clone, currently owned by whatever `meabeclick`'s real UID is):

```bash
ssh mea "chown -R 1000:1000 /home/meabeclick/mea-beclick/data /home/meabeclick/mea-beclick/portal /home/meabeclick/mea-beclick/games/data"
```

- [ ] **Step 7: Verify the migrated DB has the same row counts as the source**

```bash
ssh mea "sqlite3 /home/claw/maabeclick-web/data/results.db 'SELECT COUNT(*) FROM results;'"
ssh mea "sqlite3 /home/meabeclick/mea-beclick/data/results.db 'SELECT COUNT(*) FROM results;'"
```

Expected: both commands print the same number.

(No git commit — this task only migrates VPS-local secrets and data.)

---

## Task 7: Build and smoke-test the stack (no live traffic yet)

**Files:** none.

**Interfaces:**
- Consumes: the checkout + `.env` + data from Tasks 5–6.
- Produces: a running `app` container, verified healthy directly, before Caddy or the real domain are involved. Task 8 consumes this verified image.

- [ ] **Step 1: Build the app image**

```bash
ssh mea "sudo -iu meabeclick bash -c 'cd ~/mea-beclick && docker compose build app'"
```

Expected: build completes, ends with the image tagged `meabeclick-app`.

- [ ] **Step 2: Start only the `app` service, temporarily publishing its port for a direct check (bypassing Caddy for now)**

```bash
ssh mea "sudo -iu meabeclick bash -c 'cd ~/mea-beclick && docker compose run --rm -d -p 18080:8080 --name meabeclick-smoketest app'"
```

- [ ] **Step 3: Verify the app responds and reads the migrated DB correctly**

```bash
ssh mea "curl -s -o /dev/null -w '%{http_code}\n' http://localhost:18080/"
ssh mea "curl -s http://localhost:18080/api/me"
```

Expected: first command prints `200`; second prints a JSON response (not a 500 or connection error) — confirms the app started, found its `.env`, and can open the bind-mounted SQLite file.

- [ ] **Step 4: Tear down the smoke-test container**

```bash
ssh mea "docker rm -f meabeclick-smoketest"
```

(No git commit — this task only runs a temporary verification container.)

---

## Task 8: Cut over — bring up the full stack behind Caddy on the real domain

**Files:** none.

**Interfaces:**
- Consumes: the verified image from Task 7.
- Produces: `https://meabeclick.com` and `https://www.meabeclick.com` served by the new stack. Task 10 (decommission) depends on this being confirmed first.

- [ ] **Step 1: Bring up the full stack**

```bash
ssh mea "sudo -iu meabeclick bash -c 'cd ~/mea-beclick && docker compose up -d'"
```

- [ ] **Step 2: Confirm both containers are running**

```bash
ssh mea "sudo -iu meabeclick docker compose -f /home/meabeclick/mea-beclick/docker-compose.yml ps"
```

Expected: both `app` and `caddy` show state `running`.

- [ ] **Step 3: Watch Caddy's logs for the ACME certificate issuance**

```bash
ssh mea "sudo -iu meabeclick docker compose -f /home/meabeclick/mea-beclick/docker-compose.yml logs caddy --tail 50"
```

Expected: log lines showing certificate obtained for `meabeclick.com` and `www.meabeclick.com`. If instead there are repeated timeout/connection errors on the ACME HTTP-01 challenge, that's the Hostinger hPanel firewall question flagged in the spec (§3/§11) surfacing for real — stop here and resolve that with the user rather than proceeding to Task 10's decommission step with a broken cutover.

- [ ] **Step 4: Verify from outside the VPS**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://meabeclick.com/
curl -s -o /dev/null -w '%{http_code}\n' https://www.meabeclick.com/
```

Expected: both print `200`.

(No git commit.)

---

## Task 9: Enable the firewall

**Files:** none.

**Interfaces:**
- Consumes: nothing new.
- Produces: `ufw` active, default-deny incoming, SSH/HTTP/HTTPS allowed.

- [ ] **Step 1: Allow SSH first — always before enabling**

```bash
ssh mea "ufw allow OpenSSH"
```

- [ ] **Step 2: Allow HTTP and HTTPS**

```bash
ssh mea "ufw allow 80,443/tcp"
```

- [ ] **Step 3: Enable ufw**

```bash
ssh mea "ufw --force enable"
```

(`--force` skips the interactive "commands will disrupt existing ssh connections" prompt, which would otherwise hang a non-interactive SSH session — safe here specifically because Step 1 already allowed SSH.)

- [ ] **Step 4: Verify the rule set**

```bash
ssh mea "ufw status verbose"
```

Expected: `Status: active`, with `22/tcp (OpenSSH)` and `80,443/tcp` both `ALLOW IN`, default policy `deny (incoming)`.

- [ ] **Step 5: Confirm SSH is still reachable from a fresh connection (not the one used to enable ufw)**

```bash
ssh -o ControlPath=none mea "echo still connected"
```

Expected: prints `still connected`. This must be a genuinely new connection attempt (the `ControlPath=none` override bypasses any cached SSH multiplexed connection) — the whole point of Step 1 was to make sure this still works.

- [ ] **Step 6: Re-verify the site is still reachable through the new firewall rules**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://meabeclick.com/
```

Expected: `200`.

(No git commit.)

---

## Task 10: Decommission the legacy `claw`-owned services

**Files:** none.

**Interfaces:**
- Consumes: Task 8's confirmed-working cutover (do not run this task until Task 8's Step 4 passed).
- Produces: `claw`'s two old systemd `--user` units stopped and disabled; the old checkout renamed (not deleted) as a rollback path.

- [ ] **Step 1: Stop and disable the legacy results-proxy (port 8787)**

```bash
ssh mea "sudo -u claw XDG_RUNTIME_DIR=/run/user/\$(id -u claw) systemctl --user stop maabeclick.service"
ssh mea "sudo -u claw XDG_RUNTIME_DIR=/run/user/\$(id -u claw) systemctl --user disable maabeclick.service"
```

- [ ] **Step 2: Stop and disable the old web app (port 8080)**

```bash
ssh mea "sudo -u claw XDG_RUNTIME_DIR=/run/user/\$(id -u claw) systemctl --user stop maabeclick-web.service"
ssh mea "sudo -u claw XDG_RUNTIME_DIR=/run/user/\$(id -u claw) systemctl --user disable maabeclick-web.service"
```

- [ ] **Step 3: Verify neither legacy port is listening any more**

```bash
ssh mea "ss -tlnp | grep -E ':(8080|8787) ' || echo 'no legacy listeners — good'"
```

Expected: `no legacy listeners — good` (the new `app` container's 8080 is on the internal Docker network only, not published to the host, so it correctly does not show up here either).

- [ ] **Step 4: Rename the old checkout as a rollback path (do not delete yet)**

```bash
ssh mea "mv /home/claw/maabeclick-web /home/claw/maabeclick-web.bak-2026-08-24"
```

- [ ] **Step 5: Re-verify the live site one more time after decommissioning**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://meabeclick.com/
```

Expected: `200` — confirms the site's continued availability depends only on the new stack now, not on anything still running under `claw`.

(No git commit.)

---

## Task 11: Install and enable the backup timer

**Files:** none.

**Interfaces:**
- Consumes: `server/backup-db.sh` + unit files from Task 2, already present in the Task 5 checkout; `sqlite3` installed in Task 4.

- [ ] **Step 1: Install the units**

```bash
ssh mea "sudo -iu meabeclick bash -c 'mkdir -p ~/.config/systemd/user && cp ~/mea-beclick/server/meabeclick-backup.service ~/mea-beclick/server/meabeclick-backup.timer ~/.config/systemd/user/'"
```

- [ ] **Step 2: Enable lingering so the timer runs even when `meabeclick` isn't logged in**

```bash
ssh mea "loginctl enable-linger meabeclick"
```

- [ ] **Step 3: Reload and enable the timer**

```bash
ssh mea "sudo -iu meabeclick XDG_RUNTIME_DIR=/run/user/\$(id -u meabeclick) systemctl --user daemon-reload"
ssh mea "sudo -iu meabeclick XDG_RUNTIME_DIR=/run/user/\$(id -u meabeclick) systemctl --user enable --now meabeclick-backup.timer"
```

- [ ] **Step 4: Verify the timer is scheduled**

```bash
ssh mea "sudo -iu meabeclick XDG_RUNTIME_DIR=/run/user/\$(id -u meabeclick) systemctl --user list-timers meabeclick-backup.timer"
```

Expected: shows a `NEXT` run time within the next 24 hours.

- [ ] **Step 5: Run the backup once by hand to confirm it actually works end-to-end**

```bash
ssh mea "sudo -iu meabeclick bash -c 'cd ~/mea-beclick && bash server/backup-db.sh && ls data/backups/'"
```

Expected: lists a file named `results-<today's date>.db`.

(No git commit.)

---

## Task 12: Final end-to-end verification

**Files:** none.

**Interfaces:**
- Consumes: everything from Tasks 1–11.

- [ ] **Step 1: Confirm HTTPS on both hostnames**

```bash
curl -sI https://meabeclick.com/ | head -1
curl -sI https://www.meabeclick.com/ | head -1
```

Expected: both `HTTP/2 200`.

- [ ] **Step 2: Confirm the dashboard login still works end-to-end (manual check)**

Open `https://meabeclick.com/login.html` in a browser, log in with the tutor password from the new `.env`, confirm the dashboard loads and shows the migrated students/results.

- [ ] **Step 3: Confirm containers restart cleanly on their own**

```bash
ssh mea "sudo -iu meabeclick bash -c 'cd ~/mea-beclick && docker compose restart'"
sleep 5
curl -s -o /dev/null -w '%{http_code}\n' https://meabeclick.com/
```

Expected: `200` after the restart.

- [ ] **Step 4: Confirm `claw`'s unrelated services are unaffected**

```bash
ssh mea "sudo -u claw XDG_RUNTIME_DIR=/run/user/\$(id -u claw) systemctl --user status openclaw-gateway.service --no-pager | head -5"
```

Expected: still `active (running)`, untouched by anything in this plan.

- [ ] **Step 5: Update the Todoist p2 task**

```bash
td task complete "לתקן: הדומיין meabeclick.com לא מחובר — רשומות DNS לא מצביעות ל-VPS"
```

If the exact task text doesn't match (Todoist fuzzy-matches by name), use `td task list --project MeaBeclick` first to find the right reference, then complete it — don't guess an `id:` without confirming.
