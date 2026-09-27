#!/usr/bin/env bash
# Restore a backup into an isolated directory, and check it.
#
# DOES NOT TOUCH PRODUCTION. It writes only into the target directory you
# name, never into ./data. Promoting a verified restore into production is a
# separate, deliberate act — see server/README.md — because overwriting live
# student records is exactly the mistake this whole exercise exists to
# prevent.
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
TARGET="${2:-$PWD/restore-drill}"

if [ -z "$STAMP" ]; then
  newest="$(ls -1 "$SRC"/results-*.db 2>/dev/null | tail -1 || true)"
  [ -n "$newest" ] || { echo "no backups in $SRC" >&2; exit 1; }
  STAMP="$(basename "$newest" .db)"; STAMP="${STAMP#results-}"
fi

DB="$SRC/results-$STAMP.db"
FILES="$SRC/files-$STAMP.tar.gz"
[ -s "$DB" ] || { echo "no database backup for $STAMP at $DB" >&2; exit 1; }

echo "restoring $STAMP into $TARGET"
rm -rf "$TARGET"; mkdir -p "$TARGET/data"
cp "$DB" "$TARGET/data/results.db"

if [ -s "$FILES" ]; then
  tar -xzf "$FILES" -C "$TARGET/data"
else
  # Loud, because this is the exact shape of the failure the drill found:
  # a perfect database and no boards behind it.
  echo "WARNING: no files-$STAMP.tar.gz — portal records and generated content are NOT in this restore." >&2
fi

# portalDir() refuses to start when the directory is absent, so a restore
# that legitimately has no portal files still has to provide the directory.
mkdir -p "$TARGET/data/portal"

echo "--- integrity ---"
sqlite3 "$TARGET/data/results.db" "PRAGMA integrity_check;"
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
# Discovered on 2026-09-16: the drill below failed twice before it ran, once
# here and once on the missing CALENDAR_ID added underneath.
if [ "$(id -u)" = "0" ]; then
  chown -R 1000:1000 "$TARGET/data"
else
  echo "note: not running as root — if the smoke test below reports" >&2
  echo "      'DATA_DIR ... is not writable', run: sudo chown -R 1000:1000 $TARGET/data" >&2
fi

echo "Restored to $TARGET. To smoke-test it without touching production:"
echo "  docker run --rm -p 3100:3000 -v $TARGET/data:/app/data \\"
echo "    -e PORT=3000 -e ORIGIN=http://localhost:3100 -e PROTOCOL_HEADER=x-forwarded-proto \\"
echo "    -e DATA_DIR=/app/data -e PORTAL_DIR=/app/data/portal -e SITE_URL=http://localhost:3100 \\"
echo "    -e SESSION_SECRET=drill-only -e ADMIN_PASSWORD=drill-only \\"
echo "    -e CALENDAR_ID=drill-only \\"
echo "    ghcr.io/lior-nis/meabeclick:\$(docker inspect mea-beclick-app-1 --format '"'"'{{.Config.Image}}'"'"' | sed '"'"'s/.*://'"'"')"
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
