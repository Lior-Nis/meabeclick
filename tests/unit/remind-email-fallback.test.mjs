/**
 * The weekly calendar reminder, when WhatsApp is not configured.
 *
 * #70 made an unset CALLMEBOT_API_KEY answer 503 instead of a 200 that
 * `curl --fail` read as success. That was right — the run really had sent
 * nothing — and it worked: the box's journal shows
 * meabeclick-remind.service failing with curl (22) / 503 on Sat
 * 2026-09-19, the first Saturday after the deploy.
 *
 * What it did not do is get Nicole her reminder. The key has to be
 * obtained by messaging CallMeBot from her own phone, so the feature was
 * going to stay dark for as long as that took, failing loudly once a week
 * in the meantime.
 *
 * The same box already sends her email every hour — meabeclick-report-
 * prompt.service, through the same nodemailer transport. So an unset
 * WhatsApp key now falls back to email rather than giving up: the reminder
 * arrives, and the response says which channel carried it.
 *
 * 503 is still the answer when NEITHER channel can send. That is the case
 * #70 was actually about — a run that reported success having sent
 * nothing — and it stays loud.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/server') + '/',
).href;

/* Same alias hook as remind-misconfig.test.mjs, plus a stub for the email
   module: the point of these tests is which channel the route reaches for,
   and a real transport would reach Gmail. */
const sent = [];
globalThis.__remindSentMail = sent;
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('/email.ts') || specifier === '$server/email.ts') {
        return { url: 'data:text/javascript,' + encodeURIComponent(\`
          export async function sendCalendarReminderEmail(message) {
            if (!globalThis.__remindEmailWorks) return false;
            globalThis.__remindSentMail.push(message);
            return true;
          }
        \`), shortCircuit: true, format: 'module' };
      }
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
const { GET } = await import('../../src/routes/api/remind/+server.ts');

const call = () =>
  GET({ request: new Request('http://localhost/api/remind', { headers: { 'x-cron-key': 'test-cron-key' } }) });

function withoutWhatsApp(fn) {
  const had = process.env.CALLMEBOT_API_KEY;
  delete process.env.CALLMEBOT_API_KEY;
  return (async () => {
    try { return await fn(); }
    finally { if (had !== undefined) process.env.CALLMEBOT_API_KEY = had; }
  })();
}

test('no WhatsApp key, working email: the reminder still goes out', async () => {
  globalThis.__remindEmailWorks = true;
  sent.length = 0;
  await withoutWhatsApp(async () => {
    const res = await call();
    assert.equal(res.status, 200, 'the reminder was delivered — the run succeeded');
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.channel, 'email', 'the response must say which channel carried it');
    assert.equal(sent.length, 1, 'exactly one reminder');
    assert.match(sent[0], /20:00/, 'the email carries the same reminder text as the WhatsApp one');
  });
});

test('no WhatsApp key and no email either: still 503, still loud', async () => {
  globalThis.__remindEmailWorks = false;
  sent.length = 0;
  await withoutWhatsApp(async () => {
    const res = await call();
    assert.equal(res.status, 503, 'nothing was sent, so the timer must not record success');
    const body = await res.json();
    assert.equal(body.ok, false);
    // The operator reads one journal line. It has to name both channels,
    // or the fix looks like it is only about CallMeBot.
    assert.match(body.reason, /CALLMEBOT_API_KEY/);
    assert.match(body.reason, /GMAIL_USER|email/i);
    assert.equal(sent.length, 0);
  });
});

test('a wrong cron key is refused before either channel is touched', async () => {
  globalThis.__remindEmailWorks = true;
  sent.length = 0;
  const res = await GET({
    request: new Request('http://localhost/api/remind', { headers: { 'x-cron-key': 'wrong' } }),
  });
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});
