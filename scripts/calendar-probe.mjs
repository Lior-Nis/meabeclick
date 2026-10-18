/**
 * Proves a Google service-account key can write lessons: signs in as the
 * key's robot, inserts one test event into the lesson calendar, deletes it.
 *
 *   node scripts/calendar-probe.mjs <key.json> <calendar id>...
 *   CALENDAR_ID=<lesson calendar id> node scripts/calendar-probe.mjs <key.json>
 *
 * scripts/connect-calendar.sh runs it on the server twice: once in a
 * throwaway container against the NEW key before anything is swapped, and
 * once inside the running app against the file the app actually reads. The
 * runtime image has no scripts/ directory, so the script travels on stdin
 * (`node --input-type=module - <key.json>`), which is why it imports
 * nothing but node built-ins.
 *
 * The sign-in is the same JWT bearer grant src/routes/api/book/+server.ts
 * makes for every booking, written out again here because a route module
 * cannot be piped into a container. Only the key's email and the calendar's
 * answers are ever printed — never the key, never the calendar id.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Dated long before any booking window and marked free, so a copy left
 *  behind by a failed delete can never block a lesson slot. */
const TEST_EVENT = {
  summary: 'בדיקת חיבור של האתר — אפשר למחוק',
  start: { dateTime: '2000-01-01T08:00:00Z' },
  end: { dateTime: '2000-01-01T08:15:00Z' },
  transparency: 'transparent',
};

const b64url = s => Buffer.from(s).toString('base64url');

function assertion(key, now) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${claims}`);
  return `${header}.${claims}.${sign.sign(key.private_key, 'base64url')}`;
}

/** Google's answer, cut short. Bodies are not always JSON. */
async function said(r) {
  return `${r.status} ${(await r.text()).slice(0, 300)}`;
}

/**
 * @returns the robot's email, once a test event was written and deleted.
 * @throws Error naming the step that failed: sign-in, write, or delete.
 */
export async function probeCalendarWrite({ key, calendarId, fetchImpl = fetch, now = new Date() }) {
  if (!key?.client_email || !key?.private_key) {
    throw new Error('not a service-account key (it needs client_email and private_key)');
  }
  const robot = key.client_email;

  const tok = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion(key, now),
    }).toString(),
  });
  if (!tok.ok) throw new Error(`sign-in as ${robot} failed: ${await said(tok)}`);
  const { access_token: token } = await tok.json();
  const auth = { Authorization: `Bearer ${token}` };

  const events = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const ins = await fetchImpl(events, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_EVENT),
  });
  if (!ins.ok) {
    throw new Error(`write failed: ${await said(ins)} — is the lesson calendar shared with ${robot}, `
      + 'with permission "Make changes to events"?');
  }
  const { id } = await ins.json();

  const del = await fetchImpl(`${events}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth });
  // 410: already gone, which is the state this step exists to reach.
  if (!del.ok && del.status !== 410) {
    throw new Error(`delete failed: ${await said(del)} — test event ${id} (dated 2000-01-01, marked free) `
      + 'was left on the lesson calendar; it blocks nothing and can be deleted by hand');
  }
  return robot;
}

const piped = process.argv[1] === '-' || process.argv[1] === undefined;
if (piped || import.meta.url.endsWith(String(process.argv[1]).split('/').pop())) {
  const file = process.argv[2];
  /* Every tutor's lesson calendar (connect-calendar.sh passes them all), or
     CALENDAR_ID for a single one. */
  const calendarIds = process.argv.length > 3 ? process.argv.slice(3) : [process.env.CALENDAR_ID].filter(Boolean);
  if (!file || !calendarIds.length) {
    console.error('usage: node calendar-probe.mjs <key.json> <calendar id>...  (or CALENDAR_ID=<id> node calendar-probe.mjs <key.json>)');
    process.exit(2);
  }
  let key;
  try {
    key = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // JSON.parse quotes the text it choked on, and this text is a key.
    console.error('calendar probe: the key file is missing or is not JSON');
    process.exit(1);
  }
  let robot = key.client_email;
  for (const [i, calendarId] of calendarIds.entries()) {
    try {
      robot = await probeCalendarWrite({ key, calendarId });
    } catch (err) {
      // By position, never by id: the calendar id names a person.
      console.error(`calendar probe: lesson calendar ${i + 1} of ${calendarIds.length}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`ok: ${robot} wrote and deleted a test event in ${calendarIds.length} lesson calendar(s)`);
}
