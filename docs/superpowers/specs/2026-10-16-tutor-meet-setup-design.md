# A tutor connects their Meet room from a setup link

**Status:** approved in conversation 2026-10-16, written for review.
**Builds on:** #46 (online or in person), which added `teachers.meet_url` and
attaches it to every online lesson's calendar event, family email and
reminder. Until now that column could only be set by hand, on the server.

## Goal

A tutor's fixed Google Meet room gets into the app with the least possible
work from the tutor, and none from anyone else:

1. The owner taps "שליחת קישור הגדרה" next to the tutor in the dashboard and
   sends the link on WhatsApp.
2. The tutor opens it on their phone and taps one button, "התחברות עם Google".
3. On Google's screens they pick their account, pass the one-time "this app
   isn't verified" screen, and tap Allow.
4. They land on "מוכן ✓" with their room's link. From then on every online
   lesson carries it.

Nobody copies a Meet link, messages it to anyone, or opens a shell.

## Why the tutor has to be the one who creates the room

On a free Google account only a meeting's creator can admit someone who
knocks. A room the site's own Google identity created would leave families
knocking on a door nobody in the lesson can open. So the room must be created
*as the tutor*, which needs the tutor's consent. That consent is the one
login in the flow.

## Decisions

| | Decision | Why |
|---|---|---|
| D1 | Entry is a **setup link** the owner sends; no dashboard password for the tutor | Smallest change, fewest tutor steps |
| D2 | **Families knock**; the tutor admits them | The link never changes, so a family that keeps it must not walk into another child's lesson |
| D3 | The room is created with the **Meet REST API** (`spaces.create`), scope `meetings.space.created` | Smallest permission (only rooms this app made), nothing added to the tutor's calendar |
| D4 | **Fallback, only if the spike fails:** create the room through one event on the tutor's own calendar (scope `calendar.events`) | Known to work on free accounts; broader permission and a leftover event, hence second |
| D5 | The Google permission is **used once and revoked**; no refresh token is stored | Nothing to expire, be revoked by a password change, or leak later |
| D6 | The flow also asks for the account's **email** (`openid email`) and shows it | The tutor must be signed into Meet with that account to be the host; a wrong account is the likeliest mistake |
| D7 | No Google app verification for now | `meetings.space.created` is a *sensitive* scope, so tutors see the unverified-app screen once; verification takes weeks and a demo video, and there are two tutors. The setup page warns about the screen in advance |

## Step 1 is a spike, and it can change D3

Google's documentation does not say whether a personal (`@gmail.com`)
account may call `spaces.create`, nor whether it honours `accessType`. Before
any product code:

- Enable the Google Meet REST API in the existing Cloud project (the one the
  Calendar service account and the Drive backup client live in).
- Run a throwaway script, in the scratchpad and never committed, shaped like
  `server/drive/authorize.mjs`. It uses the existing **Desktop** OAuth client
  and a loopback redirect, asks for `openid email meetings.space.created`,
  and the owner consents with their own Google account. Then it calls
  `POST https://meet.googleapis.com/v2/spaces` with
  `{"config":{"accessType":"RESTRICTED"}}`, prints the returned
  `config.accessType` and whether a `meetingUri` came back, and revokes the
  token.
- By hand: open the `meetingUri` signed in as the owner (they should be the
  host), then in a private window (they should have to ask to join, and the
  owner should be able to admit them).

**Pass:** a room comes back, `accessType` is `RESTRICTED`, and a stranger
knocks. Then build D3. **Fail:** build D4 instead, and say so before
building. If the room comes back but `accessType` does not hold, report that
too: knocking might still be the free-account default, and that gets checked
by hand before choosing.

## How it works

### The setup link

- `POST /api/teachers/[id]/setup-link` (dashboard session, `apiAuthDenied`)
  mints 32 random bytes as base64url and stores **only their SHA-256**, with
  an expiry 7 days ahead, on the teacher row. It returns
  `${SITE_URL}/app/tutor-setup/<code>`, built the way the family links are
  (`enterLink` in `family-auth.ts`).
- Minting replaces the previous code, so only the newest link works. Success
  clears it, so a link works once.
- Looking a code up is: hash it, find the teacher whose `setup_hash` matches
  and whose `setup_expires` is in the future.

### Migration 028

```sql
ALTER TABLE teachers ADD COLUMN setup_hash TEXT;
ALTER TABLE teachers ADD COLUMN setup_expires TEXT;  -- ISO timestamp
ALTER TABLE teachers ADD COLUMN meet_account TEXT;   -- the Google account that owns meet_url
```

### Pages and endpoints

| Route | Auth | Does |
|---|---|---|
| `/app/tutor-setup/[code]` | the code | Hello, tutor's name, one sentence on what happens, a note about Google's warning screen ("לחצו 'מתקדם' ואז 'המשך'"), and the button. An invalid or expired code shows "הקישור פג תוקף או כבר נוצל, בקשו קישור חדש". |
| `GET /api/tutor-setup/start?code=` | the code | Re-checks the code, sets the setup cookie, and redirects (303) to Google's consent URL. It is a plain link, not a form, because `form-action 'self'` in the CSP would block a form's redirect to Google. |
| `GET /app/tutor-setup/callback` | the setup cookie | A `+server.ts` that finishes the flow (below) and redirects (303). It does not render, so a phone that reloads the tab does not replay Google's one-time code. |
| `/app/tutor-setup/done` | the setup cookie | "מוכן ✓" with the room, or "החיבור לא הושלם" when there is no finished setup to show. |

`/app` has no layout-level guard (the dashboard calls `requireAuth` itself),
so these pages are public by default, which is what they need. `callback`
and `done` are static segments, so they win over `[code]`. Opening the setup
page changes nothing, so WhatsApp's link preview cannot use a link up.

### The Google round trip

**Consent URL** (`https://accounts.google.com/o/oauth2/v2/auth`):
- `client_id`: the new web client.
- `redirect_uri`: `${SITE_URL}/app/tutor-setup/callback`.
- `response_type=code`, `scope=openid email meetings.space.created`.
- `access_type=online`, so Google issues no refresh token.
- `prompt=select_account consent`, so the tutor always picks the account explicitly.
- `state`: a random nonce.

**The "same phone" check.** `start` sets the cookie `maab_tutor_setup`:
- **Flags:** httpOnly, Secure over https, SameSite=Lax (sent on Google's
  top-level redirect back), Path `/app/tutor-setup`, Max-Age 15 minutes.
- **Value:** `s.teacherId.code.nonce.expiry`, HMAC-signed with
  `SESSION_SECRET` like the family tokens, under its own prefix. It carries
  the code itself, not its hash, so a failure can send the tutor back to
  their own setup page with the button. After success it is replaced by
  `d.teacherId.-.-.expiry`, which is what the done page reads.

**Callback.** A `d` cookie means the setup already finished (a reloaded
tab), so it goes straight to the done page and calls nothing. Otherwise it
requires all of the following, or ends on "החיבור לא הושלם, פתחו שוב את הקישור":
- the cookie verifies;
- `state` equals the cookie's nonce;
- the cookie's code still belongs to that teacher and has not expired. If
  it does not (the owner sent a newer link meanwhile), the tutor goes back to
  that setup page, which now says the link expired.

Then:
1. If Google returned `error` (for example `access_denied`), go back to the
   setup page with "לא אישרתם, אפשר לנסות שוב" and the button. The code is
   **not** consumed.
2. Exchange `code` at `https://oauth2.googleapis.com/token`. Read `email`
   from the returned `id_token` payload. It came straight from Google's
   token endpoint over TLS, so it needs no signature check.
3. `POST https://meet.googleapis.com/v2/spaces` with `accessType: RESTRICTED`.
4. Revoke the access token at `https://oauth2.googleapis.com/revoke`. Failing
   to revoke is logged but not fatal, because the token expires within the hour anyway.
5. In one statement, set `meet_url` = `meetingUri`, `meet_account` = email,
   and clear `setup_hash`/`setup_expires`.
6. Replace the cookie with the `d` cookie and redirect to the done page, which shows "מוכן ✓":
   - the room link and a "פתיחת החדר" button;
   - "החדר נפתח בחשבון <email>. היכנסו ל-Meet עם החשבון הזה כדי שתוכלו להכניס משפחות."

If step 2 or 3 fails, or the room's link is not an `https://meet.google.com/`
address, go back to the setup page with "משהו השתבש מול Google, נסו שוב בעוד
רגע" and the button. The code is not consumed. The log line carries the step and the
HTTP status only, never Google's body (it can echo request details, as
`drive/api.ts` already notes).

A new room only affects lessons booked afterwards. Lessons booked earlier
keep the old link, which still works.

### Configuration

New server settings: `GOOGLE_WEB_CLIENT_ID` and `GOOGLE_WEB_CLIENT_SECRET`.
This is a second OAuth client, of type **Web application**, in the same
project, with the redirect URI `https://meabeclick.com/app/tutor-setup/callback`.
The existing Desktop client (Drive backups) cannot receive a redirect to a
website.

Unset means the feature is off:
- the dashboard card says the Google connection is not set up on the server, and offers no link;
- `start` shows the same instead of redirecting.

This is not a boot check, because the rest of the site works without it.

The consent screen is already External and In production (for the Drive
backups), so tutors are not limited to a test-user list, and no setting
there changes.

### Dashboard: the "מורים" card

The dashboard gets a "מורים" card with one row per active teacher:
- **Name.**
- **Room status:** ✓ with `meet_account` and an "open the room" link, or ✗ "אין חדר Meet".
- **The "שליחת קישור הגדרה" button** mints a link, then offers:
  - **WhatsApp:** `wa.me/<phone>?text=…` when the teacher has a phone, `wa.me/?text=…` otherwise.
  - **Copy.**

The message text is the link plus one line on what it is for.

`setTeacherMeetUrl` and its "by hand, on the server" comment are replaced by
the accessor the callback uses.

## Out of scope

- **Choosing the tutor per booking.** `upsertEnrollment` still assigns the
  default teacher on every booking. So until that changes, every online
  lesson carries the default teacher's room, whichever tutor teaches it.
  This feature makes each tutor's room settable; routing lessons to the
  right tutor is a separate change.
- Google app verification (D7).
- A fresh room per lesson. That would need a stored refresh token, which D5 rules out.
- Tutors signing into the dashboard with Google.

## Testing

- **Unit:**
  - **Code minting and lookup:** hash only, expiry, replacement by a newer code, consumption.
  - **The setup cookie:** sign, verify, tamper, expiry.
  - **The Google client, with `fetch` injected:** the consent URL's parameters, the token exchange, `id_token` email extraction, the `spaces.create` body, revoke, and every error branch mapping to a status-only error.
- **Characterization**, against the built server through the harness:
  - `setup-link` without a session → 401;
  - with a session → a link whose page names the teacher;
  - an unknown or expired code → the expired page;
  - `start` with a valid code → 302 to Google with the expected parameters and the cookie set (web client env set in the harness);
  - `start` with the client unset → the "not set up" page;
  - `callback` with a bad state, a missing cookie, or `error=access_denied` → the matching page, with the code still valid afterwards.
- **Browser:** Playwright at 320, 375, 390, 430 and 1280 px:
  - the setup page, the expired page and the "not set up" page;
  - the dashboard card in both states;
  - the WhatsApp and copy controls.
- **Production proof:** the owner opens their own setup link, connects, and
  the dashboard shows ✓ with their account. How a teacher's `meet_url`
  reaches a booking is already covered by #46. But because of the
  out-of-scope limitation above, bookings carry the *default* teacher's
  room. So the booking side is proven once the default teacher has
  connected too, on the next online booking.
