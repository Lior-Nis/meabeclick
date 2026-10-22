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
 *
 * Read-only. Imports the shared handle, writes nothing.
 */
import type { DatabaseSync } from 'node:sqlite';
import { handle } from '../db.ts';
import type { WhatsAppChannel } from './queue.ts';

export const WINDOW_HOURS = 24;
/** Far beyond any engine timeout (prep.ts LESSON_TIMEOUT_MS, 20 min for
 *  non-Codex, LESSON_TIMEOUT_MINUTES override) plus homework generation. */
export const STUCK_MINUTES = 60;
/** How many rows of each kind the message lists before "and N more". */
const LIST_MAX = 5;

export interface RunRow { slug: string; status: string; problem: string | null; at: string }
export interface EngineRow { engine: string; kind: string; until: string | null; at: string }

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
}

export function generationHealth(
  now: Date = new Date(),
  { hours = WINDOW_HOURS, stuckMinutes = STUCK_MINUTES, db = handle() }:
    { hours?: number; stuckMinutes?: number; db?: DatabaseSync } = {},
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

  return {
    ok: !failed.length && !held.length && !undelivered.length && !stuck.length && !enginesDown.length,
    window: { from, to, hours },
    runs, failed, held, undelivered, stuck, enginesDown,
  };
}

const israelTime = (iso: string): string => new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(new Date(iso));

/** One line per row, problem cut short: a WhatsApp, not a log dump. */
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
  for (const e of h.enginesDown) {
    lines.push(`מנוע ${e.engine} מושבת: ${e.kind}${e.until ? ` עד ${israelTime(e.until)}` : ''} (מאז ${israelTime(e.at)})`);
  }
  return lines.join('\n');
}

/** Who the morning alert goes to — see /api/health/generation. CallMeBot
 *  issues one key per recipient phone, so the OPS_ pair travels together. */
export type AlertChannel =
  | { kind: 'ops'; to: WhatsAppChannel }
  | { kind: 'tutor'; to: null }
  | { kind: 'missing'; reason: string };

export function alertChannel(env: NodeJS.ProcessEnv = process.env): AlertChannel {
  const phone = env.OPS_CALLMEBOT_PHONE?.trim();
  const apiKey = env.OPS_CALLMEBOT_API_KEY?.trim();
  if (phone && apiKey) return { kind: 'ops', to: { phone, apiKey } };
  if (phone || apiKey) {
    return { kind: 'missing', reason: 'only one of OPS_CALLMEBOT_PHONE / OPS_CALLMEBOT_API_KEY is set; set both or neither' };
  }
  if (env.CALLMEBOT_API_KEY?.trim()) return { kind: 'tutor', to: null };
  return { kind: 'missing', reason: 'no alert channel: set OPS_CALLMEBOT_PHONE + OPS_CALLMEBOT_API_KEY (or CALLMEBOT_API_KEY)' };
}

