#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose --project-name meabeclick-synthetic --file docker-compose.synthetic.yml)
PORT="${SYNTHETIC_PORT:-4173}"

verify() {
  "${COMPOSE[@]}" config --quiet
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" --profile tools run --rm --no-deps seed node synthetic/verify.mjs
  node -e "fetch('http://127.0.0.1:${PORT}/api/me').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);console.log('[synthetic] HTTP smoke: '+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})"
}

up() {
  "${COMPOSE[@]}" up -d --build --wait app gateway
  "${COMPOSE[@]}" --profile tools run --rm --no-deps seed
  verify
  printf '[synthetic] ready at http://127.0.0.1:%s\n' "$PORT"
}

case "${1:-}" in
  up) up ;;
  verify) verify ;;
  down) "${COMPOSE[@]}" down --volumes --remove-orphans ;;
  rebuild)
    "${COMPOSE[@]}" down --volumes --remove-orphans
    up
    ;;
  config) "${COMPOSE[@]}" config ;;
  *)
    printf 'Usage: %s {up|verify|down|rebuild|config}\n' "$0" >&2
    exit 64
    ;;
esac
