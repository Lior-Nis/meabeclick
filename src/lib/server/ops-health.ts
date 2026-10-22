/**
 * The daily ops health check (Todoist 6hmX5rXVh6J636HH): uptime, backup
 * success, mail credentials and calendar write failures. One message to
 * Lior on any failure, silent otherwise.
 *
 * PRODUCT.md's reliability floor says backups must actually restore, and a
 * calendar or mail failure must reach the tutor instead of failing
 * silently. Each of these has failed silently in production before:
 *
 *  - mail     2026-09-20: the Gmail app password was revoked (535
 *             BadCredentials). Booking mail and portal links swallow send
 *             failures on purpose, so the only symptom was families not
 *             getting things (email.ts, verifyEmailTransport).
 *  - backups  the Drive upload is built to never fail the nightly job
 *             (server/drive/upload-backup.mjs), and an OAuth app left in
 *             "Testing" stops after 7 days with a 401 nobody reads.
 *  - calendar a failed write is saved to `calendar_failures` and shown on
 *             the dashboard, which only helps if someone opens it.
 *
 * What each check does — all read-only, nothing is written anywhere:
 *
 *  uptime    GET SITE_URL from inside the app, i.e. through DNS, Caddy and
 *            TLS the way a parent reaches it, and read the certificate's
 *            expiry (Caddy renews ~30 days ahead, so under CERT_MIN_DAYS
 *            means renewal is broken). The app being DOWN cannot be
 *            reported from inside it: that is the host side's job — the
 *            timer's OnFailure handler (server/health-alert.sh).
 *  backups   list the backup folder on Drive (the off-box copy, with the
 *            same drive.file login the uploader uses): the newest
 *            results-<date>.db must be under BACKUP_MAX_AGE_HOURS old and
 *            non-empty, with that night's files-<date>.tar.gz beside it.
 *            Drive is checked rather than ~/backups because the app
 *            container cannot see the host's disk, and because a backup
 *            that only exists on the box it protects is not the one that
 *            matters. Never creates the folder.
 *  mail      SMTP login with the Gmail credentials (nodemailer verify):
 *            proves they are accepted, sends nothing.
 *  calendar  every unresolved `calendar_failures` row (reported every day
 *            until the tutor marks it resolved on the dashboard), plus a
 *            probe of the calendar robot: it can still sign in, and can see
 *            each active tutor's lesson calendar (events.list, 1 row). A
 *            booking only writes the calendar when it happens; this finds a
 *            dead key before the next parent books.
 *
 * Bookings are named by id and lesson time, never by the family's name: the
 * message leaves the app (Slack/WhatsApp), and the name is on the dashboard.
 */
import type { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:tls';
import { handle } from './db.ts';
import { israelDay } from '../dates.ts';
import { emailConfigured, verifyEmailTransport } from './email.ts';
import { serviceAccount, getAccessToken, type ServiceAccount } from './lesson-calendar.ts';
import { readConfig, accessToken, findFolder, listBackups } from '../../../server/drive/client.mjs';
import { deliverAlert, type AlertChannel, type AlertChannels, type SendResult } from './ops-alert.ts';

/** The nightly backup timer fires once a day; 26h allows for its own
 *  timing drift and the check's, and catches a single missed night. */
export const BACKUP_MAX_AGE_HOURS = 26;
/** Caddy renews 30 days ahead; two weeks left means it has been failing. */
export const CERT_MIN_DAYS = 14;
const TIMEOUT_MS = 15_000;
const LIST_MAX = 5;

export type CheckName = 'uptime' | 'backups' | 'mail' | 'calendar';
export interface CheckResult {
  name: CheckName;
  ok: boolean;
  /** One line each, already fit for the message. Empty when ok. */
  problems: string[];
  info?: Record<string, unknown>;
}
export interface OpsHealth { ok: boolean; at: string; checks: CheckResult[] }

const result = (name: CheckName, problems: string[], info?: Record<string, unknown>): CheckResult =>
  ({ name, ok: problems.length === 0, problems, ...(info ? { info } : {}) });

const oneLine = (s: unknown, max = 140) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A fetch error's useful part: Node's undici says "fetch failed" and puts
 *  ECONNREFUSED / ENOTFOUND / a timeout in `cause`. */
function fetchError(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `no answer in ${TIMEOUT_MS / 1000}s`;
  return oneLine(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? 'unknown error');
}

const israelTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
};

/* ── uptime ───────────────────────────────────────────────────────── */

/** When the certificate `host` serves expires. Null if it serves none. */
export function tlsCertExpiry(host: string, port = 443): Promise<Date | null> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port, servername: host, timeout: TIMEOUT_MS }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    sock.on('timeout', () => { sock.destroy(); reject(new Error(`no TLS answer in ${TIMEOUT_MS / 1000}s`)); });
    sock.on('error', reject);
  });
}

export async function checkUptime({
  siteUrl = process.env.SITE_URL ?? '', now = new Date(), fetchImpl = fetch, certExpiry = tlsCertExpiry,
}: { siteUrl?: string; now?: Date; fetchImpl?: typeof fetch; certExpiry?: (host: string) => Promise<Date | null> } = {}): Promise<CheckResult> {
  if (!siteUrl.trim()) return result('uptime', ['SITE_URL is not set: nothing to check the public site against']);
  let url: URL;
  try { url = new URL('/', siteUrl); } catch { return result('uptime', ['SITE_URL is not a URL']); }

  const problems: string[] = [];
  const info: Record<string, unknown> = { url: url.origin };
  const t0 = Date.now();
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
    info.status = r.status;
    info.ms = Date.now() - t0;
    await r.arrayBuffer().catch(() => {});   // drain: frees the connection
    if (!r.ok) problems.push(`${url.origin} answered ${r.status}`);
  } catch (err) {
    problems.push(`${url.origin} unreachable: ${fetchError(err)}`);
  }

  if (url.protocol === 'https:' && !problems.length) {
    try {
      const until = await certExpiry(url.hostname);
      if (until) {
        const days = Math.floor((until.getTime() - now.getTime()) / 86_400_000);
        info.certDaysLeft = days;
        if (days < CERT_MIN_DAYS) problems.push(`TLS certificate expires in ${days} days (${israelDay(until.toISOString())}) — Caddy is not renewing it`);
      }
    } catch (err) {
      problems.push(`TLS check failed: ${oneLine((err as Error)?.message)}`);
    }
  }
  return result('uptime', problems, info);
}

/* ── backups ──────────────────────────────────────────────────────── */

export async function checkBackups({
  env = process.env, now = new Date(), fetchImpl = fetch, maxAgeHours = BACKUP_MAX_AGE_HOURS,
}: { env?: Record<string, string | undefined>; now?: Date; fetchImpl?: typeof fetch; maxAgeHours?: number } = {}): Promise<CheckResult> {
  const { cfg, missing } = readConfig(env);
  if (missing.length) {
    return result('backups', [
      `cannot see the off-box backups: the Drive login is not configured (${missing.map(k => ({ clientId: 'GOOGLE_OAUTH_CLIENT_ID', clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET', refreshToken: 'GOOGLE_OAUTH_REFRESH_TOKEN' })[k as 'clientId'] ?? k).join(', ')} unset)`,
    ]);
  }
  try {
    const token = await accessToken(cfg as { clientId: string; clientSecret: string; refreshToken: string }, fetchImpl);
    const folderId = cfg.folderId || await findFolder(token, cfg.folderName, fetchImpl);
    if (!folderId) return result('backups', [`no backup folder "${cfg.folderName}" on Drive — the uploader has never run`]);

    const files = await listBackups(token, folderId, fetchImpl);
    const dbs = files.filter(f => /^results-\d{4}-\d{2}-\d{2}\.db$/.test(f.name))
      .sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    const last = dbs[0];
    if (!last) return result('backups', ['no database backup (results-<date>.db) on Drive at all']);

    const stamp = last.name.slice('results-'.length, -'.db'.length);
    const ageHours = Math.round((now.getTime() - new Date(last.createdTime).getTime()) / 3_600_000);
    const info = { lastBackup: last.name, uploadedAt: last.createdTime, ageHours };
    const problems: string[] = [];
    if (ageHours > maxAgeHours) problems.push(`last backup on Drive is ${ageHours} hours old (${last.name}) — the nightly backup or its upload did not run`);
    if (Number(last.size ?? 0) <= 0) problems.push(`${last.name} on Drive is empty (0 bytes)`);
    const tarball = files.find(f => f.name === `files-${stamp}.tar.gz`);
    if (!tarball) problems.push(`files-${stamp}.tar.gz (portal, games, lessons, drafts) is missing beside ${last.name}`);
    else if (Number(tarball.size ?? 0) <= 0) problems.push(`files-${stamp}.tar.gz on Drive is empty (0 bytes)`);
    return result('backups', problems, info);
  } catch (err) {
    /* client.mjs errors carry the status only, never Google's body or the
       client secret: safe to pass on. */
    return result('backups', [`could not read the backups on Drive: ${oneLine((err as Error)?.message)}`]);
  }
}

/* ── mail ─────────────────────────────────────────────────────────── */

export async function checkMail({
  configured = emailConfigured, verify = () => verifyEmailTransport(),
}: { configured?: () => boolean; verify?: () => Promise<{ configured: boolean; ok: boolean; reason?: string }> } = {}): Promise<CheckResult> {
  if (!configured()) return result('mail', ['GMAIL_USER / GMAIL_APP_PASSWORD are not set: booking mail and portal links cannot go out']);
  const v = await verify();
  return v.ok ? result('mail', [])
    : result('mail', [`Gmail refused the login: ${oneLine(v.reason, 160)} — a new app password is needed`]);
}

/* ── calendar ─────────────────────────────────────────────────────── */

interface FailureRow { id: number; start: string; message: string | null; at: string }

export async function checkCalendar({
  db = handle(), now = new Date(), sa = serviceAccount(), fetchImpl = fetch,
}: { db?: DatabaseSync; now?: Date; sa?: ServiceAccount | null; fetchImpl?: typeof fetch } = {}): Promise<CheckResult> {
  const problems: string[] = [];

  /* Names deliberately not selected: see the header. */
  const open = db.prepare(`SELECT id, start, message, at FROM calendar_failures WHERE resolved = 0 ORDER BY at DESC, id DESC`)
    .all() as unknown as FailureRow[];
  const dayAgo = now.getTime() - 86_400_000;
  const newToday = open.filter(f => new Date(f.at).getTime() > dayAgo).length;
  if (open.length) {
    problems.push(`${open.length} lesson(s) not written to the calendar, unresolved on the dashboard (${newToday} new in 24h):`);
    for (const f of open.slice(0, LIST_MAX)) {
      problems.push(`  #${f.id}, lesson ${israelTime(f.start)} — ${oneLine(f.message, 100) || 'no error text'}`);
    }
    if (open.length > LIST_MAX) problems.push(`  and ${open.length - LIST_MAX} more`);
  }

  const tutors = db.prepare(`SELECT id, name, calendar_id FROM teachers WHERE active = 1 AND COALESCE(calendar_id, '') <> '' ORDER BY id`)
    .all() as unknown as { id: number; name: string; calendar_id: string }[];
  if (tutors.length) {
    if (!sa) {
      problems.push('the calendar robot key is missing or unreadable (GOOGLE_SERVICE_ACCOUNT_KEY_FILE): every booking will fail to reach the calendar');
    } else {
      let token: string | null = null;
      try { token = await getAccessToken(sa, fetchImpl); } catch (err) {
        problems.push(`the calendar robot cannot sign in: ${oneLine((err as Error)?.message, 120)}`);
      }
      for (const t of token ? tutors : []) {
        try {
          const r = await fetchImpl(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(t.calendar_id)}/events?maxResults=1`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!r.ok) problems.push(`the calendar robot cannot reach ${t.name}'s lesson calendar: Google answered ${r.status}`);
        } catch (err) {
          problems.push(`the calendar robot cannot reach ${t.name}'s lesson calendar: ${fetchError(err)}`);
        }
      }
    }
  }
  return result('calendar', problems, { unresolved: open.length, newToday, tutorCalendars: tutors.length });
}

/* ── the report and the one message ───────────────────────────────── */

type Checks = Record<CheckName, () => Promise<CheckResult>>;
const ORDER: CheckName[] = ['uptime', 'backups', 'mail', 'calendar'];

export const defaultChecks = (now: Date): Checks => ({
  uptime: () => checkUptime({ now }),
  backups: () => checkBackups({ now }),
  mail: () => checkMail(),
  calendar: () => checkCalendar({ now }),
});

/** Runs all four, side by side. A check that throws is a failure of that
 *  check, never a crash of the report: one broken probe must not hide the
 *  other three. */
export async function opsHealth(now: Date = new Date(), checks: Checks = defaultChecks(now)): Promise<OpsHealth> {
  const results = await Promise.all(ORDER.map(async (name) => {
    try { return await checks[name](); } catch (err) {
      return result(name, [`the check itself failed: ${oneLine((err as Error)?.message)}`]);
    }
  }));
  return { ok: results.every(r => r.ok), at: now.toISOString(), checks: results };
}

const TITLE: Record<CheckName, string> = {
  uptime: 'האתר',
  backups: 'גיבוי',
  mail: 'מייל',
  calendar: 'יומן',
};

/** The ONE summary for a day with failures. Null when all is well. */
export function formatOpsAlert(h: OpsHealth): string | null {
  if (h.ok) return null;
  const failing = h.checks.filter(c => !c.ok);
  const lines = [`⚠️ בדיקת תפעול יומית — ${failing.length} מתוך ${h.checks.length} נכשלו`];
  for (const c of failing) {
    lines.push(`${TITLE[c.name]} (${c.name}):`);
    for (const p of c.problems) lines.push(p.startsWith('  ') ? `  ${p.trim()}` : `• ${p}`);
  }
  return lines.join('\n');
}

/** The morning run, minus HTTP: what POST /api/health/ops answers. Same
 *  503/502/200 rules as the generation check (deliverAlert). */
export async function runOpsHealthCheck({ health, channels, send, log = console }: {
  health: OpsHealth;
  channels: AlertChannels;
  send: (text: string, c: AlertChannel) => Promise<SendResult>;
  log?: Pick<Console, 'error' | 'warn'>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  return deliverAlert({ tag: 'ops-health', ok: health.ok, message: formatOpsAlert(health), report: health, channels, send, log });
}
