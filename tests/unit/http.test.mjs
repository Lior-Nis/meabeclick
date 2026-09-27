import { test } from 'node:test';
import assert from 'node:assert/strict';

const { readJson } = await import('../../src/lib/server/http.ts');

function req(body, contentType = 'application/json') {
  const headers = contentType ? { 'content-type': contentType } : {};
  return new Request('http://x/api/test', { method: 'POST', headers, body });
}

test('parses a well-formed JSON body', async () => {
  const result = await readJson(req(JSON.stringify({ a: 1 })));
  assert.deepEqual(result, { a: 1 });
});

test('an empty body parses as {} rather than erroring, matching body-parser', async () => {
  const result = await readJson(req(''));
  assert.deepEqual(result, {});
});

test('a malformed JSON body returns a 400 Response, not a thrown error', async () => {
  const result = await readJson(req('{not valid'));
  assert.ok(result instanceof Response, 'expected a Response');
  assert.equal(result.status, 400);
  const parsed = await result.json();
  assert.equal(typeof parsed.error, 'string');
});

test('a non-JSON Content-Type is never parsed, matching express.json() skipping it', async () => {
  const result = await readJson(req('{not valid json at all', 'text/plain'));
  assert.deepEqual(result, {}, 'a mismatched content-type must not attempt to parse, and must not 400');
});

test('a missing Content-Type is never parsed', async () => {
  const result = await readJson(req('{not valid json at all', null));
  assert.deepEqual(result, {});
});
