// tests/characterization/auth.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

test('rejects a wrong password with 401 and the Hebrew message', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'סיסמה שגויה' });
  } finally { await stop(); }
});

test('issues an HttpOnly session cookie on correct password', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.getSetCookie().find(c => c.startsWith('maab_session='));
    assert.ok(cookie, 'expected a maab_session cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
  } finally { await stop(); }
});

test('guarded API route answers 401 JSON without a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/results`);
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
  } finally { await stop(); }
});

test('guarded page redirects to login without a session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/app/dashboard`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    // requireAuth (src/lib/server/auth.ts) redirects to the extensionless
    // '/login' route with a ?next= parameter carrying where she was going,
    // so a lapsed session doesn't swallow the destination (e.g., a report form).
    assert.equal(r.headers.get('location'), '/login?next=%2Fapp%2Fdashboard');
  } finally { await stop(); }
});

test('logout clears the cookie', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(r.status, 200);
    const cleared = r.headers.getSetCookie().find(c => c.startsWith('maab_session='));
    assert.match(cleared, /Max-Age=0/);
  } finally { await stop(); }
});
