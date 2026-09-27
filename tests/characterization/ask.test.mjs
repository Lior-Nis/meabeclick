// tests/characterization/ask.test.mjs
//
// The student question box, end to end through the real server.
//
// The harness points CODEX_BIN at a path that does not exist, so no agent
// ever runs here — which is the point: these assert on authorization, rate
// limiting and failure handling, all of which must hold *before* and
// *around* the agent call. The agent call itself is covered by the unit
// tests on prompt construction, and by a real run against production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-09-14T10:00:00+03:00', end: '2027-09-14T11:30:00+03:00',
    ...over,
  }),
}).then(r => r.json());

const ask = (baseUrl, body, cookie) => fetch(`${baseUrl}/api/ask`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

test('asking requires a session that already reaches that student', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await book(baseUrl);
    const theirs = await book(baseUrl, {
      name: 'ילד אחר', email: 'other@example.com', phone: '0507776666',
      start: '2027-09-15T10:00:00+03:00', end: '2027-09-15T11:30:00+03:00',
    });

    const anon = await ask(baseUrl, { slug: mine.portal.code, question: 'שאלה' });
    assert.equal(anon.status, 401, 'no session must not reach the agent');

    // The code appears in URLs and is guessable, so holding it is not
    // authorization — the session has to cover that student.
    const cookie = await familySession(mine.portal.link);
    const cross = await ask(baseUrl, { slug: theirs.portal.code, question: 'שאלה' }, cookie);
    assert.equal(cross.status, 401, "one family must not ask about another family's child");
  } finally { await stop(); }
});

test('a malformed question is refused before any agent is spawned', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await book(baseUrl);
    const cookie = await familySession(mine.portal.link);

    assert.equal((await ask(baseUrl, { slug: mine.portal.code }, cookie)).status, 400, 'no question');
    assert.equal((await ask(baseUrl, { question: 'שאלה' }, cookie)).status, 400, 'no slug');
    assert.equal(
      (await ask(baseUrl, { slug: mine.portal.code, question: 'א'.repeat(501) }, cookie)).status,
      400, 'over the length cap',
    );
  } finally { await stop(); }
});

test('an engine failure answers a status the client can fall back on', async () => {
  // CODEX_BIN points at nothing in the harness, so this exercises the real
  // failure path. The client renders "ask your tutor on WhatsApp" on any
  // non-200, and must never be shown the engine's own words.
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await book(baseUrl);
    const cookie = await familySession(mine.portal.link);

    const r = await ask(baseUrl, { slug: mine.portal.code, question: 'איך מחברים שברים?' }, cookie);
    assert.ok(r.status >= 500, `expected a server-side failure, got ${r.status}`);

    const body = await r.text();
    assert.doesNotMatch(body, /codex|ENOENT|\/tmp\//i, 'engine detail must stay in the log');
  } finally { await stop(); }
});

test('a student cannot spawn unlimited agents', async () => {
  // Each question is a subprocess, which the previous HTTP-based
  // implementation was not. A bored child holding down Enter must not be
  // able to fork the box.
  const { baseUrl, stop } = await startServer();
  try {
    const mine = await book(baseUrl);
    const cookie = await familySession(mine.portal.link);

    let sawLimit = false;
    for (let i = 0; i < 35; i++) {
      const r = await ask(baseUrl, { slug: mine.portal.code, question: `שאלה ${i}` }, cookie);
      if (r.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'expected a rate limit within 35 questions');
  } finally { await stop(); }
});
