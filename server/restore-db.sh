#!/usr/bin/env bash
# Restore a backup into an isolated directory, and check it.
#
# DOES NOT TOUCH PRODUCTION. It writes only into the target directory you
# name, never into ./data. Promoting a verified restore into production is a
# separate, deliberate act — see server/README.md — because overwriting live
# student records is exactly the mistake this whole exercise exists to
# prevent.
#
# The target is resolved to a canonical path (symlinks included) and refused
# — nothing deleted — when it is empty, /, $HOME, the repo root, ./data, or
# $DATA_DIR, an ancestor of any of those, or anything inside ./data or
# $DATA_DIR. The backup directory is refused the same way, and so is every
# path inside the repo except ./restore-drill. The database and the files
# archive are unpacked into a scratch directory beside the target and checked
# there; the previous restore is replaced only after that, so a corrupt
# backup cannot wipe a good drill.
#
# The point is that a backup nobody has restored is a hope, not a backup.
# Run this after any change to what gets backed up, and before any cutover.
#
#   bash server/restore-db.sh                     # newest backup -> ./restore-drill
#   bash server/restore-db.sh 2026-09-08 /tmp/r   # a specific day, elsewhere
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${BACKUP_DIR:-$HOME/backups}"
STAMP="${1:-}"
# An explicit empty target is a refusal, not a request for the default.
# `${2:-...}` would treat "" as unset and restore into ./restore-drill.
if [ "$#" -ge 2 ]; then
  TARGET="$2"
else
  TARGET="$PWD/restore-drill"
fi

if [ -z "$STAMP" ]; then
  newest="$(ls -1 "$SRC"/results-*.db 2>/dev/null | tail -1 || true)"
  [ -n "$newest" ] || { echo "no backups in $SRC" >&2; exit 1; }
  STAMP="$(basename "$newest" .db)"; STAMP="${STAMP#results-}"
fi

DB="$SRC/results-$STAMP.db"
FILES="$SRC/files-$STAMP.tar.gz"
[ -s "$DB" ] || { echo "no database backup for $STAMP at $DB" >&2; exit 1; }

refuse() {
  echo "refusing restore target '$TARGET': $*" >&2
  exit 1
}

# sqlite3 exits 0 when this pragma runs. A broken index comes back as text,
# not a failed command; only the exact word "ok" is a pass. `show` reprints
# that word under "--- integrity ---", which is what a drill log looks for.
require_integrity() {
  local db="$1" label="$2" show="${3:-}" integrity
  if ! integrity="$(sqlite3 "$db" "PRAGMA integrity_check;" 2>&1)"; then
    echo "integrity check failed for $label" >&2
    printf '%s\n' "$integrity" >&2
    exit 1
  fi
  if [ "$show" = "show" ]; then
    printf '%s\n' "$integrity"
  fi
  [ "$integrity" = "ok" ] || {
    echo "integrity check failed for $label: expected ok" >&2
    printf '%s\n' "$integrity" >&2
    exit 1
  }
}

if [ -z "$TARGET" ]; then
  refuse "a restore target must not be empty"
fi

# -m so a target that does not exist yet still canonicalises. Symlink
# components are resolved, so a link to ./data is judged as ./data.
CANON="$(realpath -m -- "$TARGET")" || refuse "could not resolve the path"
[ -n "$CANON" ] || refuse "could not resolve the path"
TARGET="$CANON"

REPO="$(pwd)"
REPO_DATA="$(realpath -m -- "$REPO/data")"
HOME_CANON="$(realpath -m -- "$HOME")"

# $1 protected path, $2 label, $3 "inside" to also refuse descendants.
# ./restore-drill is the one path inside the repo a restore may replace;
# that exception is applied after these guards.
guard() {
  local prot="$1" label="$2" descendants="${3:-}"
  [ -n "$prot" ] || return 0
  if [ "$TARGET" = "$prot" ]; then
    refuse "it is $label ($prot)"
  fi
  # TARGET is a strict ancestor of prot — removing it removes prot.
  if [ "${prot#"$TARGET"/}" != "$prot" ]; then
    refuse "it is an ancestor of $label ($prot)"
  fi
  if [ "$descendants" = "inside" ] && [ "${TARGET#"$prot"/}" != "$TARGET" ]; then
    refuse "it is inside $label ($prot)"
  fi
}

guard "/" "the filesystem root"
guard "$HOME_CANON" "HOME"
guard "$REPO" "the repo root"
guard "$REPO_DATA" "the repo data directory" inside
if [ -n "${DATA_DIR:-}" ]; then
  DATA_CANON="$(realpath -m -- "$DATA_DIR")"
  if [ "$DATA_CANON" != "$REPO_DATA" ]; then
    guard "$DATA_CANON" "DATA_DIR" inside
  fi
fi

# Anything inside the checkout would take the script with it. ./restore-drill
# is the documented default and the only exception; a path under it is not.
DRILL="$(realpath -m -- "$REPO/restore-drill")"
if [ "$TARGET" != "$DRILL" ] && [ "${TARGET#"$REPO"/}" != "$TARGET" ]; then
  refuse "it is inside the repo ($REPO); only $DRILL may be replaced there"
fi

SRC_CANON="$(realpath -m -- "$SRC")"
guard "$SRC_CANON" "the backup directory" inside

# Beside the target, not under /tmp, so the final mv is a rename on the
# same filesystem. The trap drops the scratch dir on any exit — including
# a failed check — and puts the previous restore back if a swap was
# interrupted after the old directory had been moved aside.
mkdir -p -- "$(dirname -- "$TARGET")"
aside=""
scratch="$(mktemp -d "$(dirname -- "$TARGET")/.restore-scratch.XXXXXX")"
cleanup() {
  if [ -n "$aside" ] && [ -e "$aside" ] && [ ! -e "$TARGET" ]; then
    mv -- "$aside" "$TARGET" || true
  fi
  if [ -d "$scratch" ]; then
    rm -rf "$scratch"
  fi
}
trap cleanup EXIT
mkdir -p "$scratch/data"
cp "$DB" "$scratch/data/results.db"
# Read-only, so the check cannot modify the copy that will be installed.
ro="file:${scratch}/data/results.db?mode=ro"
require_integrity "$ro" "$DB"
fk_src="$(sqlite3 "$ro" 'PRAGMA foreign_key_check;' | wc -l)" || {
  echo "foreign key check failed for $DB" >&2
  exit 1
}
[ "$fk_src" = "0" ] || { echo "FOREIGN KEY VIOLATIONS IN BACKUP" >&2; exit 1; }

if [ -s "$FILES" ]; then
  # Extract here, before the previous restore is touched. A truncated
  # archive fails this command and the trap throws the scratch tree away.
  # Never let the archive replace the database that just passed. A backup
  # tarball is the file tree, not a second copy of results.db; a member
  # named results.db (or its -wal/-shm siblings, with or without ./) would
  # overwrite the checked file underneath the re-check.
  tar -xzf "$FILES" -C "$scratch/data" \
    --exclude='results.db' \
    --exclude='results.db-*' \
    --exclude='./results.db' \
    --exclude='./results.db-*' || {
    echo "files archive is corrupt: $FILES" >&2
    exit 1
  }
else
  # Loud, because this is the exact shape of the failure the drill found:
  # a perfect database and no boards behind it.
  echo "WARNING: no files-$STAMP.tar.gz — portal records and generated content are NOT in this restore." >&2
fi

mkdir -p "$scratch/data/portal"
# Re-check before the swap. The excludes above are what stop a tarball from
# replacing results.db; these two checks are what stop the swap if it did.
require_integrity "$ro" "$DB"
fk_src="$(sqlite3 "$ro" 'PRAGMA foreign_key_check;' | wc -l)" || {
  echo "foreign key check failed for $DB" >&2
  exit 1
}
[ "$fk_src" = "0" ] || { echo "FOREIGN KEY VIOLATIONS IN BACKUP" >&2; exit 1; }

echo "restoring $STAMP into $TARGET"
# Move the old tree aside, then rename the scratch dir into its place.
# rm-then-mv would drop the previous restore if the rename failed.
chmod 755 "$scratch"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  aside="$(mktemp -u "$(dirname -- "$TARGET")/.restore-aside.XXXXXX")"
  mv -- "$TARGET" "$aside"
  if ! mv -- "$scratch" "$TARGET"; then
    mv -- "$aside" "$TARGET"
    echo "failed to swap the checked restore into $TARGET" >&2
    exit 1
  fi
  rm -rf "$aside"
  aside=""
else
  mv -- "$scratch" "$TARGET"
fi

# portalDir() refuses to start when the directory is absent, so a restore
# that legitimately has no portal files still has to provide the directory.
mkdir -p "$TARGET/data/portal"

echo "--- integrity ---"
require_integrity "$TARGET/data/results.db" "restored database" show
echo "--- foreign keys ---"
fk="$(sqlite3 "$TARGET/data/results.db" 'PRAGMA foreign_key_check;' | wc -l)"
echo "violations: $fk"
[ "$fk" = "0" ] || { echo "FOREIGN KEY VIOLATIONS IN RESTORE" >&2; exit 1; }

echo "--- contents (counts only; no records printed) ---"
for t in accounts students_v2 enrollments bookings payments lessons; do
  n="$(sqlite3 "$TARGET/data/results.db" "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo n/a)"
  printf '  %-14s %s\n' "$t" "$n"
done
for d in portal games-data lessons drafts; do
  printf '  %-14s %s files\n' "$d/" "$(ls -1 "$TARGET/data/$d" 2>/dev/null | wc -l)"
done

echo
# The container runs as uid 1000 (`node`) and boot-checks.ts refuses to
# start unless DATA_DIR is WRITABLE — not merely readable. Production gets
# that from data/ being owned by uid 1000 with the setgid bit (see
# backup-db.sh); a freshly restored copy carries whatever ownership the
# restoring user had, so the drill container fails to boot without this.
# Discovered on 2026-09-16: the drill below failed to boot here before it
# ran. (It also needed CALENDAR_ID then; since migration 029 the lesson
# calendar lives on the tutor's row, which the restored database carries.)
if [ "$(id -u)" = "0" ]; then
  chown -R 1000:1000 "$TARGET/data"
else
  echo "note: not running as root — if the smoke test below reports" >&2
  echo "      'DATA_DIR ... is not writable', run: sudo chown -R 1000:1000 $TARGET/data" >&2
fi

echo "Restored to $TARGET. To smoke-test it without touching production:"
echo "  APP_TAG=\$(docker inspect mea-beclick-app-1 --format '{{.Config.Image}}' | sed 's/.*://')"
echo "  docker run --rm -p 3100:3000 -v $TARGET/data:/app/data \\"
echo "    -e PORT=3000 -e ORIGIN=http://localhost:3100 -e PROTOCOL_HEADER=x-forwarded-proto \\"
echo "    -e DATA_DIR=/app/data -e PORTAL_DIR=/app/data/portal -e SITE_URL=http://localhost:3100 \\"
echo "    -e SESSION_SECRET=drill-only -e ADMIN_PASSWORD=drill-only \\"
echo '    ghcr.io/its-nix/meabeclick:$APP_TAG'
echo
echo "  (the tag matters: :latest is whatever this box last CACHED, which on a"
echo "   long-lived box is ancient — testing a fresh restore against old code"
echo "   proves nothing. The command above reuses the tag production runs.)"
echo
echo "Then check the thing counts cannot prove — that a student's board renders:"
echo "  C=\$(sqlite3 $TARGET/data/results.db 'SELECT code FROM students_v2 LIMIT 1;')"
echo "  COOKIE=\$(curl -s -i -X POST -H 'Content-Type: application/json' \\"
echo "    -d '{\"password\":\"drill-only\"}' http://localhost:3100/api/login \\"
echo "    | grep -i '^set-cookie:' | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -H \"Cookie: \$COOKIE\" \\"
echo "    http://localhost:3100/api/portal/\$C     # 200, not 500"
