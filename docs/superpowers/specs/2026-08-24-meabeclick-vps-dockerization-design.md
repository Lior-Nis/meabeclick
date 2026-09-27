# Design — Dockerize & properly deploy meabeclick on the Hostinger VPS

Status: approved, ready for implementation plan
Origin: Todoist MeaBeclick p2 — "הדומיין meabeclick.com לא מחובר — DNS לא מצביע ל-VPS"

## 1. Context

The p2 ticket assumed the domain wasn't pointing at the VPS. Investigation
(read-only SSH recon, 2026-08-24) found that's already fixed — `meabeclick.com`
and `www.meabeclick.com` both resolve to `76.13.59.4` (the Hostinger VPS,
Ubuntu 24.04, SSH alias `mea`, root access).

What's actually broken:

- Nothing listens on ports 80/443 on the box at all — no Caddy, no nginx, no
  Docker. `https://meabeclick.com` and `http://meabeclick.com` both time out.
- The live app (`server/app.mjs`) is reachable only via
  `http://76.13.59.4:8080` directly — unencrypted, bound to `0.0.0.0`, open to
  the whole internet.
- Everything runs under a general-purpose personal user, `claw`, which also
  hosts unrelated stuff (an Obsidian vault, other repos, `tutor-agent`, and
  Nix's own `openclaw-gateway` service — the last bound to `127.0.0.1` only,
  low collision risk). Two `systemd --user` units run directly under `claw`:
  `maabeclick-web.service` (current app, port 8080) and the legacy
  `maabeclick.service` (old `vps/server.mjs` results-proxy, port 8787 —
  already flagged as superseded in `mea-beclick-kb/notes/Architecture
  Overview.md`).
- `iptables` is fully open (`ACCEPT` on every chain) — no host firewall.
- A `.vercel/project.json` link is still present from the pre-migration
  Vercel setup (separate, already-known p2 item).
- A real SQLite DB with student data (`results.db`, 49KB) and a stale manual
  backup (`results.db.bak-20260818`) live under `claw`'s home dir and must
  survive the migration.

No one is actively using the site right now, so a hard cutover (stop old,
start new) is acceptable — no blue-green dance required.

## 2. Goals

1. Dedicated, isolated `meabeclick` system user — not `claw` — owning a
   Dockerized deployment.
2. `docker compose` stack: `app` (Node + bundled Claude Code CLI) + `caddy`
   (TLS termination, reverse proxy), on a private Compose network. `app`
   never publishes its port to the host.
3. `meabeclick.com` / `www.meabeclick.com` actually served over HTTPS.
4. Student data (SQLite) and secrets migrated intact, never baked into an
   image layer.
5. Legacy service (port 8787) and `.vercel` link decommissioned.
6. Host firewall (`ufw`) enabled: SSH + 80/443 only.
7. Automated daily DB backup (replacing the manual `sqlite3 .backup` step in
   `server/README.md`).
8. A repeatable deploy workflow (`git pull && docker compose up -d --build`)
   replacing the old rsync-based one.

## 3. Non-goals

- Migrating `claw`'s other services off this box — it stays shared.
- CI/CD pipeline — solo/duo operator, manual deploy is fine (YAGNI).
- Fixing the p1 lesson-generation bug or any other PRD item — out of scope
  for this task, though this work directly enables answering the PRD's
  "is `ANTHROPIC_API_KEY` set on the live VPS?" open question as a side
  effect once the new `.env` is in place.
- Opening ports in Hostinger's hPanel cloud firewall — deferred; flagged as
  a likely-required manual step (80/443 currently time out, not "connection
  refused", which smells like an edge firewall separate from the host).
  Revisit when we hit cutover/verification.
- Rootless Docker / gVisor / extra container sandboxing — standard
  `docker` group membership for the `meabeclick` user is an accepted
  trade-off for a single-purpose deploy user on an otherwise low-traffic box.

## 4. Architecture

```
Internet ──80/443──> [caddy container] ──reverse_proxy──> [app container:8080]
                            │                                    │
                     caddy_data volume                    bind-mounts:
                     (ACME/TLS state,                       ./data (SQLite)
                      persists across                       ./lessons (generated)
                      restarts)                              ./.env (secrets, 600)
```

- **`meabeclick` user**: new system user, home `/home/meabeclick`, member of
  the `docker` group.
- **Repo**: cloned (not rsynced) to `/home/meabeclick/mea-beclick`, via a
  read-only deploy key scoped to this repo (not Lior's personal key).
- **`app` image**: `node:22-slim` (matches the VPS's installed Node 22.22),
  `npm ci --omit=dev`, `npm install -g @anthropic-ai/claude-code`, runs as
  the image's built-in unprivileged `node` user, `EXPOSE 8080`. Does not
  publish to the host — only reachable from the `caddy` container via the
  Compose network, by service name (`app:8080`).
- **`caddy` image**: `caddy:2-alpine`, mounts `server/Caddyfile` with one
  line changed (`reverse_proxy 127.0.0.1:8080` → `reverse_proxy app:8080`;
  everything else — HSTS, security headers, access log — unchanged). Named
  volumes `caddy_data` / `caddy_config` so Let's Encrypt certs survive
  rebuilds.
- **Data**: `./data` (SQLite + backups) and `./lessons` (generated lesson
  content) bind-mounted into the `app` container at the paths `DB_PATH` and
  the lesson-gen code already expect. No app code changes needed.

## 5. Secrets & data migration

- New `.env` at `/home/meabeclick/mea-beclick/.env`, mode `600`, passed to
  the `app` container via Compose `env_file:` — never baked into the image.
- `SESSION_SECRET` regenerated (`openssl rand -hex 32`) for the new
  deployment. `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`,
  `CALLMEBOT_API_KEY`, `ADMIN_PASSWORD` copied over unchanged (tied to
  external accounts, not this box).
- `results.db` migrated via `sqlite3 <src> ".backup '<dst>'"` (not `cp`, to
  avoid a torn copy while the old service might still be writing), then
  `chown`'d to `meabeclick`. The existing `.bak-20260818` file comes along
  too. `lessons/` starts empty under the new user (lesson-gen is the known
  p1 bug; nothing worth migrating there yet).

## 6. Decommission

- Stop + disable `claw`'s `systemd --user` units: `maabeclick-web.service`
  (8080) and `maabeclick.service` (8787, legacy `vps/server.mjs`).
- Rename `/home/claw/maabeclick-web` → `maabeclick-web.bak-2026-08-24`
  (not deleted outright) — a no-cost rollback path; Lior deletes it later
  once the new stack is confirmed solid.
- `.vercel/` is simply absent from the new checkout; the old one sits inert
  in the renamed backup dir.

## 7. Firewall

`ufw allow OpenSSH`, then `ufw allow 80,443/tcp`, then `ufw enable` — in
that exact order, so SSH access is never at risk during the change.
Confirmed safe against existing services: `openclaw-gateway`'s ports
(18789/18791/18792) are bound to `127.0.0.1` only, unaffected by `ufw`
filtering inbound traffic on the public interface.

## 8. Backups

A `systemd --user` timer under `meabeclick` runs
`sqlite3 ... ".backup '...'"` daily into `./data/backups/`, pruning backups
older than 14 days. Same command the current README already documents as a
manual step — this just removes the "someone has to remember" failure mode.

## 9. Deploy workflow

```
ssh mea
sudo -iu meabeclick
cd mea-beclick && git pull && docker compose up -d --build
```

No CI/CD (non-goal — see §3).

## 10. Testing / verification plan

- Bring the new stack up on the VPS with Caddy's site block still pointed at
  a throwaway hostname or via direct container port mapping first, confirm
  the app serves correctly and the DB round-trips, *before* touching the
  live Caddyfile domain block or stopping `claw`'s services.
- Once verified, flip the Caddyfile to the real domain, `docker compose up
  -d`, confirm `https://meabeclick.com` and `https://www.meabeclick.com`
  both serve with a valid cert (subject to the Hostinger hPanel firewall
  question in §3 being resolved).
- Only then decommission `claw`'s old services (§6).
- Confirm `ufw status` shows the expected allow rules and that SSH is still
  reachable (test in a *second* terminal before closing the first) before
  declaring the firewall step done.

## 11. Open items carried forward (not blocking this work)

- Hostinger hPanel firewall for 80/443 — likely needs manual action in the
  web console; revisit at cutover.
- PRD open question: is `ANTHROPIC_API_KEY` actually set correctly in the
  new `.env`? This work answers it as a side effect (values are copied
  1:1 from the current `.env`), but debugging the p1 lesson-gen pipeline
  itself is a separate task.
