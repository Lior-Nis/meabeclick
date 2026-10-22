/**
 * The calendar robot writes a lesson into a tutor's lesson calendar.
 *
 * Moved out of /api/book so the write can be tested with Google faked, and
 * so the calendar is a parameter: each tutor has their own (migration 029),
 * and there is no global one to fall back to.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ServiceAccount { email: string; privateKey: string }

/**
 * Service-account credentials.
 *
 * Preferred: GOOGLE_SERVICE_ACCOUNT_KEY_FILE, the path to the JSON Google
 * gives you. A PEM cannot survive a round trip through an env file —
 * systemd's EnvironmentFile eats the backslashes, so "\n" arrives as "n"
 * and the key no longer decodes. Reading the file keeps the newlines
 * intact. Read on every booking, so a key swapped in place is used at once.
 */
export function serviceAccount(): ServiceAccount | null {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
  if (file) {
    try {
      const j = JSON.parse(readFileSync(file, 'utf8'));
      if (j.client_email && j.private_key) {
        return { email: j.client_email, privateKey: j.private_key };
      }
      console.error('[book] key file is missing client_email/private_key');
    } catch (err) {
      console.error('[book] cannot read key file:', (err as Error).message);
    }
    return null;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!email || !raw) return null;

  const privateKey = raw.replace(/\\n/g, '\n');
  if (!privateKey.includes('\n')) {
    console.error('[book] private key has no line breaks — set GOOGLE_SERVICE_ACCOUNT_KEY_FILE instead');
    return null;
  }
  return { email, privateKey };
}

function b64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}

function buildJWT(email: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(data);
  const signature = sign.sign(privateKey, 'base64url');
  return `${data}.${signature}`;
}

/** The robot's sign-in. Exported for the daily ops health check, which
 *  proves the key still works without writing anything. */
export async function getAccessToken(sa: ServiceAccount, fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: buildJWT(sa.email, sa.privateKey),
    }),
  });

  /* Read as text first — Google doesn't always return JSON (a plain
     "Forbidden." body has been seen here). Parsing straight to JSON on a
     non-OK response crashed with an opaque "Unexpected token" instead of
     the actual reason the token request failed. */
  const raw = await r.text();
  if (!r.ok) throw new Error(`Token error ${r.status}: ${raw.slice(0, 300)}`);

  let data: { access_token?: string };
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Token response was not JSON: ${raw.slice(0, 300)}`);
  }
  return data.access_token ?? '';
}

/** Writes the event into `calendarId` and returns it. Throws with Google's
 *  answer on any failure, for the caller to flag (flagCalendarFailure). */
export async function insertLessonEvent(
  sa: ServiceAccount, calendarId: string, event: unknown, fetchImpl: typeof fetch = fetch,
): Promise<{ id: string }> {
  const token = await getAccessToken(sa, fetchImpl);
  const r = await fetchImpl(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    },
  );
  if (!r.ok) {
    const errBody = await r.text();
    throw new Error(`Calendar error ${r.status}: ${errBody.slice(0, 300)}`);
  }
  return await r.json();
}
