/**
 * "Email me my link again", when email cannot be sent at all.
 *
 * This endpoint answers identically whether the address matched an
 * account, matched nothing, or matched an account whose mail bounced —
 * deliberately, because anything else makes it a membership oracle: type
 * an address, learn whether that family uses the tutor. For a service
 * whose customers are named children that is not hypothetical.
 *
 * That reasoning is about facts that differ PER ADDRESS. It does not cover
 * the whole mailer being down, which is true for every address at once and
 * so reveals nothing about any of them. Today it was down — the Gmail app
 * password is being refused (see email-transport-health.test.mjs) — and
 * this endpoint kept answering ok:true to parents who then received
 * nothing, with no way to tell.
 *
 * It matters more than it looks. The booking page, when the confirmation
 * email fails, tells the family «שמרו את הקישור — אפשר תמיד לבקש חדש מדף
 * הכניסה»: save the link, you can always request a new one from the entry
 * page. That sentence points at exactly this endpoint. So in the one case
 * where the family most needs the fallback, we promised a recovery that
 * could not work and reported success.
 *
 * The check runs BEFORE the account lookup and before the throttle, so
 * every address gets the same answer and the oracle stays shut. A per-
 * address bounce is unchanged: still ok:true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/server') + '/',
).href;
const LIB_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib') + '/',
).href;

globalThis.__rejected = false;
globalThis.__accounts = new Set(['known@example.com']);
globalThis.__sends = [];

register(
  `data:text/javascript,${encodeURIComponent(`
    const stub = (src) => ({ url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true, format: 'module' });
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('/email.ts')) return stub(\`
        export async function mailCredentialsRejected() { return globalThis.__rejected; }
        export async function sendPortalLinkEmail(to) { globalThis.__sends.push(to); return true; }
      \`);
      if (specifier.endsWith('/entities.ts')) return stub(\`
        export function normalizeEmail(v) { return typeof v === 'string' ? v.trim().toLowerCase() : ''; }
        export function findAccountByEmail(e) { return globalThis.__accounts.has(e) ? { id: 1, name: 'משפחה' } : null; }
      \`);
      if (specifier.endsWith('/family-auth.ts')) return stub("export function accountLink() { return 'https://example.com/enter?t=x'; }");
      if (specifier.startsWith('$server/')) {
        const rest = specifier.slice('$server/'.length);
        return nextResolve(new URL(rest, ${JSON.stringify(SERVER_ROOT)}).href, context);
      }
      // The mail-down error message now names the roster's contact tutor
      // (src/lib/tutors.ts) instead of a hardcoded 'ניקול' — resolved for
      // real, same as $server/*, rather than stubbed: the point of this
      // test is the mail-down behaviour, and tutors.ts has no side effects
      // worth mocking.
      if (specifier.startsWith('$lib/')) {
        const rest = specifier.slice('$lib/'.length);
        return nextResolve(new URL(rest, ${JSON.stringify(LIB_ROOT)}).href, context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

const { POST } = await import('../../src/routes/api/request-link/+server.ts');

const ask = (email) => POST({
  request: new Request('http://localhost/api/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }),
});

test('a refused mail credential is reported, not hidden behind ok:true', async () => {
  globalThis.__rejected = true;
  globalThis.__sends = [];

  const res = await ask('known@example.com');
  assert.equal(res.status, 503, 'ok:true here is a promise we cannot keep');
  const body = await res.json();
  assert.notEqual(body.ok, true);
  assert.ok(body.error && body.error.length > 0, 'the parent needs to know to try another way');
  assert.equal(globalThis.__sends.length, 0);
});

test('the oracle stays shut: a broken mailer answers every address the same', async () => {
  globalThis.__rejected = true;

  const known = await ask('known@example.com');
  const unknown = await ask('nobody@example.com');

  // The whole reason this endpoint is careful. If "mail is down" were
  // reported only for addresses on file, the failure itself would answer
  // the question the ok:true exists to refuse.
  assert.equal(known.status, unknown.status);
  assert.deepEqual(await known.json(), await unknown.json());
});

test('a working mailer is unaffected, and still tells nobody who exists', async () => {
  globalThis.__rejected = false;
  globalThis.__sends = [];

  const known = await ask('known@example.com');
  const unknown = await ask('nobody@example.com');

  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.deepEqual(globalThis.__sends, ['known@example.com'], 'only the real account is mailed');
});

test('a malformed address is still answered as a request problem', async () => {
  globalThis.__rejected = true;
  // About the request, not about who exists — and checked before the mail
  // state, so a typo is still corrected rather than blamed on the mailer.
  const res = await ask('not-an-address');
  assert.equal(res.status, 400);
});
