/**
 * The daily generation health check (Todoist 6hmX5pXvghfFvv6H).
 *
 * Lesson generation fails quietly. A booking returns at once and generation
 * runs behind it (queue.ts); when it fails, the only trace is a `lessons` row
 * and, if CALLMEBOT_API_KEY happens to be set, one WhatsApp to the tutor. A
 * process restart in the middle of a run leaves the row at `generating`
 * forever and tells nobody. That is how the 10-clean-runs gate (PRODUCT.md)
 * can sit at 0 without anyone noticing.
 *
 * This reads what already exists and says, once a day, whether anything
 * went wrong:
 *
 *  - `failed`     runs in the window (with `problem`)
 *  - `held`       runs in the window: generated, stopped for review
 *  - undelivered  `ready` with a `problem`: generated, never reached the
 *                 student's page (queue.ts records that on `problem`;
 *                 scripts/vision-metrics.mjs counts it as not clean too)
 *  - stuck        `generating` older than STUCK_MINUTES, at any age: no
 *                 engine run lasts that long (prep.ts: 5 min for Codex,
 *                 20 otherwise), so the process died under it
 *  - engine down  every engine_status row (engine-health.ts deletes the row
 *                 on the next success, so a row is an outage still open)
 *  - stale        a maths booking (bookings_v2) in the last/next STALE_DAYS
 *                 with no `ready` lesson for it — no row at all, or one that
 *                 failed or was held before the 24h window. A failure that
 *                 happened a week before the lesson would otherwise be
 *                 reported once and forgotten; a lesson that was never even
 *                 attempted would never be reported at all.
 *  - codex idle   that, AND no successful Codex run in STALE_DAYS: the
 *                 engine itself is likely broken, not one lesson. Reported as
 *                 a diagnosis on top of `stale`, never alone — on its own,
 *                 "no Codex run while bookings exist" is the normal state
 *                 when the library or an earlier run already covered them.
 *                 `lastCodexSuccess` is in every report for context.
 *
 * Read-only. Imports the shared handle, writes nothing.
 */
import type { DatabaseSync } from 'node:sqlite';
import { handle } from '../db.ts';
import { autopilotCovers } from '../../subjects.ts';
import { deliverAlert, type AlertChannel, type AlertChannels, type SendResult } from '../ops-alert.ts';

export const WINDOW_HOURS = 24;
/** Far beyond any engine timeout (prep.ts LESSON_TIMEOUT_MS, 20 min for
 *  non-Codex, LESSON_TIMEOUT_MINUTES override) plus homework generation. */
export const STUCK_MINUTES = 60;
/** How far back and ahead booked lessons are checked for a ready lesson,
 *  and how long Codex may go without a success while one is missing.
 *  GENERATION_HEALTH_STALE_DAYS overrides it. */
export const STALE_DAYS = 3;
/** How many rows of each kind the message lists before "and N more". */
const LIST_MAX = 5;

export interface RunRow { slug: string; status: string; problem: string | null; at: string }
export interface EngineRow { engine: string; kind: string; until: string | null; at: string }
/** A booking id and time only: the report names no student. `lesson` is the
 *  best status a lesson for it reached (null: none was ever recorded). */
export interface StaleBooking { bookingId: number; start: string; lesson: string | null }

export interface Stale {
  days: number;
  bookedWithoutLesson: StaleBooking[];
  /** Last `ready` run made by Codex in production (not a library copy, not
   *  an import from the tutor's machine). Null: never. */
  lastCodexSuccess: string | null;
  codexIdle: boolean;
}

export interface GenerationHealth {
  ok: boolean;
  window: { from: string; to: string; hours: number };
  /** Every run the window saw, by final status: context for "how bad". */
  runs: { total: number; ready: number; held: number; failed: number; generating: number };
  failed: RunRow[];
  held: RunRow[];
  undelivered: RunRow[];
  stuck: RunRow[];
  enginesDown: EngineRow[];
  stale: Stale;
}

/** GENERATION_HEALTH_STALE_DAYS, if it is a sane whole number of days. */
export function staleDaysFrom(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.GENERATION_HEALTH_STALE_DAYS);
  return Number.isInteger(n) && n > 0 && n <= 60 ? n : STALE_DAYS;
}

const hasTable = (db: DatabaseSync, name: string): boolean =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);

/** The stale-generation signal: see the header. Times are compared as
 *  instants, not strings — production has both `…Z` and `…+03:00` starts,
 *  and queue.ts copies the booking's own string into lessons.lesson_at. */
export function staleGeneration(now: Date, days: number, db: DatabaseSync): Stale {
  const t = now.getTime();
  const from = t - days * 86_400_000;
  const to = t + days * 86_400_000;

  /* Maths only (autopilotCovers): no other subject is generated, so its
     bookings never have a lesson by design. A booking with no enrollment
     has no known subject and is left out rather than guessed at. */
  const bookings = (db.prepare(`
    SELECT b.id, b.start, e.subject FROM bookings_v2 b JOIN enrollments e ON e.id = b.enrollment_id
     WHERE b.status != 'cancelled'
  `).all() as unknown as { id: number; start: string; subject: string }[])
    .filter(b => autopilotCovers(b.subject))
    .filter(b => { const s = new Date(b.start).getTime(); return s >= from && s <= to; });

  const lessonsAt = new Map<number, string[]>();
  for (const l of db.prepare(`SELECT lesson_at, status FROM lessons WHERE lesson_at IS NOT NULL`).all() as unknown as
      { lesson_at: string; status: string }[]) {
    const k = new Date(l.lesson_at).getTime();
    if (Number.isNaN(k)) continue;
    lessonsAt.set(k, [...(lessonsAt.get(k) ?? []), l.status]);
  }
  const RANK = ['generating', 'failed', 'held', 'ready'];
  const best = (statuses: string[]): string =>
    statuses.reduce((a, b) => (RANK.indexOf(b) > RANK.indexOf(a) ? b : a));

  const bookedWithoutLesson: StaleBooking[] = [];
  for (const b of bookings) {
    const statuses = lessonsAt.get(new Date(b.start).getTime());
    /* A row still generating is in flight (a booking made minutes ago) or
       stuck — and stuck rows are reported on their own. */
    if (statuses && (statuses.includes('ready') || statuses.includes('generating'))) continue;
    bookedWithoutLesson.push({ bookingId: b.id, start: b.start, lesson: statuses ? best(statuses) : null });
  }
  bookedWithoutLesson.sort((a, b) => a.start.localeCompare(b.start));

  const notCodex = [
    hasTable(db, 'library_uses') ? `slug NOT IN (SELECT lesson_slug FROM library_uses)` : '1',
    hasTable(db, 'lesson_engines') ? `slug NOT IN (SELECT lesson_slug FROM lesson_engines WHERE engine <> 'codex')` : '1',
  ].join(' AND ');
  const last = db.prepare(`SELECT MAX(at) at FROM lessons WHERE status = 'ready' AND ${notCodex}`).get() as { at: string | null };
  const lastCodexSuccess = last?.at ?? null;
  const codexIdle = bookedWithoutLesson.length > 0
    && (!lastCodexSuccess || new Date(lastCodexSuccess).getTime() < from);

  return { days, bookedWithoutLesson, lastCodexSuccess, codexIdle };
}

export function generationHealth(
  now: Date = new Date(),
  { hours = WINDOW_HOURS, stuckMinutes = STUCK_MINUTES, staleDays = staleDaysFrom(), db = handle() }:
    { hours?: number; stuckMinutes?: number; staleDays?: number; db?: DatabaseSync } = {},
): GenerationHealth {
  const to = now.toISOString();
  const from = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const stuckBefore = new Date(now.getTime() - stuckMinutes * 60_000).toISOString();

  const inWindow = db.prepare(`
    SELECT slug, status, problem, at FROM lessons
     WHERE at > ? AND at <= ?
     ORDER BY at DESC, id DESC
  `).all(from, to) as unknown as RunRow[];

  const runs = { total: inWindow.length, ready: 0, held: 0, failed: 0, generating: 0 };
  for (const r of inWindow) {
    if (r.status in runs && r.status !== 'total') runs[r.status as keyof typeof runs] += 1;
  }

  /* Stuck rows are read at any age, not just inside the window: a run that
     died last week is still a lesson nobody prepared, and it would never
     be reported again once it left the window. */
  const stuck = db.prepare(`
    SELECT slug, status, problem, at FROM lessons
     WHERE status = 'generating' AND at <= ?
     ORDER BY at DESC, id DESC
  `).all(stuckBefore) as unknown as RunRow[];

  const hasEngineStatus = !!db.prepare(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'engine_status'`).get();
  const enginesDown = hasEngineStatus
    ? db.prepare(`SELECT engine, kind, until, at FROM engine_status ORDER BY engine`).all() as unknown as EngineRow[]
    : [];

  const failed = inWindow.filter(r => r.status === 'failed');
  const held = inWindow.filter(r => r.status === 'held');
  const undelivered = inWindow.filter(r => r.status === 'ready' && !!r.problem);

  const stale = staleGeneration(now, staleDays, db);

  return {
    ok: !failed.length && !held.length && !undelivered.length && !stuck.length && !enginesDown.length
      && !stale.bookedWithoutLesson.length,
    window: { from, to, hours },
    runs, failed, held, undelivered, stuck, enginesDown, stale,
  };
}

const israelTime = (iso: string): string => new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

/** One line per row, problem cut short: a chat message, not a log dump. */
function section(title: string, rows: RunRow[]): string[] {
  if (!rows.length) return [];
  const lines = rows.slice(0, LIST_MAX).map(r =>
    `• ${r.slug} (${israelTime(r.at)})${r.problem ? ` — ${r.problem.replace(/\s+/g, ' ').slice(0, 120)}` : ''}`);
  if (rows.length > LIST_MAX) lines.push(`• ועוד ${rows.length - LIST_MAX}`);
  return [`${title}: ${rows.length}`, ...lines];
}

/** The ONE summary message for a day with failures. Null when all is well. */
export function formatAlert(h: GenerationHealth): string | null {
  if (h.ok) return null;
  const lines = [
    `⚠️ בדיקת יצירת שיעורים — ${h.window.hours} שעות אחרונות`,
    `ריצות: ${h.runs.total} (מוכנים ${h.runs.ready}, נעצרו ${h.runs.held}, נכשלו ${h.runs.failed})`,
    ...section('נכשלו', h.failed),
    ...section('נעצרו לבדיקה', h.held),
    ...section('נוצרו אך לא הגיעו לתלמיד', h.undelivered),
    ...section('תקועים ב"נוצר" (התהליך מת באמצע)', h.stuck),
  ];
  const sb = h.stale.bookedWithoutLesson;
  if (sb.length) {
    const label: Record<string, string> = { failed: 'נכשל', held: 'נעצר' };
    lines.push(`שיעורים מוזמנים בלי שיעור מוכן (±${h.stale.days} ימים): ${sb.length}`);
    for (const b of sb.slice(0, LIST_MAX)) {
      lines.push(`• הזמנה #${b.bookingId} (${israelTime(b.start)}) — ${b.lesson ? label[b.lesson] ?? b.lesson : 'לא נוצר כלל'}`);
    }
    if (sb.length > LIST_MAX) lines.push(`• ועוד ${sb.length - LIST_MAX}`);
  }
  if (h.stale.codexIdle) {
    lines.push(`Codex לא יצר אף שיעור בהצלחה ${h.stale.days} ימים`
      + (h.stale.lastCodexSuccess ? ` (אחרון: ${israelTime(h.stale.lastCodexSuccess)})` : ' (מעולם)')
      + ' — כנראה המנוע, לא שיעור בודד');
  }
  for (const e of h.enginesDown) {
    lines.push(`מנוע ${e.engine} מושבת: ${e.kind}${e.until ? ` עד ${israelTime(e.until)}` : ''} (מאז ${israelTime(e.at)})`);
  }
  return lines.join('\n');
}

/* Where the alert goes, and the 503/502/200 rules, are shared with the ops
   health check: $server/ops-alert.ts. Re-exported so callers and tests of
   this check keep their imports. */
export { alertChannels, channelLabel, sendSlack } from '../ops-alert.ts';
export type { AlertChannel, AlertChannels, SendResult } from '../ops-alert.ts';

/**
 * The morning run, minus HTTP: what POST /api/health/generation answers.
 * The never-silent rules (503 mute, 200 silent when healthy, 502 on any
 * failed send) live in deliverAlert, shared with the ops health check.
 */
export async function runHealthCheck({ health, channels, send, log = console }: {
  health: GenerationHealth;
  channels: AlertChannels;
  send: (text: string, c: AlertChannel) => Promise<SendResult>;
  log?: Pick<Console, 'error' | 'warn'>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  return deliverAlert({
    tag: 'generation-health', ok: health.ok, message: formatAlert(health), report: health, channels, send, log,
  });
}
