#!/usr/bin/env node
/**
 * One-time consent, to obtain a refresh token for mea.beclick@gmail.com.
 *
 * Run once, by hand, on a machine with a browser. Nothing here touches
 * production and nothing is written to disk — it prints the values to put in
 * .env on the VPS.
 *
 * ## Loopback, not copy-paste
 *
 * The obvious shape for this is Google's out-of-band flow: show a URL, let
 * the user paste back a code. Google BLOCKED that in January 2023 — any
 * request naming urn:ietf:wg:oauth:2.0:oob is rejected with invalid_request,
 * as a defence against app-impersonation phishing. Desktop clients must use
 * a loopback redirect, so this starts a throwaway server on 127.0.0.1 and
 * catches the code itself. It is also less to get wrong: no code to copy.
 *
 * ## Why a person and not the service account
 *
 * A service account has no Drive storage quota and cannot own files, so it
 * cannot hold backups for a consumer Google account. See ./client.mjs.
 *
 *   node server/drive/authorize.mjs <client-id> <client-secret>
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { DRIVE_SCOPE } from './client.mjs';

const [clientId, clientSecret] = process.argv.slice(2);

if (!clientId || !clientSecret) {
  console.error(`usage: node server/drive/authorize.mjs <client-id> <client-secret>

Create the client first — see server/README.md, "Off-box backups". It must be
an OAuth client ID of type "Desktop app", in the same Google Cloud project
the Calendar service account already uses, with the Drive API enabled.`);
  process.exit(1);
}

/** Guards against another local process answering the redirect. */
const state = randomBytes(16).toString('hex');

const { code, redirect } = await new Promise((resolve, reject) => {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') { res.writeHead(404).end(); return; }

    const err = url.searchParams.get('error');
    const got = url.searchParams.get('code');
    const back = url.searchParams.get('state');
    const redirect = `http://127.0.0.1:${server.address().port}`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (err || !got || back !== state) {
      res.end('<h1>לא הצליח</h1><p>אפשר לסגור את החלון ולנסות שוב.</p>');
      server.close();
      reject(new Error(err || (back !== state ? 'state mismatch — did another process answer?' : 'no code returned')));
      return;
    }
    res.end('<h1>מחובר</h1><p>אפשר לסגור את החלון ולחזור לטרמינל.</p>');
    server.close();
    resolve({ code: got, redirect });
  });

  server.on('error', reject);
  // Port 0: the OS picks a free one. Google accepts ANY port on the loopback
  // address for a Desktop client, so nothing has to be registered up front.
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', `http://127.0.0.1:${port}`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPE);
    // Both, together. Without access_type=offline there is no refresh token
    // at all; without prompt=consent Google returns one only on the very
    // first authorisation ever granted to this client, so a re-run to fix a
    // typo comes back without one and the failure looks like a code bug.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);

    console.log('\nOpen this, and sign in AS mea.beclick@gmail.com:\n');
    console.log(url.toString());
    console.log('\nWaiting for the browser to come back…');
  });
});

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    // Must match the redirect the code was issued for, exactly — same port.
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  }),
});

if (!res.ok) {
  console.error(`\nexchange failed: ${res.status}. The code is single-use and short-lived — just run this again.`);
  process.exit(1);
}

const { refresh_token: refreshToken } = await res.json();
if (!refreshToken) {
  console.error(`\nGoogle returned no refresh token.

That happens when this client has been authorised before. Revoke it at
myaccount.google.com/permissions (as mea.beclick@gmail.com) and run again.`);
  process.exit(1);
}

console.log(`
Add these to .env on the VPS (chmod 600, never committed):

GOOGLE_OAUTH_CLIENT_ID=${clientId}
GOOGLE_OAUTH_CLIENT_SECRET=<the secret you passed in>
GOOGLE_OAUTH_REFRESH_TOKEN=${refreshToken}

Then:  bash server/backup-db.sh

If the app's publishing status is still "Testing", this token stops working
after SEVEN DAYS and the backups quietly stop. Set it to "In production" —
see server/README.md.`);
