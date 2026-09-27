#!/usr/bin/env bash
# Connects the site to Google Calendar for writing lessons.
#
#   ./scripts/connect-calendar.sh ~/Downloads/service-account-key.json
#
# Reads the service-account JSON you downloaded from Google Cloud, extracts the
# two values the server needs, and writes them straight into the server's .env
# over ssh. The private key is never printed and never leaves your machine in
# any other form.
set -euo pipefail

KEY_FILE="${1:-}"
SERVER="${SERVER:-mea}"
REMOTE_ENV="${REMOTE_ENV:-/home/meabeclick/mea-beclick/.env}"
CALENDAR="${CALENDAR:-}"

if [[ -z "$KEY_FILE" || ! -f "$KEY_FILE" ]]; then
  echo "usage: $0 <path-to-service-account.json>" >&2
  exit 1
fi

# A calendar id names a person, so it is supplied rather than defaulted. This
# used to carry one of Nicole's own calendars as the fallback, which meant the
# identifier lived in the repo and a mistyped run wrote to her calendar.
if [[ -z "$CALENDAR" ]]; then
  echo "set CALENDAR to the calendar id events should be written to, e.g." >&2
  echo "  CALENDAR=<id> $0 $KEY_FILE" >&2
  exit 1
fi

EMAIL=$(python3 - "$KEY_FILE" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
missing = [k for k in ("client_email", "private_key") if k not in d]
if missing:
    sys.exit(f"not a service-account key file (missing {', '.join(missing)})")
print(d["client_email"])
PY
)

echo "service account : $EMAIL"
echo "calendar        : $CALENDAR"
echo
echo "Make sure that calendar is shared with the service account above,"
echo "with permission 'Make changes to events'. Continue? [y/N]"
read -r ANSWER
[[ "$ANSWER" == "y" || "$ANSWER" == "Y" ]] || { echo "aborted"; exit 1; }

# The key travels as the file it already is. Squeezing a PEM into .env does not
# work: systemd's EnvironmentFile strips the backslashes, so "\n" arrives as "n"
# and the key stops decoding.
scp -q "$KEY_FILE" "$SERVER:~/maabeclick-web/service-account.json"

ssh "$SERVER" "
  set -e
  cd ~/maabeclick-web
  chmod 600 service-account.json
  sed -i '/^GOOGLE_SERVICE_ACCOUNT_EMAIL=/d;/^GOOGLE_SERVICE_ACCOUNT_KEY=/d;/^GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/d;/^CALENDAR_ID=/d' .env
  {
    echo 'GOOGLE_SERVICE_ACCOUNT_EMAIL=$EMAIL'
    echo 'CALENDAR_ID=$CALENDAR'
    echo \"GOOGLE_SERVICE_ACCOUNT_KEY_FILE=\$HOME/maabeclick-web/service-account.json\"
  } >> .env
  chmod 600 .env
  systemctl --user restart maabeclick-web
  sleep 3
  systemctl --user is-active maabeclick-web
"
echo "connected — book a test lesson to confirm the event appears in the calendar"
