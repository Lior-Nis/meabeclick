/**
 * Telling "email is not configured" apart from "email is configured and
 * Google is refusing it".
 *
 * On 2026-09-20 the box's Gmail app password was being rejected —
 * `535-5.7.8 … BadCredentials`, the signature of a password revoked when
 * the account holder changes their Google password. It had worked on
 * 2026-09-18. Nothing anywhere said it had stopped.
 *
 * All outbound mail shares one transport, so the whole of it was down:
 * booking confirmations, the family's portal link, and the hourly report
 * prompts. Two of those fail silently by design — /api/request-link always
 * answers ok:true so it cannot confirm which addresses are on file, and a
 * booking must not be lost because mail failed. Those are the right calls,
 * and together they mean a revoked password can sit unnoticed indefinitely.
 *
 * It surfaced only because #74 gave the weekly reminder an email fallback
 * that answers 503 when it cannot send. That is one route, once a week.
 *
 * So: the hourly prompt timer, which already runs and already exists to
 * send mail, now checks the transport on the runs where it sent nothing.
 * No new unit, no change on the box — a revoked credential becomes a
 * failing hourly job within the hour.
 *
 * The distinction these tests pin is the whole point. Unconfigured is a
 * legitimate state (every dev machine, this test suite) and must stay a
 * 200. Configured-and-refused is a production incident and must not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { emailConfigured, verifyEmailTransport } = await import('../../src/lib/server/email.ts');

function withEnv(vars, fn) {
  const had = {};
  for (const [k, v] of Object.entries(vars)) {
    had[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return (async () => {
    try { return await fn(); }
    finally {
      for (const [k, v] of Object.entries(had)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  })();
}

test('no credentials is "not configured", not "broken"', async () => {
  await withEnv({ GMAIL_USER: undefined, GMAIL_APP_PASSWORD: undefined }, async () => {
    assert.equal(emailConfigured(), false);
    const res = await verifyEmailTransport();
    // Nothing to verify. A dev machine and this suite are both here, and
    // neither is an incident.
    assert.equal(res.configured, false);
    assert.equal(res.ok, false);
  });
});

test('half-configured is not configured', async () => {
  await withEnv({ GMAIL_USER: 'someone@example.com', GMAIL_APP_PASSWORD: undefined }, async () => {
    assert.equal(emailConfigured(), false, 'a user without a password cannot send');
  });
});

test('credentials present means configured, whatever Google then says', async () => {
  await withEnv({ GMAIL_USER: 'someone@example.com', GMAIL_APP_PASSWORD: 'x'.repeat(16) }, () => {
    assert.equal(emailConfigured(), true);
  });
});

test('a rejected credential reports configured-but-not-ok, with the reason', async () => {
  await withEnv({ GMAIL_USER: 'someone@example.com', GMAIL_APP_PASSWORD: 'x'.repeat(16) }, async () => {
    // Points at a port nothing is listening on, so verify() fails fast
    // without reaching Google. What matters is the shape of the answer:
    // configured, not ok, and a reason an operator can act on.
    const res = await verifyEmailTransport({ host: '127.0.0.1', port: 1, connectionTimeout: 1500 });
    assert.equal(res.configured, true, 'credentials were present — this is not "unconfigured"');
    assert.equal(res.ok, false);
    assert.ok(res.reason && res.reason.length > 0, 'an operator reads only this line');
  });
});
