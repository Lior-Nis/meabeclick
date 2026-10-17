#!/usr/bin/env bash
# Gives the site's calendar robot a new Google service-account key.
#
#   ./scripts/connect-calendar.sh ~/Downloads/<project>-<key id>.json
#   ./scripts/connect-calendar.sh <(ssh mac cat '~/Downloads/<key>.json')
#
# The robot writes every booking into the lesson calendar (CALENDAR_ID).
# This swaps the key it signs in with — to rotate it, or to move the robot
# to another Google Cloud project — without a restart and without guessing:
#
#   1. The key goes to the server as service-account.json.new.
#   2. scripts/calendar-probe.mjs writes and deletes a test event with it,
#      from a throwaway container of the image production is running, on
#      the calendar the running app writes to. If that fails, the .new file
#      is removed and nothing else has changed.
#   3. The old key and .env are backed up; the new key is written over
#      service-account.json IN PLACE and GOOGLE_SERVICE_ACCOUNT_EMAIL is
#      updated. In place because the container bind-mounts that one file:
#      `mv` would swap the inode and the app would keep reading the old key
#      until a restart. The app reads the file on every booking, so the next
#      booking signs in as the new robot.
#   4. The probe runs again inside the running app, against the file it
#      actually reads. If that fails, the old key and .env go back.
#
# Before running it, share the lesson calendar with the new robot's email
# ("Make changes to events"). The private key is never printed.
set -euo pipefail

KEY_FILE="${1:-}"
SERVER="${SERVER:-mea}"
DIR="${DIR:-/home/meabeclick/mea-beclick}"
CONTAINER="${CONTAINER:-mea-beclick-app-1}"
# The image's `node` user, which reads the mounted key.
OWNER="${OWNER:-1000:1000}"
PROBE="$(cd "$(dirname "$0")" && pwd)/calendar-probe.mjs"

if [[ -z "$KEY_FILE" ]]; then
  echo "usage: $0 <service-account-key.json>" >&2
  exit 1
fi

# Read once: the key may arrive on a pipe, and a pipe reads only once.
KEY_JSON="$(cat "$KEY_FILE")"

# The email ends up inside commands run on the server, so it has to be
# exactly a service-account address and nothing else.
EMAIL="$(printf '%s' "$KEY_JSON" | node -e '
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    let k; try { k = JSON.parse(s); } catch { process.exit(1); }
    const ok = k && typeof k.private_key === "string"
      && /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(k.client_email);
    if (!ok) process.exit(1);
    console.log(k.client_email);
  });')" || { echo "not a service-account key: $KEY_FILE" >&2; exit 1; }

d="$(printf '%q' "$DIR")"
c="$(printf '%q' "$CONTAINER")"
stamp="$(date +%Y-%m-%d-%H%M%S)"
echo "new robot: $EMAIL"

# 1. Upload, readable only by the container's user.
printf '%s' "$KEY_JSON" | ssh "$SERVER" "cd $d && umask 077 && cat > service-account.json.new \
  && chown $OWNER service-account.json.new && chmod 400 service-account.json.new"

# 2. Probe the new key before anything depends on it.
if ! ssh "$SERVER" "cd $d \
  && img=\$(docker inspect $c --format '{{.Config.Image}}') \
  && CALENDAR_ID=\$(docker exec $c printenv CALENDAR_ID) && export CALENDAR_ID \
  && docker run --rm -i -e CALENDAR_ID -v \"\$PWD/service-account.json.new:/probe-key.json:ro\" \
     --entrypoint node \"\$img\" --input-type=module - /probe-key.json" < "$PROBE"; then
  ssh -n "$SERVER" "rm -f $d/service-account.json.new"
  echo "the new key could not write to the lesson calendar — nothing was changed" >&2
  exit 1
fi

# 3. Swap, keeping what was there.
ssh -n "$SERVER" "cd $d \
  && cp -p service-account.json service-account.json.bak-$stamp \
  && cp -p .env .env.bak-$stamp \
  && chmod 600 service-account.json \
  && cat service-account.json.new > service-account.json \
  && chmod 400 service-account.json \
  && rm service-account.json.new \
  && if grep -q '^GOOGLE_SERVICE_ACCOUNT_EMAIL=' .env; \
     then sed -i 's|^GOOGLE_SERVICE_ACCOUNT_EMAIL=.*|GOOGLE_SERVICE_ACCOUNT_EMAIL=$EMAIL|' .env; \
     else echo 'GOOGLE_SERVICE_ACCOUNT_EMAIL=$EMAIL' >> .env; fi"

# 4. Prove the running app writes with it; otherwise put the old key back.
if ! ssh "$SERVER" "docker exec -i $c node --input-type=module - /app/service-account.json" < "$PROBE"; then
  ssh -n "$SERVER" "cd $d \
    && chmod 600 service-account.json \
    && cat service-account.json.bak-$stamp > service-account.json \
    && chmod 400 service-account.json \
    && cat .env.bak-$stamp > .env"
  echo "the running app could not write with the new key — the old key is back" >&2
  exit 1
fi

echo "done: bookings now sign in as $EMAIL"
echo "backups on the server: service-account.json.bak-$stamp, .env.bak-$stamp"
echo "once real bookings have landed, unshare the lesson calendar from the old robot and delete the backups"
