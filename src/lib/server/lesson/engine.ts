/**
 * How the lesson engine is located, and how its failures are named.
 *
 * The engine is Codex (`codex exec`), and only Codex. This module briefly
 * carried a LESSON_ENGINE switch with a Claude Code implementation beside
 * it, kept as a rollback — but the rollback was a fiction: the subscription
 * behind Claude Code had been revoked (that is what prompted the move), and
 * the runtime image stopped carrying the binary. A branch that cannot run,
 * guarded by a variable nobody sets, is the "designed replacement left
 * unwired" pattern this codebase has been bitten by repeatedly. It is gone.
 *
 * What remains is the part that was never about having two engines: naming
 * failures precisely enough to act on. That mattered because of how the
 * outage looked from the outside:
 *
 *     $ claude -p "reply with exactly: OK"
 *     Your organization has disabled Claude subscription access for Claude Code
 *     exit=1   (message on STDOUT; stderr EMPTY)
 *
 * The runner read only stderr, so its rejection carried an empty string, and
 * queue.ts replaced even that with one fixed sentence. Weeks of failed
 * bookings recorded "שגיאה טכנית" and the real answer — renew a subscription
 * — was never written down. Two rules came out of that:
 *
 *  1. Never diagnose from one stream. spawn.ts captures stdout AND stderr;
 *     `classifyOutput` reads both.
 *  2. A failure carries a machine-readable `kind` to the caller, so the
 *     operator-facing message can say WHICH thing broke without ever
 *     interpolating raw agent output into it (see the warning on `detail`).
 *
 * No spawning and no message copy live here — prep.ts and ask.ts run the
 * agent, queue.ts words the failure. This holds only what all of them plus
 * boot-checks.ts must agree on, so "is it installed", "is it authenticated"
 * and "did it fail on auth" cannot drift apart between them.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type LessonFailureKind =
  /** The CLI is not installed or not spawnable at all. */
  | 'engine-missing'
  /** It ran, and said it has no usable credentials. */
  | 'engine-auth'
  /**
   * It ran, was authenticated, and the subscription is out of credits.
   *
   * Neither auth nor a crash, and it needs a different answer from both: the
   * credential is fine and nothing is broken, so the useful message says
   * "wait or top up", not "check the server log". Found by the first
   * end-to-end production run, which failed with
   *
   *     ERROR: You've hit your usage limit. Upgrade to Pro ...
   *            or try again at 7:38 PM.
   *
   * and was reported as a generic engine failure — accurate, and useless to
   * the tutor reading it.
   */
  | 'engine-quota'
  /** It was still running when the budget ran out. */
  | 'engine-timeout'
  /** Non-zero exit for some other reason — read `detail` in the log. */
  | 'engine-failed'
  /** Clean exit, but nothing came back. */
  | 'no-output'
  /** Something came back, in the wrong shape. */
  | 'bad-output';

/**
 * What the tutor reads when the engine itself is unavailable — not this
 * lesson's fault, every generation fails the same way until it is back.
 * Here, not in queue.ts with the other messages, so engine-health.ts can
 * find the lessons they failed without importing the queue (which imports
 * the spawn that reports to it).
 */
export const ENGINE_DOWN_MESSAGES = {
  'engine-missing': 'מנוע יצירת השיעורים אינו מותקן על השרת — יש לבדוק את ההתקנה',
  'engine-auth':    'פג תוקף החיבור למנוע יצירת השיעורים — יש לחדש את ההרשאה בשרת',
  'engine-quota':   'נגמרה המכסה ליצירת שיעורים אוטומטית — השיעור לא נוצר. אפשר לנסות שוב מאוחר יותר',
} as const;

export class LessonGenerationError extends Error {
  readonly kind: LessonFailureKind;
  /**
   * The engine's own output, for the SERVER LOG ONLY.
   *
   * This must never reach `lessons.problem`. Agent output can carry
   * filesystem paths, config, and echoed prompt content, and that column is
   * served over HTTP (see src/routes/api/lessons/+server.ts) — which was for
   * a long time to ANY client, that route having been unauthenticated until
   * the leak was closed. A durable database column read over HTTP is not
   * where a subprocess's raw output belongs, and the guarantee should not
   * rest on one route's guard staying correct. queue.ts maps `kind` to fixed
   * Hebrew copy for that column and logs `detail` separately.
   */
  readonly detail: string;

  constructor(kind: LessonFailureKind, message: string, detail = '') {
    super(message);
    this.name = 'LessonGenerationError';
    this.kind = kind;
    this.detail = detail;
  }
}

/** The binary to spawn. CODEX_BIN exists so tests can point at a stub script
 *  without a real CLI installed. */
export function engineBin(): string {
  return process.env.CODEX_BIN || 'codex';
}

/**
 * Which agent generates a LESSON: Codex, unless LESSON_ENGINE names another.
 *
 * The server never sets it, and stays on Codex. Claude Code and opencode are
 * for the tutor's own machine, where scripts/library-local.mjs prepares
 * library lessons and imports them (/api/library/import). They came back on
 * 2026-10-01, when production's Codex account ran out of usage until 12.10:
 * the Claude path removed earlier (see the top of this file) could not run
 * on the box; this one runs where those CLIs are installed and signed in.
 * Only lesson generation takes them — ask.ts and homework.ts are Codex only.
 */
export type LessonEngine = 'codex' | 'claude' | 'opencode';

export function lessonEngine(): LessonEngine {
  const e = (process.env.LESSON_ENGINE || 'codex').trim();
  if (e === 'codex' || e === 'claude' || e === 'opencode') return e;
  throw new Error(`LESSON_ENGINE must be codex, claude or opencode, not "${e}"`);
}

export const claudeBin = (): string => process.env.CLAUDE_BIN || 'claude';
export const opencodeBin = (): string => process.env.OPENCODE_BIN || 'opencode';

/** Where Codex keeps its credentials. Honours CODEX_HOME, which is also how
 *  the container reaches its mounted auth file. */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

/**
 * Whether the engine looks authenticated, WITHOUT running it.
 *
 * Cheap and structural — it answers "has anyone configured credentials", not
 * "are they still valid". A revoked-but-present credential still passes here
 * and fails at generation time as `engine-auth`; that is the correct split,
 * since the only way to know a token is live is to spend a request.
 *
 * Codex subscription auth is a FILE, not an env var: `codex login` writes
 * $CODEX_HOME/auth.json and refreshes it in place, which is why the
 * container mounts that path read-write rather than passing a token through
 * the environment. An API key in OPENAI_API_KEY is the metered alternative
 * and also counts.
 */
export function engineHasCredentials(): boolean {
  if (process.env.OPENAI_API_KEY) return true;
  return existsSync(join(codexHome(), 'auth.json'));
}

/**
 * Recognises "this failed because of credentials" in the engine's own words.
 *
 * A heuristic over English CLI copy, so it will miss phrasings not listed
 * here. That is survivable by construction: an unmatched failure becomes
 * `engine-failed`, whose full output is logged verbatim — the operator sees
 * the real reason either way, and the only thing lost is the more specific
 * dashboard message. Missing a phrase must never be worse than the generic
 * path, so this only ever narrows a failure, never invents one.
 */
const AUTH_PHRASES = [
  'disabled claude subscription access',   // the revocation that started this
  'invalid api key',
  'authentication_error',
  'not logged in',
  'please run codex login',
  'run `codex login`',
  'unauthorized',
  '401',
  'oauth token',
  'expired',
];

/**
 * Running out of credits, in the engine's own words.
 *
 * Checked BEFORE the auth phrases: a quota message can carry "429", which
 * the auth list also matches, and being told to renew a credential that is
 * working is worse than being told nothing.
 */
const QUOTA_PHRASES = [
  "you've hit your usage limit",   // Codex, verbatim
  'usage limit',
  'out of credits',
  'purchase more credits',
  'rate limit',
  'too many requests',
  'resource_exhausted',
];

export function classifyOutput(text: string): 'engine-auth' | 'engine-quota' | null {
  const hay = text.toLowerCase();
  if (QUOTA_PHRASES.some(p => hay.includes(p))) return 'engine-quota';
  return AUTH_PHRASES.some(p => hay.includes(p)) ? 'engine-auth' : null;
}
