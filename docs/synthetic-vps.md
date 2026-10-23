# Isolated synthetic VPS environment

This stack is for UX and release testing with fictional data only. It does not deploy, restart, stop, or inspect the production stack. It has a separate fixed Compose project, image, internal network, named volume, database, port, and deterministic seed.

## Safety design

- Compose project: `meabeclick-synthetic` (production is `mea-beclick`).
- Container names are project-prefixed (`meabeclick-synthetic-*`), not shared with production.
- Image: local-only `meabeclick-synthetic:local`; it never pulls or tags the production GHCR image.
- Network: the app and seeder use `meabeclick-synthetic_synthetic_internal` with `internal: true`, so they have no external route. A fixed-target Node gateway joins that network and a separate access bridge only to make Docker's loopback port publishing work; it has no credentials, data volume, shell-configurable target, or application command.
- Data: named volume `meabeclick-synthetic_synthetic_data`, mounted only at `/synthetic-data`; database `/synthetic-data/synthetic.db`.
- Access: the data-less gateway publishes `127.0.0.1:4173` by default and forwards only to `app:3000`. There is no public listener, Caddy service, DNS change, or TLS automation.
- Every lifecycle call pins Docker Compose to `--env-file /dev/null`, so Compose never implicitly reads the project-root production `.env`. `SYNTHETIC_PORT` is the only supported shell override and must be an integer from 1024 through 65535. No `.env`, host `data/`, service-account JSON, Codex home, protected knowledgebase path, production database, or other host path is mounted.
- `up`, `verify`, `rebuild`, and `down` take the same non-blocking per-UID lock on `/tmp/meabeclick-synthetic-<uid>.lock.d` before invoking Docker. The lock target is a retained, non-symlink, user-owned mode-700 directory; unsafe pre-existing targets fail closed with status 73. A concurrent command exits immediately with status 75 and a clear message, without touching Docker. The file descriptor holds the directory lock through failure cleanup. Read-only `config` does not take the lock.
- The entrypoint rejects a shared source-controlled inventory of integration credentials/config and all lesson/question engine, binary, model, effort, and timeout redirects. It also refuses Codex credential files, paths outside `/synthetic-data`, and non-loopback URLs.
- The named volume is marked before first database creation. An unmarked non-empty data directory is refused. After migrations, the seeder removes every application row except migration bookkeeping—including migration-created named tutors and generic catalog exercises—then inserts the deterministic fixture in one transaction with foreign-key enforcement enabled and deferred until the complete graph exists.
- The seeder also cleans the portal directory and atomically creates exactly `/synthetic-data/portal/synthetic-student-gamma.json`. Its obviously fictional, deterministic content includes the seeded lesson and game. Reruns replace corruption or stale temporary files and remove every unexpected portal entry.
- Final verification is exhaustive against `src/lib/server/storage-inventory.ts`: every known data table is either constrained to exact synthetic IDs/content or required to be empty. It independently runs SQLite's `foreign_key_check` and verifies the exact portal path/content and absence of other portal files. The allowlist includes the exact published `lesson_materials` slide row used by `/lessons/synthetic-quadratic-formulas`. Unknown/missing tables, broken references, real/default tutor fields, extra bookings/enrollments/payments/reports/results, and altered formula/homework/submission/material fixtures fail verification.
- Gmail/SMTP, Calendar, Drive, Meet OAuth, CallMeBot/WhatsApp, Slack alerts, and Codex/OpenAI credentials are absent. The application network blocks egress as a second, independent control. The access gateway cannot read the database or invoke anything except the fixed app target.

The fixed tutor password is `synthetic-tutor-only`. It is intentionally public and valid only in this isolated stack. All seeded names contain `בדיקה`, all email addresses use reserved `example.invalid`, and phone/content values are obvious fixtures.

## Prerequisites

Docker Engine with Compose v2, plus `flock` from util-linux for fail-closed lifecycle serialization. No production environment file or credential is needed or accepted.

Validate the fully rendered configuration without starting anything:

```bash
./scripts/synthetic-vps.sh config
```

## Start, seed, and verify

```bash
./scripts/synthetic-vps.sh up
```

This first stops and removes any existing synthetic `gateway`, then builds the local image and starts only the internal synthetic `app`. While no host port exists, it waits for migrations/health, replaces all application data with the deterministic fixture, and runs exhaustive database and portal-file verification. Only then does it recreate the loopback gateway. The HTTP smoke uses the fixed synthetic signing secret and fictional student ID to visit `/enter`, verifies that a student session cookie and the exact student redirect are established, opens the normal student page, and checks the normal portal API exposes the seeded lesson, signed game URL, and concrete submitted-and-graded homework fields. It then follows the API-returned lesson and signed game URLs and requires HTTP 200 plus the expected synthetic slide and game content. Every post-`/enter` fetch uses manual redirect handling: a redirect or any other non-success response from the student page, portal API, lesson, or game fails immediately without following the redirect target. The smoke also refuses any target except an exact `http://127.0.0.1:<1024-65535>` root URL and refuses returned fixture URLs that are not root-relative paths on that same origin. This ordering also applies when `up` is rerun over an existing stack, so the previous loopback listener cannot expose the app during rebuild, migration, seed, or verification.

If app startup, seeding, database verification, gateway startup, or the HTTP smoke fails, the command fails closed and removes the entire fixed synthetic Compose project, including its named data volume. A partially seeded or unverified environment is never left available.

Open `http://127.0.0.1:4173`. Use `/login` and the fixed synthetic tutor password for the tutor flow. The seeded account/student, completed homework, formula-rich quiz (`y = x²`), game result, booking, lesson, and report appear in the normal application views. To explicitly rerun the same normal student magic-link and portal flow checked by `up` and `verify`, run `node synthetic/http-smoke.mjs http://127.0.0.1:4173`; it mints only a short-lived link for fixed fictional student `92001` and prints no token or record content.

To use another loopback port:

```bash
SYNTHETIC_PORT=4273 ./scripts/synthetic-vps.sh up
```

For a remote VPS, do not publish the port. Keep the Compose binding unchanged and tunnel it:

```bash
ssh -L 4173:127.0.0.1:4173 <synthetic-vps-host>
```

Then browse locally to `http://127.0.0.1:4173`. No DNS or public Caddy change is part of this environment.

## Verify an existing stack

```bash
./scripts/synthetic-vps.sh verify
```

Expected evidence includes:

- Compose config validation succeeds.
- Only `meabeclick-synthetic-*` resources are shown.
- Database verification reports exact allowlisted fixture counts (1 account, 1 student, 2 tutors, 1 enrollment, 1 booking, 1 lesson, 1 published lesson material, 1 submitted homework item, 1 result, 1 report, and 1 synthetic game catalog row) and zero rows in every other application data table.
- Magic-link exchange, student page, portal API field checks, published lesson material, and API-returned signed game page all succeed against the exact loopback origin.

The check prints counts only; it does not print seeded records.

## Teardown and clean rebuild

Remove only the fixed synthetic project and its named volume:

```bash
./scripts/synthetic-vps.sh down
```

Clean rebuild from an empty synthetic volume:

```bash
./scripts/synthetic-vps.sh rebuild
```

The lifecycle script hard-codes `--env-file /dev/null`, `--project-name meabeclick-synthetic`, and the absolute path to `docker-compose.synthetic.yml`. It does not accept an env/project/file override and never invokes broad removal commands such as `docker system prune` or `docker volume rm`.

## Safe VPS metadata observed during design

A read-only, metadata-only SSH check was run through the configured `mea` alias. The command queried only hostname, Docker server version, and Docker-formatted container/image/port/status/project, network name/driver/scope, and volume name/driver fields. Sanitized findings:

- Docker Engine 29.7.2.
- Production Compose project `mea-beclick` has two running services: an SHA-pinned app on loopback port 3000 and Caddy on public ports 80/443.
- Production has one bridge network (`mea-beclick_internal`) and two Caddy named volumes.
- No environment values, secrets, mounts, files, logs, database content, application records, or protected paths were inspected. No container or host state was changed.

These findings are why the synthetic project name, port, network, image, and volume are all distinct and why no Caddy service is included.
