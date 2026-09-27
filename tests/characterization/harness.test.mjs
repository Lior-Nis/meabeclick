// tests/characterization/harness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

test('harness boots the built SvelteKit app and tears it down', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/me`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { authenticated: false });
  } finally {
    await stop();
  }
});

test('harness can log in and return a usable cookie', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const r = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    assert.deepEqual(await r.json(), { authenticated: true });
  } finally {
    await stop();
  }
});

test('the harness keeps lesson generation switched off', async () => {
  // The guard this asserts is easy to lose and expensive to lose quietly.
  // Generation used to be disabled purely by deleting CLAUDE_CODE_OAUTH_TOKEN
  // from the child's environment. Codex authenticates from a FILE instead
  // ($CODEX_HOME/auth.json), so on a developer machine that has run
  // `codex login` that deletion stops working, and every booking in this
  // suite starts spawning a real, billed agent run — slowly, and without
  // anything failing to say so.
  //
  // Asserted through a real booking rather than by reading harness.mjs: what
  // matters is that the server the tests drive cannot reach an agent.
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await fetch(`${baseUrl}/api/book`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'תלמיד בדיקה', subject: 'מתמטיקה', level: 'כיתה ט',
        phone: '0501234567', email: 'test@example.com', durationMin: 90,
        start: '2027-07-04T10:00:00+03:00', end: '2027-07-04T11:30:00+03:00',
      }),
    });
    assert.equal(booked.status, 200, 'the booking itself must still succeed');

    const { lessons } = await (await fetch(`${baseUrl}/api/lessons`, {
      headers: { Cookie: await login(baseUrl) },   // the feed is tutor-only
    })).json();
    assert.equal(lessons.length, 1, 'a skipped generation still records a row');
    assert.equal(lessons[0].status, 'failed');
    // The credential gate, not the daily cap and not a crash mid-run.
    assert.match(lessons[0].problem, /פג תוקף החיבור/,
      'generation must be refused for want of credentials, never attempted');
  } finally {
    await stop();
  }
});

test('a port somebody else answers on is not mistaken for our server', async () => {
  // The flake this pins (2026-09-25, reproduced by running three suites at
  // once): two test files' servers raced for one port. The loser died with
  // EADDRINUSE, but the readiness probe had already been answered — by the
  // WINNER — so the losing test ran against another test's server and
  // database. Symptoms: 'fetch failed' when that other test stopped its
  // server, rows missing, 'database is locked'. Staged here by answering
  // /api/me on the first port the harness is told to use.
  const { createServer } = await import('node:http');
  const impostor = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ impostor: true }));
  });
  await new Promise(r => impostor.listen(0, '0.0.0.0', r));
  const taken = impostor.address().port;
  try {
    const { baseUrl, stop } = await startServer({ ports: [taken] });
    try {
      assert.notEqual(new URL(baseUrl).port, String(taken));
      assert.deepEqual(await (await fetch(`${baseUrl}/api/me`)).json(), { authenticated: false });
    } finally { await stop(); }
  } finally {
    await new Promise(r => impostor.close(r));
  }
});
