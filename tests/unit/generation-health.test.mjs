// The daily generation health check (Todoist 6hmX5pXvghfFvv6H). Failures
// were silent: a failed run left a `lessons` row nobody read, and a process
// restart mid-run left `generating` forever. These pin what the morning
// check reports, what it sends, and that it cannot be mute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'gen-health-')), 'results.db');
const { handle, createLesson, finishLesson } = await import('../../src/lib/server/db.ts');
const G = await import('../../src/lib/server/lesson/generation-health.ts');
const { sendWhatsAppChecked } = await import('../../src/lib/server/lesson/queue.ts');

const NOW = new Date('2026-10-22T05:00:00Z');   // 08:00 Israel
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function run(slug, status, h, problem = null) {
  createLesson({ slug, student: 'Test Student' });
  if (status !== 'generating') finishLesson(slug, { status, problem });
  handle().prepare(`UPDATE lessons SET at = ? WHERE slug = ?`).run(hoursAgo(h), slug);
}

function reset() {
  handle().exec(`DELETE FROM lessons; DELETE FROM engine_status;`);
}

test('a day of clean runs is ok and sends nothing', () => {
  reset();
  run('a-clean', 'ready', 2);
  run('b-clean', 'ready', 20);
  run('c-generating-now', 'generating', 0.2);   // in flight, not stuck
  const h = G.generationHealth(NOW);
  assert.equal(h.ok, true);
  assert.equal(h.runs.total, 3);
  assert.equal(h.runs.ready, 2);
  assert.equal(h.runs.generating, 1);
  assert.equal(G.formatAlert(h), null);
});

test('failed, held and undelivered runs in the last 24h are each reported', () => {
  reset();
  run('f1', 'failed', 3, 'codex exited 1');
  run('h1', 'held', 5, 'slide 3 has no answer');
  run('u1', 'ready', 6, 'could not write to the portal');
  run('ok1', 'ready', 7);
  const h = G.generationHealth(NOW);
  assert.equal(h.ok, false);
  assert.deepEqual(h.failed.map(r => r.slug), ['f1']);
  assert.equal(h.failed[0].problem, 'codex exited 1');
  assert.deepEqual(h.held.map(r => r.slug), ['h1']);
  assert.deepEqual(h.undelivered.map(r => r.slug), ['u1']);
  const msg = G.formatAlert(h);
  for (const s of ['f1', 'h1', 'u1', 'codex exited 1']) assert.ok(msg.includes(s), `message names ${s}`);
  assert.ok(!msg.includes('ok1'), 'a clean run is not in the alert');
  assert.equal(msg.split('⚠️').length - 1, 1, 'one summary message, not one per failure');
});

test('a failure older than the window is not reported again', () => {
  reset();
  run('old-fail', 'failed', 30, 'yesterday');
  const h = G.generationHealth(NOW);
  assert.equal(h.ok, true);
  assert.equal(h.failed.length, 0);
});

test('a run stuck at generating is reported at any age, a fresh one is not', () => {
  reset();
  run('fresh', 'generating', 0.5);
  run('stuck-today', 'generating', 2);
  run('stuck-last-week', 'generating', 24 * 7);
  const h = G.generationHealth(NOW);
  assert.deepEqual(h.stuck.map(r => r.slug).sort(), ['stuck-last-week', 'stuck-today']);
  assert.equal(h.ok, false);
  assert.match(G.formatAlert(h), /stuck-today/);
  assert.equal(G.generationHealth(NOW, { stuckMinutes: 60 * 24 * 30 }).stuck.length, 0, 'the threshold is honoured');
});

test('an open engine outage is reported even with no runs at all', () => {
  reset();
  handle().prepare(`INSERT INTO engine_status (engine, kind, until, at) VALUES (?, ?, ?, ?)`)
    .run('codex', 'engine-quota', '2026-10-24T16:26:00.000Z', hoursAgo(40));
  const h = G.generationHealth(NOW);
  assert.equal(h.runs.total, 0);
  assert.equal(h.ok, false);
  assert.equal(h.enginesDown[0].kind, 'engine-quota');
  assert.match(G.formatAlert(h), /codex.*engine-quota/);
});

test('a long list is cut short in the message, but counted in full', () => {
  reset();
  for (let i = 0; i < 8; i++) run(`f${i}`, 'failed', 1 + i, 'x');
  const msg = G.formatAlert(G.generationHealth(NOW));
  assert.match(msg, /נכשלו: 8/);
  assert.match(msg, /ועוד 3/);
});

test('the alert channel: Lior\'s OPS pair, else the tutor channel, else none — never a guess', () => {
  assert.deepEqual(G.alertChannel({ OPS_CALLMEBOT_PHONE: '972500000000', OPS_CALLMEBOT_API_KEY: 'k' }),
    { kind: 'ops', to: { phone: '972500000000', apiKey: 'k' } });
  assert.equal(G.alertChannel({ CALLMEBOT_API_KEY: 'k' }).kind, 'tutor');
  assert.equal(G.alertChannel({}).kind, 'missing');
  assert.equal(G.alertChannel({ OPS_CALLMEBOT_PHONE: '972500000000', CALLMEBOT_API_KEY: 'k' }).kind, 'missing',
    'half an OPS pair is a mistake to surface, not a reason to message the tutor');
  assert.equal(G.alertChannel({ OPS_CALLMEBOT_API_KEY: ' ', CALLMEBOT_API_KEY: '' }).kind, 'missing');
});

test('sendWhatsAppChecked says when it could not send, and sends to the channel it is given', async () => {
  const had = process.env.CALLMEBOT_API_KEY;
  delete process.env.CALLMEBOT_API_KEY;
  const realFetch = globalThis.fetch;
  try {
    const none = await sendWhatsAppChecked('hi');
    assert.equal(none.ok, false);
    assert.match(none.error, /CALLMEBOT_API_KEY/);

    const urls = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return new Response('Message queued'); };
    assert.deepEqual(await sendWhatsAppChecked('hi', { phone: '972500000000', apiKey: 'opskey' }), { ok: true });
    assert.match(urls[0], /phone=972500000000/);
    assert.match(urls[0], /apikey=opskey/);

    globalThis.fetch = async () => new Response('ERROR: APIKey is invalid');
    assert.equal((await sendWhatsAppChecked('hi', { phone: '972500000000', apiKey: 'bad' })).ok, false);

    globalThis.fetch = async () => { throw new Error('offline'); };
    const off = await sendWhatsAppChecked('hi', { phone: '972500000000', apiKey: 'k' });
    assert.equal(off.ok, false);
    assert.match(off.error, /offline/);
  } finally {
    globalThis.fetch = realFetch;
    if (had !== undefined) process.env.CALLMEBOT_API_KEY = had;
  }
});
