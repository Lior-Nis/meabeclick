// tests/characterization/fake-google.mjs
//
// A fake Google for the test server only: harness.mjs loads it with
// `node --import` when a test asks for `fakeGoogle`. It answers the service
// account's sign-in and the calendar's event writes, records every request
// it answers (one JSON line each, in $FAKE_GOOGLE_LOG), and lets every
// other request through to the real fetch. Production code has no hook for
// it: the app makes its ordinary calls to Google, and this stands in front.
import { appendFileSync } from 'node:fs';

const realFetch = globalThis.fetch;
const GOOGLE = new Set(['oauth2.googleapis.com', 'www.googleapis.com']);
let events = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!GOOGLE.has(url.hostname)) return realFetch(input, init);

  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  appendFileSync(process.env.FAKE_GOOGLE_LOG, JSON.stringify({
    method: init.method ?? 'GET', url: url.href, headers, body: init.body == null ? null : String(init.body),
  }) + '\n');

  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
    return answer(200, { access_token: 'fake-token', expires_in: 3600, token_type: 'Bearer' });
  }
  if (init.method === 'POST' && /^\/calendar\/v3\/calendars\/[^/]+\/events$/.test(url.pathname)) {
    events += 1;
    return answer(200, { id: `fake-event-${events}` });
  }
  return answer(404, { error: 'not faked' });
};
