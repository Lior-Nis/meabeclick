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

case "${1:-}" in
  up|verify|down|rebuild)
    if ! command -v flock >/dev/null 2>&1; then
      printf '[synthetic] flock is required to serialize synthetic lifecycle commands\n' >&2
      exit 69
    fi
    LOCK_DIR="/tmp/meabeclick-synthetic-${UID}.lock.d"
    if [[ ! -e "$LOCK_DIR" && ! -L "$LOCK_DIR" ]]; then
      (umask 077; mkdir "$LOCK_DIR") 2>/dev/null || true
    fi
    if [[ -L "$LOCK_DIR" || ! -d "$LOCK_DIR" ]] \
      || [[ "$(stat -c '%u' -- "$LOCK_DIR" 2>/dev/null || true)" != "$UID" ]] \
      || [[ "$(stat -c '%a' -- "$LOCK_DIR" 2>/dev/null || true)" != "700" ]]; then
      printf '[synthetic] lifecycle lock directory must be a user-owned mode-700 directory: %s\n' "$LOCK_DIR" >&2
      exit 73
    fi
    exec 9<"$LOCK_DIR"
    if ! flock -n 9; then
      printf '[synthetic] another synthetic lifecycle command is active; retry after it finishes\n' >&2
      exit 75
    fi
    ;;
esac

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
  node synthetic/http-smoke.mjs "http://127.0.0.1:${PORT}"
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
  node synthetic/http-smoke.mjs "http://127.0.0.1:${PORT}"
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
