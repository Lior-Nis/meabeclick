#!/usr/bin/env bash
# The host-side half of the daily health checks: the message that has to
# go out when the app itself cannot send it.
#
#   bash server/health-alert.sh <failed-unit-name>
#
# Run by meabeclick-health-alert@.service, which the health check units
# name in OnFailure=. A health unit fails when its curl fails: the app is
# down or unreachable on 127.0.0.1:3000 (the uptime case the app cannot
# report about itself), or the app answered 503 (no alert channel) / 502
# (the channel refused the message). In every one of those cases the app's
# own alert did not reach Lior, so this sends ONE message from the host,
# through the same ops channel (OPS_SLACK_WEBHOOK_URL, and/or
# OPS_CALLMEBOT_PHONE + OPS_CALLMEBOT_API_KEY), read from the app's .env.
#
# Only those named variables are read from .env, by grep, rather than
# sourcing it or using systemd's EnvironmentFile=: the unit never holds
# ADMIN_PASSWORD or the Gmail password, and `systemctl --user show` prints
# none of it. The webhook URL is the credential: it goes to curl on stdin
# (`-K -`), never on the command line where `ps` would show it.
#
# One message per hour at most (HEALTH_ALERT_QUIET_SECONDS): when the app is
# down, both morning checks fail together and Lior needs to hear it once.
#
# Exits non-zero when nothing could be sent, so this unit itself shows in
# `systemctl --user --failed`.
set -uo pipefail

UNIT="$(printf '%s' "${1:-unknown}" | tr -cd 'A-Za-z0-9@._:-')"
DIR="${MEABECLICK_DIR:-$HOME/mea-beclick}"
ENV_FILE="${HEALTH_ALERT_ENV:-$DIR/.env}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}"
STAMP="${HEALTH_ALERT_STAMP:-$STATE_DIR/meabeclick-health-alert.last}"
QUIET="${HEALTH_ALERT_QUIET_SECONDS:-3600}"

# KEY=value, last one wins, optional surrounding quotes. Never echoed.
env_var() {
  [ -r "$ENV_FILE" ] || return 0
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

if [ -f "$STAMP" ]; then
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ $(( $(date +%s) - ${last:-0} )) -lt "$QUIET" ]; then
    echo "health-alert: $UNIT failed; an alert already went out in the last ${QUIET}s, not sending another."
    exit 0
  fi
fi

# The failed unit's last words: curl's own error ("Failed to connect",
# "returned error: 503"). curl -sS --fail prints no response body and no
# request headers, so the cron key is not in here.
TAIL=""
if command -v journalctl >/dev/null 2>&1; then
  TAIL="$(journalctl --user -u "$UNIT" -n 3 --no-pager -o cat 2>/dev/null | tr -d '\000-\010\013-\037' | tail -c 300)"
fi

MSG="⚠️ מאה בקליק — בדיקת הבריאות ${UNIT} נכשלה על השרת: האתר לא ענה, או שההתראה מהאתר לא נשלחה.
${TAIL:+${TAIL}
}לבדוק: journalctl --user -u ${UNIT}"

sent=0
failed=0

SLACK="$(env_var OPS_SLACK_WEBHOOK_URL)"
if [ -n "$SLACK" ]; then
  if [[ ! "$SLACK" =~ ^https://hooks\.slack\.com/services/[A-Za-z0-9_/-]+$ ]]; then
    echo "health-alert: OPS_SLACK_WEBHOOK_URL is not a https://hooks.slack.com/services/… URL; not sending there." >&2
    failed=1
  else
    # JSON-escape: backslash, quote, newline. Slack markup (<, >, &) too.
    esc="$(printf '%s' "$MSG" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' | awk 'BEGIN{ORS="\\n"} {print}')"
    esc="${esc%\\n}"
    answer="$(printf 'url = "%s"\n' "$SLACK" | curl -sS --max-time 15 -K - \
      -H 'Content-Type: application/json' --data-binary "{\"text\":\"$esc\"}" 2>&1)"
    if [ "$answer" = "ok" ]; then sent=1; echo "health-alert: sent to slack (OPS_SLACK_WEBHOOK_URL)."
    else failed=1; echo "health-alert: slack refused: $(printf '%s' "$answer" | sed 's#https://hooks\.slack\.com/[^ ]*#<webhook>#g' | head -c 120)" >&2; fi
  fi
fi

PHONE="$(env_var OPS_CALLMEBOT_PHONE)"
KEY="$(env_var OPS_CALLMEBOT_API_KEY)"
if [ -z "$SLACK" ] && [ -z "$PHONE" ] && [ -z "$KEY" ]; then
  # The app's own fallback: the tutor's CallMeBot channel.
  PHONE="$(env_var CALLMEBOT_PHONE)"; KEY="$(env_var CALLMEBOT_API_KEY)"
fi
if [ -n "$PHONE" ] && [ -n "$KEY" ]; then
  answer="$(printf 'url = "https://api.callmebot.com/whatsapp.php"\n' | curl -sS --max-time 15 -K - -G \
    --data-urlencode "phone=$PHONE" --data-urlencode "text=$MSG" --data-urlencode "apikey=$KEY" 2>&1)"
  if printf '%s' "$answer" | grep -qiE 'queued|sent'; then sent=1; echo "health-alert: sent to whatsapp."
  else failed=1; echo "health-alert: CallMeBot refused: $(printf '%s' "$answer" | head -c 120)" >&2; fi
elif [ -n "$PHONE$KEY" ]; then
  echo "health-alert: only one of OPS_CALLMEBOT_PHONE / OPS_CALLMEBOT_API_KEY is set." >&2
  failed=1
fi

if [ "$sent" = 1 ]; then
  mkdir -p "$(dirname "$STAMP")" && date +%s > "$STAMP"
fi
if [ "$sent" = 0 ]; then
  echo "health-alert: $UNIT FAILED AND NOBODY WAS TOLD — no ops channel in $ENV_FILE could be reached." >&2
  exit 1
fi
[ "$failed" = 0 ] || exit 1
