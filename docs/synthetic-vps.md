# Isolated synthetic VPS environment

This stack is for UX and release testing with fictional data only. It does not deploy, restart, stop, or inspect the production stack. It has a separate fixed Compose project, image, internal network, named volume, database, port, and deterministic seed.

## Safety design

- Compose project: `meabeclick-synthetic` (production is `mea-beclick`).
- Container names are project-prefixed (`meabeclick-synthetic-*`), not shared with production.
- Image: local-only `meabeclick-synthetic:local`; it never pulls or tags the production GHCR image.
- Network: the app and seeder use `meabeclick-synthetic_synthetic_internal` with `internal: true`, so they have no external route. A fixed-target Node gateway joins that network and a separate access bridge only to make Docker's loopback port publishing work; it has no credentials, data volume, shell-configurable target, or application command.
- Data: named volume `meabeclick-synthetic_synthetic_data`, mounted only at `/synthetic-data`; database `/synthetic-data/synthetic.db`.
- Access: the data-less gateway publishes `127.0.0.1:4173` by default and forwards only to `app:3000`. There is no public listener, Caddy service, DNS change, or TLS automation.
- No `.env`, host `data/`, service-account JSON, Codex home, protected knowledgebase path, production database, or other host path is mounted.
- The entrypoint refuses to start if integration credentials/config are injected, lesson-engine credentials exist, paths escape `/synthetic-data`, or the URL is not loopback-only.
- The named volume is marked before first database creation. An unmarked non-empty data directory is refused. The seeder additionally refuses any account/student row that is not obviously synthetic.
- Gmail/SMTP, Calendar, Drive, Meet OAuth, CallMeBot/WhatsApp, Slack alerts, and Codex/OpenAI credentials are absent. The application network blocks egress as a second, independent control. The access gateway cannot read the database or invoke anything except the fixed app target.

The fixed tutor password is `synthetic-tutor-only`. It is intentionally public and valid only in this isolated stack. All seeded names contain `בדיקה`, all email addresses use reserved `example.invalid`, and phone/content values are obvious fixtures.

## Prerequisites

Docker Engine with Compose v2. No production environment file or credential is needed or accepted.

Validate the fully rendered configuration without starting anything:

```bash
./scripts/synthetic-vps.sh config
```

## Start, seed, and verify

```bash
./scripts/synthetic-vps.sh up
```

This builds the local image, starts only the synthetic `app`, waits for health, applies the idempotent deterministic seed, verifies synthetic-only row counts, and performs an HTTP smoke check.

Open `http://127.0.0.1:4173`. Use `/login` and the fixed synthetic tutor password for the tutor flow. The seeded account/student, completed homework, formula-rich quiz (`y = x²`), game result, booking, lesson, and report appear in the normal application views.

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
- Database verification reports 1 synthetic account, 1 student, 2 tutors, 1 lesson, 1 submitted homework item, and 1 result.
- HTTP smoke returns 200.

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

The lifecycle script hard-codes both `--project-name meabeclick-synthetic` and `--file docker-compose.synthetic.yml`. It does not accept a project/file override and never invokes broad removal commands such as `docker system prune` or `docker volume rm`.

## Safe VPS metadata observed during design

A read-only, metadata-only SSH check was run through the configured `mea` alias. The command queried only hostname, Docker server version, and Docker-formatted container/image/port/status/project, network name/driver/scope, and volume name/driver fields. Sanitized findings:

- Docker Engine 29.7.2.
- Production Compose project `mea-beclick` has two running services: an SHA-pinned app on loopback port 3000 and Caddy on public ports 80/443.
- Production has one bridge network (`mea-beclick_internal`) and two Caddy named volumes.
- No environment values, secrets, mounts, files, logs, database content, application records, or protected paths were inspected. No container or host state was changed.

These findings are why the synthetic project name, port, network, image, and volume are all distinct and why no Caddy service is included.
