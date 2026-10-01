/**
 * Whether a lesson engine is down, and until when (migration 026).
 *
 * spawnAgent reports every run here: a quota, sign-in or missing-binary
 * failure marks the engine down; any run that succeeds marks it up again.
 * Found 2026-10-01: production's Codex account was out of usage for twelve
 * days, Codex said exactly when it would be back, and the app kept only
 * "codex exited 1" — the tutor would have learned it from failed bookings.
 *
 * Nothing here may break a generation: recording is best-effort.
 */
import { handle } from '../db.ts';
import { ENGINE_DOWN_MESSAGES, type LessonFailureKind } from './engine.ts';

const DOWN_KINDS: LessonFailureKind[] = ['engine-quota', 'engine-auth', 'engine-missing'];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * When the engine says to come back, as an ISO time — or null. Read with a
 * strict pattern and rebuilt from numbers, so nothing of the engine's text
 * survives into what is stored: "try again at Oct 12th, 2026 7:26 PM" or,
 * the same day, "try again at 7:38 PM". The engine prints the machine's
 * local time, which is this process's local time too.
 */
export function parseRetryAt(detail: string, now: Date = new Date()): string | null {
  const m = detail.match(/try again at (?:([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th)?, (\d{4}) )?(\d{1,2}):(\d{2}) ?([AP]M)/);
  if (!m) return null;
  const [, mon, day, year, h, min, ampm] = m;
  let hour = Number(h) % 12;
  if (ampm === 'PM') hour += 12;
  let at: Date;
  if (mon) {
    const month = MONTHS.indexOf(mon.toLowerCase());
    if (month < 0) return null;
    at = new Date(Number(year), month, Number(day), hour, Number(min));
  } else {
    at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, Number(min));
    if (at <= now) at.setDate(at.getDate() + 1);
  }
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

export function noteEngineFailure(engine: string, kind: LessonFailureKind, detail: string): void {
  if (!DOWN_KINDS.includes(kind)) return;
  try {
    handle().prepare(`
      INSERT INTO engine_status (engine, kind, until, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(engine) DO UPDATE SET kind = excluded.kind, until = excluded.until, at = excluded.at
    `).run(engine, kind, kind === 'engine-quota' ? parseRetryAt(detail) : null, new Date().toISOString());
  } catch (err) {
    console.error('[engine-health] could not record', (err as Error)?.message);
  }
}

export function noteEngineSuccess(engine: string): void {
  try {
    handle().prepare(`DELETE FROM engine_status WHERE engine = ?`).run(engine);
  } catch (err) {
    console.error('[engine-health] could not record', (err as Error)?.message);
  }
}

export interface EngineDown { kind: LessonFailureKind; until: string | null; at: string }

export function engineDown(engine = 'codex'): EngineDown | null {
  const r = handle().prepare(`SELECT kind, until, at FROM engine_status WHERE engine = ?`).get(engine) as EngineDown | undefined;
  return r ? { kind: r.kind, until: r.until, at: r.at } : null;
}

/**
 * What the tutor's dashboard says while the server's engine is down: why,
 * until when, and which coming lessons have nothing prepared because of it
 * (their generation failed with the engine-down message, not for some other
 * reason). Null while it is up.
 */
export function engineAlert(now: Date = new Date()): (EngineDown & { affected: { student: string; lessonAt: string }[] }) | null {
  const down = engineDown('codex');
  if (!down) return null;
  const problems = Object.values(ENGINE_DOWN_MESSAGES);
  const affected = handle().prepare(`
    SELECT student, lesson_at FROM lessons
     WHERE status = 'failed' AND lesson_at > ? AND problem IN (${problems.map(() => '?').join(',')})
     ORDER BY lesson_at LIMIT 20
  `).all(now.toISOString(), ...problems) as { student: string; lesson_at: string }[];
  return { ...down, affected: affected.map(r => ({ student: r.student, lessonAt: r.lesson_at })) };
}
