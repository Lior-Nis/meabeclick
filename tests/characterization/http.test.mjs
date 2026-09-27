// tests/characterization/http.test.mjs
//
// Ruling P17: `await request.json()` throws on a missing or malformed
// body, and a route with no handler for that lets SvelteKit turn it into a
// generic 500 — a parity break against Express's express.json() middleware,
// which answers 400 for the identical input, on every POST route. Both
// targets are expected to answer 400, not 500, for a malformed JSON body on
// any POST route — Express already does (its own body-parser middleware),
// and SvelteKit's ported routes go through the shared src/lib/server/
// http.ts's readJson() to get the same status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

const MALFORMED = '{not valid json';

// /api/verify-account was removed with the password model; /api/request-link
// and /api/join are the routes that replaced it as the family's way in.
const POST_ROUTES = ['/api/login', '/api/game-result', '/api/request-link', '/api/join', '/api/book'];

for (const route of POST_ROUTES) {
  test(`POST ${route} with malformed JSON answers 400, not 500`, async () => {
    const { baseUrl, stop } = await startServer();
    try {
      const r = await fetch(`${baseUrl}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: MALFORMED,
      });
      assert.equal(r.status, 400, `${route}: expected 400, got ${r.status}`);
    } finally {
      await stop();
    }
  });
}

test('POST /api/login with an empty body reaches the wrong-password branch, not a 400', async () => {
  // body-parser treats a zero-length body as `{}`, not a parse error — the
  // empty-body case must take the same "wrong password" branch as an
  // explicit `{}`, not a new 400 that didn't exist under Express.
  const { baseUrl, stop } = await startServer();
  try {
    const r = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    assert.equal(r.status, 401);
  } finally {
    await stop();
  }
});
