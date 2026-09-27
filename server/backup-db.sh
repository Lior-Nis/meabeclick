#!/usr/bin/env bash
# Runs on the host as the meabeclick user via systemd --user
# (meabeclick-backup.service/.timer). data/ is owned by uid 1000 (matching
# the app container's built-in `node` user) with group ownership set to
# the meabeclick group and the setgid bit set, so this host user can write
# here via group permissions even when its own uid isn't 1000 — see
# docs/superpowers/plans/2026-08-24-meabeclick-vps-dockerization.md, Task 11.
#
# ## What this captures, and why it is not just the database
#
# It used to copy results.db and nothing else. A restore drill on
# 2026-09-08 proved what that is worth: the database came back perfectly —
# integrity ok, zero foreign-key violations, every row count matching live —
# and a legitimately authorised student's board answered HTTP 500, because
# /api/portal/[code] reads a per-student JSON file that had never been in a
# backup. The database records that a student exists; the portal file is
# what they actually see. Losing one without the other restores an account
# with no board behind it.
#
# So the file state ships too: portal/ (every student's record, their
# homework and lesson log), games-data/ and lessons/ (generated material a
# child is linked to), and drafts/ (lessons held for the tutor to review,
# which exist nowhere else at all).
#
# ## Where it writes, and why not under data/
#
# Backups used to live in data/backups — inside the directory being backed
# up, on the same volume, inside the container's writable mount. A bad
# cutover, an `rm -rf data`, or the app itself could take the backups with
# the original. They now sit beside the checkout instead.
#
# An off-box copy goes to Google Drive at the end of this script, owned by
# mea.beclick@gmail.com. That is what makes this VPS disposable: rebuild the
# box, restore from Drive, carry on. It is optional — with no credentials
# configured the local backup still runs and says so.
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date +%F)"

[ -s data/results.db ] || { echo "no results.db found at $(pwd)/data/results.db" >&2; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"

# .backup, not cp: a live SQLite file copied byte-for-byte can land
# mid-transaction. This takes a consistent snapshot of a database in use.
sqlite3 data/results.db ".backup '$DEST/results-$STAMP.db'"

# The file state, in one archive per day. Missing directories are skipped
# rather than failing the run — a fresh box legitimately has no drafts yet.
PRESENT=()
for d in portal games-data lessons drafts; do
  [ -d "data/$d" ] && PRESENT+=("$d")
done
if [ ${#PRESENT[@]} -gt 0 ]; then
  tar -czf "$DEST/files-$STAMP.tar.gz" -C data "${PRESENT[@]}"
fi

# Student records and generated material: readable by their owner only.
chmod 600 "$DEST/results-$STAMP.db" 2>/dev/null || true
chmod 600 "$DEST/files-$STAMP.tar.gz" 2>/dev/null || true

find "$DEST" -maxdepth 1 -type f \( -name 'results-*.db' -o -name 'files-*.tar.gz' \) \
  -mtime "+$KEEP_DAYS" -delete

echo "backed up to $DEST: results-$STAMP.db$([ ${#PRESENT[@]} -gt 0 ] && echo ", files-$STAMP.tar.gz (${PRESENT[*]})")"

# Off-box copy to Google Drive, owned by the business account.
#
# Cannot fail this script, deliberately: the local backup above has already
# succeeded by now, and letting a Drive outage or an expired token mark the
# nightly job as failed would train everyone to ignore it. The uploader says
# what went wrong and exits 0.
if command -v node >/dev/null 2>&1; then
  # .env holds the OAuth client and refresh token. Sourced here rather than
  # baked into the systemd unit so rotating the token needs no root.
  set -a; [ -f .env ] && . ./.env; set +a
  node server/drive/upload-backup.mjs "$DEST" "$STAMP" || true
fi
