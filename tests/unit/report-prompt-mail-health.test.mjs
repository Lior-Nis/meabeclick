/**
 * The hourly prompt job as the thing that notices mail has stopped.
 *
 * See email-transport-health.test.mjs for what happened on 2026-09-20 and
 * why nothing reported it. This pins the route half: which runs check, and
 * what they answer.
 *
 * Stubs rather than the harness, because the real check opens an SMTP
 * connection to Google. The harness strips Gmail credentials precisely so
 * no test reaches the network, and a characterization test for this branch
 * would have had to undo that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const SERVER_ROOT = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/server') + '/',
).href;

globalThis.__mail = { configured: true, ok: false, reason: 'Invalid login: 535-5.7.8 BadCredentials' };
globalThis.__candidates = [];
globalThis.__sendResult = false;

register(
  `data:text/javascript,${encodeURIComponent(`
    const stub = (src) => ({ url: 'data:text/javascript,' + encodeURIComponent(src), shortCircuit: true, format: 'module' });
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('/email.ts')) return stub(\`
        export function emailConfigured() { return globalThis.__mail.configured; }
        export async function verifyEmailTransport() { return globalThis.__mail; }
        export async function sendReportPromptEmail() { return globalThis.__sendResult; }
      \`);
      if (specifier.endsWith('/reports/store.ts')) return stub(\`
        export function promptCandidates() { return globalThis.__candidates; }
        export function markPrompted() {}
      \`);
      if (specifier.endsWith('/plans/store.ts')) return stub(\`
        export function planForEnrollment() { return null; }
        export function planData() { return { nodes: [], prereqs: [], events: [] }; }
        export function lastLessonAt() { return null; }
      \`);
      if (specifier.endsWith('/plans/view.ts')) return stub('export function buildTree() { return []; }');
      if (specifier.startsWith('$server/')) {
        const rest = specifier.slice('$server/'.length);
        return nextResolve(new URL(rest, ${JSON.stringify(SERVER_ROOT)}).href, context);
      }
      return nextResolve(specifier, context);
    }
  `)}`,
  import.meta.url,
);

process.env.CRON_KEY = 'test-cron-key';
const { POST } = await import('../../src/routes/api/reports/prompt/+server.ts');

const run = () => POST({
  request: new Request('http://localhost/api/reports/prompt', {
    method: 'POST', headers: { 'x-cron-key': 'test-cron-key' },
  }),
});

test('a quiet hour with refused credentials fails the run', async () => {
  globalThis.__candidates = [];
  globalThis.__mail = { configured: true, ok: false, reason: 'Invalid login: 535-5.7.8 BadCredentials' };

  const res = await run();
  assert.equal(res.status, 503, 'a 2xx here is how a dead mailbox went unnoticed for two days');
  const body = await res.json();
  assert.equal(body.mail, 'rejected');
  assert.match(body.reason, /535/, 'the journal line must carry what Google actually said');
});

test('an unconfigured machine is not an incident', async () => {
  globalThis.__candidates = [];
  globalThis.__mail = { configured: false, ok: false, reason: 'not configured' };

  const res = await run();
  // Every dev machine and this suite live here. Failing them would train
  // everyone to ignore the failure that matters.
  assert.equal(res.status, 200);
  assert.equal((await res.json()).considered, 0);
});

test('a run that actually sent something does not re-check', async () => {
  globalThis.__candidates = [{ bookingId: 1, studentName: 'ל', subject: null, start: '2026-09-01T10:00:00Z', enrollmentId: null, studentId: 1 }];
  globalThis.__sendResult = true;
  // Would report broken if consulted — the point is that it is not.
  globalThis.__mail = { configured: true, ok: false, reason: 'should never be read' };

  const res = await run();
  assert.equal(res.status, 200, 'the send itself proved the transport works');
  const body = await res.json();
  assert.equal(body.emailed, 1);
  assert.equal(body.mail, undefined);
});

test('candidates that all failed to send still fail the run', async () => {
  globalThis.__candidates = [{ bookingId: 1, studentName: 'ל', subject: null, start: '2026-09-01T10:00:00Z', enrollmentId: null, studentId: 1 }];
  globalThis.__sendResult = false;
  globalThis.__mail = { configured: true, ok: false, reason: 'Invalid login: 535-5.7.8' };

  const res = await run();
  // This is the worst case, not the mildest: mail is broken AND a real
  // prompt was owed. It used to answer 200 with skipped:1.
  assert.equal(res.status, 503);
  assert.equal((await res.json()).skipped, 1);
});
