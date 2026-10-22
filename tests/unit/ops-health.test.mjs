// The daily ops health check (Todoist 6hmX5rXVh6J636HH): uptime, backup
// success, mail credentials and calendar write failures, ONE message to Lior
// on any failure and silent otherwise. Every check is fed fakes here — no
// test reaches the site, Google, Drive or Slack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'ops-health-')), 'results.db');
const { handle, flagCalendarFailure, resolveCalendarFailure } = await import('../../src/lib/server/db.ts');
const O = await import('../../src/lib/server/ops-health.ts');

const NOW = new Date('2026-10-22T05:00:00Z');   // 08:00 Israel
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const db = handle();

/** A fetch that answers by URL pattern, and records what it was asked. */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [re, answer] of routes) {
      if (re.test(String(url))) return typeof answer === 'function' ? answer(String(url), init) : answer.clone();
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  f.calls = calls;
  return f;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

/* ── uptime ───────────────────────────────────────────────────────── */

test('uptime: the public site answering 200 with a cert far from expiry is ok', async () => {
  const f = fakeFetch([[/^https:\/\/meabeclick\.com\/$/, new Response('<html>')]]);
  const r = await O.checkUptime({
    siteUrl: 'https://meabeclick.com', now: NOW, fetchImpl: f,
    certExpiry: async () => new Date('2026-12-30T00:00:00Z'),
  });
  assert.equal(r.ok, true, r.problems.join());
  assert.equal(r.name, 'uptime');
  assert.equal(f.calls.length, 1);
});

test('uptime: a 502 from Caddy, a dead connection, or a cert about to expire each fail', async () => {
  const cert = async () => new Date('2026-12-30T00:00:00Z');
  let r = await O.checkUptime({ siteUrl: 'https://meabeclick.com', now: NOW, certExpiry: cert,
    fetchImpl: fakeFetch([[/./, new Response('Bad Gateway', { status: 502 })]]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /502/);

  r = await O.checkUptime({ siteUrl: 'https://meabeclick.com', now: NOW, certExpiry: cert,
    fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); } });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /ECONNREFUSED/);

  r = await O.checkUptime({ siteUrl: 'https://meabeclick.com', now: NOW,
    fetchImpl: fakeFetch([[/./, new Response('ok')]]),
    certExpiry: async () => new Date('2026-10-29T00:00:00Z') });
  assert.equal(r.ok, false, 'a cert 7 days from expiry means Caddy stopped renewing it');
  assert.match(r.problems[0], /TLS/);
});

test('uptime: no SITE_URL is a failure, not a skip; plain http skips the cert probe', async () => {
  let r = await O.checkUptime({ siteUrl: '', now: NOW, fetchImpl: fakeFetch([]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /SITE_URL/);
  let probed = false;
  r = await O.checkUptime({ siteUrl: 'http://127.0.0.1:3000', now: NOW,
    fetchImpl: fakeFetch([[/./, new Response('ok')]]), certExpiry: async () => { probed = true; return null; } });
  assert.equal(r.ok, true);
  assert.equal(probed, false);
});

/* ── backups ──────────────────────────────────────────────────────── */

const DRIVE_ENV = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'csecret', GOOGLE_OAUTH_REFRESH_TOKEN: 'rtoken', DRIVE_BACKUP_FOLDER_ID: 'fold1' };
const token = [/oauth2\.googleapis\.com\/token/, json({ access_token: 'at' })];
const listing = (files) => [/drive\/v3\/files\?q=/, json({ files })];
const day = (stamp, h, size = '2048') => [
  { id: `d-${stamp}`, name: `results-${stamp}.db`, createdTime: hoursAgo(h), size },
  { id: `f-${stamp}`, name: `files-${stamp}.tar.gz`, createdTime: hoursAgo(h), size: '4096' },
];

test('backups: last night\'s database and files both on Drive is ok, and nothing is written', async () => {
  const f = fakeFetch([token, listing([...day('2026-10-21', 29), ...day('2026-10-22', 5)])]);
  const r = await O.checkBackups({ env: DRIVE_ENV, now: NOW, fetchImpl: f });
  assert.equal(r.ok, true, r.problems.join());
  assert.equal(r.info.lastBackup, 'results-2026-10-22.db');
  assert.ok(f.calls.every(c => (c.init.method ?? 'GET') === 'GET' || /token/.test(c.url)), 'read-only: no upload, no delete, no folder create');
});

test('backups: a missed night, a missing tarball, or an empty database each fail', async () => {
  let r = await O.checkBackups({ env: DRIVE_ENV, now: NOW, fetchImpl: fakeFetch([token, listing(day('2026-10-21', 29))]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /29/);

  r = await O.checkBackups({ env: DRIVE_ENV, now: NOW, fetchImpl: fakeFetch([token, listing([day('2026-10-22', 5)[0]])]) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /files-2026-10-22\.tar\.gz/);

  r = await O.checkBackups({ env: DRIVE_ENV, now: NOW, fetchImpl: fakeFetch([token, listing(day('2026-10-22', 5, '0'))]) });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(), /ריק|empty/);

  r = await O.checkBackups({ env: DRIVE_ENV, now: NOW, fetchImpl: fakeFetch([token, listing([])]) });
  assert.equal(r.ok, false);
});

test('backups: no Drive login, a revoked token, or no folder fail loudly and never echo the secrets', async () => {
  let r = await O.checkBackups({ env: {}, now: NOW, fetchImpl: fakeFetch([]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /GOOGLE_OAUTH/);

  r = await O.checkBackups({ env: DRIVE_ENV, now: NOW,
    fetchImpl: fakeFetch([[/token/, json({ error: 'invalid_grant', client_id: 'cid' }, 400)]]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /400/);
  assert.ok(!JSON.stringify(r).includes('csecret') && !JSON.stringify(r).includes('rtoken'));

  const noId = { ...DRIVE_ENV, DRIVE_BACKUP_FOLDER_ID: '' };
  const f = fakeFetch([token, [/drive\/v3\/files\?q=/, json({ files: [] })]]);
  r = await O.checkBackups({ env: noId, now: NOW, fetchImpl: f });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /folder/i);
  assert.ok(f.calls.every(c => c.init.method !== 'POST' || /token/.test(c.url)), 'a missing folder is reported, never created');
});

test('backups: without DRIVE_BACKUP_FOLDER_ID the folder is found by name', async () => {
  const noId = { ...DRIVE_ENV, DRIVE_BACKUP_FOLDER_ID: '' };
  const f = fakeFetch([token,
    [/mimeType/, json({ files: [{ id: 'fold9', name: 'mea-beclick-backups' }] })],
    [/fold9/, json({ files: day('2026-10-22', 5) })]]);
  const r = await O.checkBackups({ env: noId, now: NOW, fetchImpl: f });
  assert.equal(r.ok, true, r.problems.join());
});

/* ── mail ─────────────────────────────────────────────────────────── */

test('mail: accepted credentials are ok; refused or missing ones fail', async () => {
  let r = await O.checkMail({ configured: () => true, verify: async () => ({ configured: true, ok: true }) });
  assert.equal(r.ok, true);
  r = await O.checkMail({ configured: () => true,
    verify: async () => ({ configured: true, ok: false, reason: 'Invalid login: 535-5.7.8 Username and Password not accepted' }) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /535/);
  r = await O.checkMail({ configured: () => false, verify: async () => assert.fail('nothing to verify') });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /GMAIL_USER/);
});

/* ── calendar ─────────────────────────────────────────────────────── */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const SA = { email: 'robot@example.iam.gserviceaccount.com', privateKey };

function resetCalendar() {
  db.exec(`DELETE FROM calendar_failures`);
  db.exec(`UPDATE teachers SET calendar_id = NULL`);
}
function tutorWithCalendar(calendarId = 'lessons@group.calendar.google.com') {
  const t = db.prepare(`SELECT id FROM teachers WHERE active = 1 ORDER BY id LIMIT 1`).get();
  if (t) { db.prepare(`UPDATE teachers SET calendar_id = ? WHERE id = ?`).run(calendarId, t.id); return t.id; }
  return Number(db.prepare(`INSERT INTO teachers (name, active, calendar_id) VALUES ('Tutor', 1, ?)`).run(calendarId).lastInsertRowid);
}
const googleOk = () => fakeFetch([[/oauth2\.googleapis\.com\/token/, json({ access_token: 'sa-token' })],
  [/calendar\/v3\/calendars\/.+\/events\?maxResults=1/, json({ items: [] })]]);

test('calendar: no open failures and a robot that can sign in and see each tutor\'s calendar is ok, read-only', async () => {
  resetCalendar();
  tutorWithCalendar();
  const f = googleOk();
  const r = await O.checkCalendar({ db, now: NOW, sa: SA, fetchImpl: f });
  assert.equal(r.ok, true, r.problems.join());
  assert.ok(f.calls.some(c => /events\?maxResults=1/.test(c.url)));
  assert.ok(f.calls.every(c => c.init.method !== 'POST' || /token/.test(c.url)), 'never writes an event');
});

test('calendar: every unresolved write failure is reported until it is resolved, by id and time, never by name', async () => {
  resetCalendar();
  tutorWithCalendar();
  flagCalendarFailure({ name: 'Secret Family Name', start: '2026-10-23T15:00:00.000Z' }, 'Calendar error 403: forbidden');
  db.prepare(`UPDATE calendar_failures SET at = ?`).run(hoursAgo(50));
  flagCalendarFailure({ name: 'Other Family', start: '2026-10-24T15:00:00.000Z' }, 'Token error 400: invalid_grant');
  let r = await O.checkCalendar({ db, now: NOW, sa: SA, fetchImpl: googleOk() });
  assert.equal(r.ok, false);
  assert.equal(r.info.unresolved, 2);
  assert.equal(r.info.newToday, 1);
  const msg = O.formatOpsAlert({ ok: false, at: NOW.toISOString(), checks: [r] });
  assert.match(msg, /403/);
  assert.ok(!msg.includes('Secret Family Name') && !JSON.stringify(r).includes('Secret Family Name'),
    'the alert names a booking by id and time; the family name stays on the dashboard');

  for (const { id } of db.prepare(`SELECT id FROM calendar_failures`).all()) resolveCalendarFailure(id);
  r = await O.checkCalendar({ db, now: NOW, sa: SA, fetchImpl: googleOk() });
  assert.equal(r.ok, true, 'resolved on the dashboard: silent again');
});

test('calendar: a missing robot key, a refused sign-in, or a calendar it cannot reach each fail', async () => {
  resetCalendar();
  tutorWithCalendar();
  let r = await O.checkCalendar({ db, now: NOW, sa: null, fetchImpl: fakeFetch([]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /GOOGLE_SERVICE_ACCOUNT/);

  r = await O.checkCalendar({ db, now: NOW, sa: SA,
    fetchImpl: fakeFetch([[/token/, new Response('invalid_grant: account deleted', { status: 400 })]]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /400/);

  r = await O.checkCalendar({ db, now: NOW, sa: SA,
    fetchImpl: fakeFetch([[/token/, json({ access_token: 't' })], [/events/, json({ error: { code: 404 } }, 404)]]) });
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /404/);
});

test('calendar: with no tutor calendar set, the robot is not probed', async () => {
  resetCalendar();
  const r = await O.checkCalendar({ db, now: NOW, sa: null, fetchImpl: fakeFetch([]) });
  assert.equal(r.ok, true, r.problems.join());
});

/* ── the whole report and the one message ─────────────────────────── */

const pass = (name) => async () => ({ name, ok: true, problems: [] });

test('opsHealth: all four pass → ok and no message; a check that throws is a failure, not a crash', async () => {
  let h = await O.opsHealth(NOW, { uptime: pass('uptime'), backups: pass('backups'), mail: pass('mail'), calendar: pass('calendar') });
  assert.equal(h.ok, true);
  assert.deepEqual(h.checks.map(c => c.name), ['uptime', 'backups', 'mail', 'calendar']);
  assert.equal(O.formatOpsAlert(h), null, 'a healthy day says nothing');

  h = await O.opsHealth(NOW, { uptime: pass('uptime'), backups: async () => { throw new Error('boom'); }, mail: pass('mail'), calendar: pass('calendar') });
  assert.equal(h.ok, false);
  assert.match(h.checks[1].problems[0], /boom/);
});

test('formatOpsAlert: ONE message naming only the failing checks', async () => {
  const h = await O.opsHealth(NOW, {
    uptime: pass('uptime'),
    backups: async () => ({ name: 'backups', ok: false, problems: ['last backup 30 hours ago'] }),
    mail: async () => ({ name: 'mail', ok: false, problems: ['Gmail refused the login'] }),
    calendar: pass('calendar'),
  });
  const msg = O.formatOpsAlert(h);
  assert.equal(typeof msg, 'string');
  assert.match(msg, /30 hours/);
  assert.match(msg, /Gmail/);
  assert.match(msg, /גיבוי/);
  assert.ok(!/אתר/.test(msg.split('\n').slice(1).join('\n')), 'a passing check is not listed');
});

test('runOpsHealthCheck: same never-silent rules as the generation check (shared deliverAlert)', async () => {
  const quiet = { error() {}, warn() {} };
  const healthy = await O.opsHealth(NOW, { uptime: pass('uptime'), backups: pass('backups'), mail: pass('mail'), calendar: pass('calendar') });
  const failing = await O.opsHealth(NOW, { uptime: async () => ({ name: 'uptime', ok: false, problems: ['502'] }),
    backups: pass('backups'), mail: pass('mail'), calendar: pass('calendar') });
  const slack = { kind: 'slack', webhookUrl: 'https://hooks.slack.com/services/T/B/x' };
  const sends = [];
  const okSend = async (t, c) => { sends.push(t); return { ok: true }; };

  assert.equal((await O.runOpsHealthCheck({ health: healthy, channels: { ok: false, reason: 'none' }, send: okSend, log: quiet })).status, 503);
  assert.equal((await O.runOpsHealthCheck({ health: healthy, channels: { ok: true, channels: [slack] }, send: okSend, log: quiet })).status, 200);
  assert.equal(sends.length, 0);
  const r = await O.runOpsHealthCheck({ health: failing, channels: { ok: true, channels: [slack] }, send: okSend, log: quiet });
  assert.equal(r.status, 200);
  assert.equal(sends.length, 1, 'exactly one message');
  assert.equal((await O.runOpsHealthCheck({ health: failing, channels: { ok: true, channels: [slack] },
    send: async () => ({ ok: false, error: 'Slack answered 404' }), log: quiet })).status, 502);
});
