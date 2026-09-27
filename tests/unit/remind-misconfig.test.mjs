/**
 * /api/remind's answer when it cannot possibly send.
 *
 * The weekly WhatsApp reminder has three failure paths. Two of them — a
 * CallMeBot outage and a thrown fetch — already answer 500, so the systemd
 * unit's `curl --fail` marks the run failed and the journal says so.
 *
 * The third, an unset CALLMEBOT_API_KEY, used to answer 200 with
 * `{ ok: false }`. curl reads the status, not the body, so systemd recorded
 * `success` for a job that had sent nothing — verified on the live box on
 * 2026-09-18, where the unit reported success while the body said the key
 * was missing.
 *
 * It is also the one failure that never recovers on its own: an outage
 * fixes itself, a missing key does not, and the job is weekly, so nobody
 * would notice for a long time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Route files import through the Vite-only `$server` alias, which plain
// `node --test` cannot resolve. Same process-scoped hook the write-path
// test uses; it maps the alias and stubs nothing.
const SERVER_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/server') + '/',
).href;
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith('$server/')) {
        const rest = specifier.slice('$server/'.length);
        return nextResolve(new URL(rest, ${JSON.stringify(SERVER_ROOT)}).href, context);
      }
      /* And \$lib, which route files use for shared data like contact.ts. */
      if (specifier.startsWith('$lib/')) {
        const rest = specifier.slice('$lib/'.length);
        return nextResolve(new URL('../' + rest, ${JSON.stringify(SERVER_ROOT)}).href, context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

process.env.CRON_KEY = 'test-cron-key';
/* These tests are about the answer when NOTHING can send, so the email
   fallback must be unavailable too — and on a developer machine that has
   Gmail credentials in the environment, leaving them set would have this
   unit test mail the tutor for real. */
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
const { GET } = await import('../../src/routes/api/remind/+server.ts');

const call = () =>
  GET({ request: new Request('http://localhost/api/remind', { headers: { 'x-cron-key': 'test-cron-key' } }) });

test('with neither channel available the request fails, so the timer cannot report success', async () => {
  const had = process.env.CALLMEBOT_API_KEY;
  delete process.env.CALLMEBOT_API_KEY;
  try {
    const res = await call();
    assert.equal(res.status, 503, 'a 2xx here lets `curl --fail` call a send-nothing run a success');
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.reason, /CALLMEBOT_API_KEY/);
  } finally {
    if (had !== undefined) process.env.CALLMEBOT_API_KEY = had;
  }
});

test('the reason names both channels, so the fix is obvious from the journal', async () => {
  const had = process.env.CALLMEBOT_API_KEY;
  delete process.env.CALLMEBOT_API_KEY;
  try {
    const body = await (await call()).json();
    // The journal line is all an operator sees. Since #73 an unset
    // CallMeBot key alone is no longer fatal — email carries the reminder
    // — so a reason naming only CALLMEBOT_API_KEY would send them to fix
    // the wrong half.
    assert.match(body.reason, /CALLMEBOT_API_KEY/);
    assert.match(body.reason, /GMAIL_USER/);
  } finally {
    if (had !== undefined) process.env.CALLMEBOT_API_KEY = had;
  }
});

test('a wrong cron key is still refused before any of this', async () => {
  const res = await GET({
    request: new Request('http://localhost/api/remind', { headers: { 'x-cron-key': 'wrong' } }),
  });
  assert.equal(res.status, 401);
});
