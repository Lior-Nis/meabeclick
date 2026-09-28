/**
 * Games, from the pre-launch review, 2026-09-28 (Todoist 6hfCvVhH7QRwv5MH):
 * results lost silently, no way back, a revealed table scored as perfect,
 * and RTL bugs in numbers and maths lines.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const E = await import('../../src/lib/games/engine.ts');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}
const payload = { dataId: 'd1', student: 's', t: 'sig', template: 'quiz', score: 3, total: 4 };

test('a saved result says so, and survives leaving the page (keepalive)', async () => {
  let init;
  const r = await E.reportResult(payload, { fetch: async (_u, i) => { init = i; return new Response('{}', { status: 200 }); }, storage: memoryStorage() });
  assert.equal(r, 'saved');
  assert.equal(init.keepalive, true);
});

test('offline or a server error: the result is kept on the device and sent later', async () => {
  const storage = memoryStorage();
  assert.equal(await E.reportResult(payload, { fetch: async () => { throw new TypeError('offline'); }, storage }), 'queued');
  assert.equal(await E.reportResult({ ...payload, dataId: 'd2' }, { fetch: async () => new Response('', { status: 503 }), storage }), 'queued');
  const sent = [];
  const n = await E.flushQueuedResults({ fetch: async (_u, i) => { sent.push(JSON.parse(i.body).dataId); return new Response('{}', { status: 200 }); }, storage });
  assert.equal(n, 2);
  assert.deepEqual(sent.sort(), ['d1', 'd2']);
  assert.equal(await E.flushQueuedResults({ fetch: async () => { throw new Error('should not be called'); }, storage }), 0, 'sent once');
});

test('a result the server refuses (e.g. an unsigned demo link) is not retried forever', async () => {
  const storage = memoryStorage();
  assert.equal(await E.reportResult(payload, { fetch: async () => new Response('', { status: 400 }), storage }), 'rejected');
  assert.equal(await E.flushQueuedResults({ fetch: async () => { throw new Error('no'); }, storage }), 0);
});

test('the finish screen tells the truth, waits for the save, and has a way back', () => {
  const shell = read('src/lib/games/GameShell.svelte');
  assert.match(shell, /✓ נשמר/);
  assert.match(shell, /התוצאה תישמר כשהחיבור יחזור/);
  assert.match(shell, /disabled=\{saving\}/);
  assert.match(shell, /href="\/app\/student"[^>]*>→ חזרה לדף שלי/);
  assert.match(shell, /flushQueuedResults\(\)/);
});

test('a table whose answers were revealed does not score as perfect', () => {
  const t = read('src/lib/games/Table.svelte');
  assert.match(t, /b\.revealed = true/);
  assert.match(t, /blanks\.filter\(\(b\) => b\.state === 'right' && !b\.revealed\)\.length/);
});

test('numbers keep their sign in a right-to-left page, and maths lines take their own direction', () => {
  const nl = read('src/lib/games/NumberLine.svelte');
  assert.match(nl, /direction="ltr"/);
  assert.match(nl, /isolate\(/);
  for (const f of ['ErrorHunt', 'SpeedDrill']) {
    const s = read(`src/lib/games/${f}.svelte`);
    assert.doesNotMatch(s, /direction: ltr/, f);
    assert.match(s, /unicode-bidi: plaintext/, f);
  }
  assert.doesNotMatch(read('src/lib/games/Matching.svelte'), /מימין, ואז/);
});
