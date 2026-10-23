#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE=(docker compose --env-file /dev/null --project-name meabeclick-synthetic --file "$ROOT/docker-compose.synthetic.yml")
PORT="${SYNTHETIC_PORT:-4173}"

if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  printf '[synthetic] SYNTHETIC_PORT must be an integer from 1024 through 65535\n' >&2
  exit 64
fi

verify_existing() {
  local verified=0
  cleanup_failed_verify() {
    local status=$?
    trap - ERR EXIT
    if (( verified == 0 )); then
      printf '[synthetic] verification failed; removing the synthetic project and volume\n' >&2
      "${COMPOSE[@]}" down --volumes --remove-orphans || true
    fi
    exit "$status"
  }
  trap cleanup_failed_verify ERR EXIT

  "${COMPOSE[@]}" config --quiet
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" --profile tools run --rm --no-deps seed node synthetic/verify.mjs
  node -e "fetch('http://127.0.0.1:${PORT}/api/me').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);console.log('[synthetic] HTTP smoke: '+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})"
  verified=1
  trap - ERR EXIT
}

up() {
  local ready=0
  cleanup_failed_up() {
    local status=$?
    trap - ERR EXIT
    if (( ready == 0 )); then
      printf '[synthetic] startup failed; removing the synthetic project and volume\n' >&2
      "${COMPOSE[@]}" down --volumes --remove-orphans || true
    fi
    exit "$status"
  }
  trap cleanup_failed_up ERR EXIT

  "${COMPOSE[@]}" rm --stop --force gateway
  "${COMPOSE[@]}" up -d --build --wait app
  "${COMPOSE[@]}" --profile tools run --rm --no-deps seed
  "${COMPOSE[@]}" --profile tools run --rm --no-deps seed node synthetic/verify.mjs
  "${COMPOSE[@]}" up -d --wait gateway
  node -e "fetch('http://127.0.0.1:${PORT}/api/me').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);console.log('[synthetic] HTTP smoke: '+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})"
  ready=1
  trap - ERR EXIT
  printf '[synthetic] ready at http://127.0.0.1:%s\n' "$PORT"
}

case "${1:-}" in
  up) up ;;
  verify) verify_existing ;;
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
