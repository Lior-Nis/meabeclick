FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Lesson generation spawns a coding-agent CLI as a subprocess (see
# src/lib/server/lesson/*). This MUST be installed in the RUNTIME stage, not
# just the builder — a multi-stage image that copies only build/ and
# production node_modules silently drops a builder-only global install, and
# generation then fails at the FIRST REAL BOOKING. The characterization suite
# deliberately disables generation, so nothing in CI catches this — only a
# real booking does. Do NOT "optimize" this line away or move it to the
# builder stage.
#
# Codex replaced Claude Code here when the Claude subscription's Claude Code
# entitlement was revoked. Nothing in the codebase can run Claude Code any
# more — that path was removed rather than left as a rollback to a cancelled
# subscription.

# ca-certificates, and it is NOT optional. node:22-slim ships without it.
# Node carries its own bundled CA store, so every HTTPS call the app itself
# makes works fine and this looks unnecessary — which is exactly how it stays
# missing. Codex is a Rust binary and reads the SYSTEM trust store, so
# without this every request it makes dies at the TLS handshake, surfacing as
#
#     Error logging in with device code: error sending request for url
#     (https://auth.openai.com/api/accounts/deviceauth/usercode)
#
# a transport error with no mention of certificates, on a container whose DNS
# and egress are provably fine (a Node fetch to that same URL returns 200).
# It breaks `codex login` and every subsequent generation alike. This was
# invisible while the engine was Claude Code, which is Node-based and used
# Node's bundled roots.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex@0.149.0

# games/registry.json is read at runtime off process.cwd() (see
# src/lib/server/lesson/registry.ts) — WORKDIR /app plus this COPY is what
# keeps that resolution working inside the image.
COPY --chown=node:node games ./games

# templates/plans/*.json are read at runtime off process.cwd() (see
# src/lib/server/plans/templates.ts), exactly like games/registry.json above.
COPY --chown=node:node templates ./templates

COPY --from=builder --chown=node:node /app/build ./build
COPY --chown=node:node static ./static

# Codex authenticates from $CODEX_HOME/auth.json and REFRESHES IT IN PLACE,
# so this must point at a writable mount (see docker-compose.yml) rather than
# the image's own filesystem — a token that cannot be rewritten works until
# the first refresh and then fails as an auth error. Set here so the app and
# any `docker compose exec` agree on one location.
ENV CODEX_HOME=/app/.codex

USER node
EXPOSE 3000
CMD ["node", "build/index.js"]
