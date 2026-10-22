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
  handle().exec(`DELETE FROM lessons; DELETE FROM engine_status; DELETE FROM bookings_v2;
    DELETE FROM library_uses; DELETE FROM lesson_engines;`);
}

/* One family, two enrollments: maths (generated) and English (never is). */
const db = handle();
db.exec(`INSERT INTO accounts (name, credential, created_at) VALUES ('Parent', 'x', '2026-09-01')`);
const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
db.prepare(`INSERT INTO students_v2 (code, name, account_id, credential, created_at) VALUES ('gh1', 'Test Student', ?, 'x', '2026-09-01')`).run(accountId);
const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'gh1'`).get().id;
db.prepare(`INSERT INTO enrollments (student_id, subject) VALUES (?, 'מתמטיקה')`).run(studentId);
db.prepare(`INSERT INTO enrollments (student_id, subject) VALUES (?, 'אנגלית')`).run(studentId);
const maths = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'מתמטיקה'`).get(studentId).id;
const english = db.prepare(`SELECT id FROM enrollments WHERE student_id = ? AND subject = 'אנגלית'`).get(studentId).id;

/** A booking `h` hours from NOW (negative: past), in the given format. */
function book(h, { enrollment = maths, status = 'confirmed', start = hoursAgo(-h) } = {}) {
  const end = new Date(new Date(start).getTime() + 90 * 60_000).toISOString();
  return Number(db.prepare(`INSERT INTO bookings_v2 (student_id, enrollment_id, start, "end", duration, at, status)
    VALUES (?, ?, ?, ?, 90, ?, ?)`).run(studentId, enrollment, start, end, hoursAgo(100), status).lastInsertRowid);
}
/** A lesson row for the lesson at `lessonAt`, written `h` hours ago. */
function lessonFor(slug, lessonAt, status, h = 50, problem = null) {
  createLesson({ slug, student: 'Test Student', lessonAt });
  if (status !== 'generating') finishLesson(slug, { status, problem });
  db.prepare(`UPDATE lessons SET at = ? WHERE slug = ?`).run(hoursAgo(h), slug);
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

test('a booked maths lesson in the next or last N days with no ready lesson is stale', () => {
  reset();
  const none = book(30);                                   // tomorrow+, never generated
  const failedEarly = book(48);
  lessonFor('f-early', hoursAgo(-48), 'failed', 100, 'codex exited 1');  // failed 4 days ago: outside 24h
  const covered = book(10);
  lessonFor('ok', hoursAgo(-10), 'ready', 100);
  const past = book(-40);                                  // the day before yesterday, never generated
  book(24 * 5);                                            // beyond 3 days ahead
  book(20, { enrollment: english });                       // not maths: never generated, by design
  book(20, { status: 'cancelled' });
  const inFlight = book(60);
  lessonFor('gen', hoursAgo(-60), 'generating', 0.1);
  lessonFor('codex-recent', null, 'ready', 5);             // Codex is alive

  const h = G.generationHealth(NOW);
  assert.equal(h.ok, false);
  assert.equal(h.failed.length, 0, 'the early failure is outside the 24h window…');
  assert.deepEqual(h.stale.bookedWithoutLesson.map(b => b.bookingId).sort(), [none, failedEarly, past].sort(),
    '…but its lesson is still not ready, and that is reported');
  assert.equal(h.stale.bookedWithoutLesson.find(b => b.bookingId === failedEarly).lesson, 'failed');
  assert.equal(h.stale.bookedWithoutLesson.find(b => b.bookingId === none).lesson, null);
  assert.ok(!h.stale.bookedWithoutLesson.some(b => b.bookingId === covered || b.bookingId === inFlight));
  assert.equal(h.stale.codexIdle, false);
  const msg = G.formatAlert(h);
  assert.match(msg, new RegExp(`הזמנה #${none}`));
  assert.match(msg, /לא נוצר כלל/);
  assert.ok(!msg.includes('Test Student'), 'the stale section names bookings, not children');

  assert.equal(G.generationHealth(NOW, { staleDays: 1 }).stale.bookedWithoutLesson.length, 0,
    'the window is configurable');
});

test('booking and lesson times match as instants, whatever their format', () => {
  reset();
  const id = book(0, { start: '2026-10-23T10:00:00+03:00' });
  lessonFor('tz', '2026-10-23T07:00:00.000Z', 'ready');
  assert.equal(G.generationHealth(NOW).stale.bookedWithoutLesson.length, 0, `booking ${id} is covered`);
});

test('codex idle: a stale booking AND no Codex success in N days; library copies and imports do not count', () => {
  reset();
  book(20);
  lessonFor('lib-copy', null, 'ready', 2);
  db.prepare(`INSERT INTO library_uses (lesson_slug, master_slug, template_id, skill_key, at) VALUES ('lib-copy', 'm', 't', 'k', ?)`).run(hoursAgo(2));
  lessonFor('imported', null, 'ready', 2);
  db.prepare(`INSERT INTO lesson_engines (lesson_slug, engine, at) VALUES ('imported', 'claude', ?)`).run(hoursAgo(2));
  lessonFor('old-codex', null, 'ready', 24 * 9);

  let h = G.generationHealth(NOW);
  assert.equal(h.stale.codexIdle, true);
  assert.equal(h.stale.lastCodexSuccess, hoursAgo(24 * 9));
  assert.match(G.formatAlert(h), /Codex לא יצר/);

  reset();
  lessonFor('old-codex', null, 'ready', 24 * 9);
  h = G.generationHealth(NOW);
  assert.equal(h.stale.codexIdle, false, 'no bookings waiting: an idle engine is not news');
  assert.equal(h.ok, true);
});

test('GENERATION_HEALTH_STALE_DAYS sets the window, and nonsense falls back to 3', () => {
  assert.equal(G.staleDaysFrom({ GENERATION_HEALTH_STALE_DAYS: '7' }), 7);
  for (const v of [undefined, '', '0', '-2', 'abc', '2.5', '999']) {
    assert.equal(G.staleDaysFrom({ GENERATION_HEALTH_STALE_DAYS: v }), 3, String(v));
  }
});

const HOOK = 'https://hooks.slack.com/services/T000/B000/secretsecret';

test('alert channels: Slack and/or Lior\'s WhatsApp; the tutor only when neither; never a guess', () => {
  assert.deepEqual(G.alertChannels({ OPS_SLACK_WEBHOOK_URL: HOOK, CALLMEBOT_API_KEY: 'k' }),
    { ok: true, channels: [{ kind: 'slack', webhookUrl: HOOK }] }, 'Slack set: the tutor is not messaged');
  assert.deepEqual(G.alertChannels({ OPS_SLACK_WEBHOOK_URL: HOOK, OPS_CALLMEBOT_PHONE: '972500000000', OPS_CALLMEBOT_API_KEY: 'k' }).channels.map(c => c.kind),
    ['slack', 'whatsapp-ops']);
  assert.deepEqual(G.alertChannels({ OPS_CALLMEBOT_PHONE: '972500000000', OPS_CALLMEBOT_API_KEY: 'k' }).channels,
    [{ kind: 'whatsapp-ops', to: { phone: '972500000000', apiKey: 'k' } }]);
  assert.equal(G.alertChannels({ CALLMEBOT_API_KEY: 'k' }).channels[0].kind, 'whatsapp-tutor');
  assert.equal(G.alertChannels({}).ok, false);
  assert.equal(G.alertChannels({ OPS_SLACK_WEBHOOK_URL: HOOK, OPS_CALLMEBOT_PHONE: '972500000000' }).ok, false,
    'half a WhatsApp pair is surfaced even with Slack set');
  for (const bad of ['http://hooks.slack.com/services/T/B/x', 'https://example.com/hook', 'hooks.slack.com/services/x']) {
    const r = G.alertChannels({ OPS_SLACK_WEBHOOK_URL: bad });
    assert.equal(r.ok, false, bad);
    assert.ok(!r.reason.includes(bad), 'the reason does not echo the value');
  }
  const label = G.channelLabel({ kind: 'slack', webhookUrl: HOOK });
  assert.ok(!label.includes('hooks.slack.com'), 'labels never carry the URL');
});

test('sendSlack posts JSON to the webhook, escapes Slack markup, and never returns the URL', async () => {
  const calls = [];
  const ok = await G.sendSlack('a <b> & c', HOOK, async (url, init) => { calls.push({ url, init }); return new Response('ok'); });
  assert.deepEqual(ok, { ok: true });
  assert.equal(calls[0].url, HOOK);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).text, 'a &lt;b&gt; &amp; c');

  const rejected = await G.sendSlack('x', HOOK, async () => new Response('invalid_token', { status: 403 }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /403 invalid_token/);

  const thrown = await G.sendSlack('x', HOOK, async () => { throw new Error(`connect ECONNREFUSED ${HOOK}`); });
  assert.equal(thrown.ok, false);
  assert.ok(!thrown.error.includes('secretsecret'), 'the URL is scrubbed from errors');
  assert.match(thrown.error, /<webhook>/);

  const weird = await G.sendSlack('x', HOOK, async () => new Response('no_service'));
  assert.equal(weird.ok, false, 'a 200 that is not "ok" is not a delivery');
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

test('the morning run: 503 with no channel, 200 silent when healthy, one message per channel, 502 on any failed send', async () => {
  const quiet = { error() {}, warn() {} };
  reset();
  const healthy = G.generationHealth(NOW);
  run('bad', 'failed', 2, 'codex exited 1');
  const failing = G.generationHealth(NOW);
  const slack = { kind: 'slack', webhookUrl: HOOK };
  const wa = { kind: 'whatsapp-ops', to: { phone: '972500000000', apiKey: 'k' } };
  const sends = [];
  const okSend = async (text, c) => { sends.push(c.kind); return { ok: true }; };

  let r = await G.runHealthCheck({ health: healthy, channels: G.alertChannels({}), send: okSend, log: quiet });
  assert.equal(r.status, 503, 'healthy but mute is still a failure');

  r = await G.runHealthCheck({ health: healthy, channels: { ok: true, channels: [slack] }, send: okSend, log: quiet });
  assert.equal(r.status, 200);
  assert.deepEqual(sends, [], 'a healthy day sends nothing');

  r = await G.runHealthCheck({ health: failing, channels: { ok: true, channels: [slack, wa] }, send: okSend, log: quiet });
  assert.equal(r.status, 200);
  assert.deepEqual(sends, ['slack', 'whatsapp-ops'], 'one summary per configured channel');
  assert.deepEqual(r.body.sent, ['slack (OPS_SLACK_WEBHOOK_URL)', 'whatsapp (OPS_CALLMEBOT_PHONE)']);

  const logged = [];
  r = await G.runHealthCheck({
    health: failing, channels: { ok: true, channels: [slack, wa] },
    send: async (t, c) => (c.kind === 'slack' ? { ok: false, error: 'Slack answered 404 no_service' } : { ok: true }),
    log: { error: (m) => logged.push(m), warn() {} },
  });
  assert.equal(r.status, 502, 'WhatsApp got it, but a dead Slack hook must not go unnoticed');
  assert.deepEqual(r.body.sent, ['whatsapp (OPS_CALLMEBOT_PHONE)']);
  assert.equal(r.body.sendFailures[0].channel, 'slack (OPS_SLACK_WEBHOOK_URL)');
  assert.ok(!JSON.stringify(r.body).includes('secretsecret') && !logged.join('\n').includes('secretsecret'),
    'neither the response nor the log carries the webhook URL');
});
