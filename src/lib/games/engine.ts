/**
 * Framework-agnostic helpers shared by every game template — the typed
 * replacement for games/game.js.
 *
 * This file is plain `.ts`, not `.svelte.ts`: it holds pure logic only
 * (formatting, shuffling, the star formula, the fire-and-forget result
 * POST). The stateful half of game.js — the timer, and the `done`/`stars`
 * flip that used to reach into the DOM by id (`el('stars')`, `el('done')`,
 * `el('done-stats')`) — is owned by GameShell.svelte instead, as Svelte
 * `$state`, and handed to each game template through context. That
 * context object *is* the typed contract that replaces game.js's eight
 * unchecked `el('...')` lookups: a template that forgets to call
 * `finish()` simply never shows a done screen, instead of the old failure
 * mode (a missing id="stars" throwing INSIDE finish(), after the result
 * was already meant to be reported, so the POST never fires either).
 */

export type GameData = {
  title: string;
  subject?: string;
  [k: string]: unknown;
};

export type FinishInput = {
  template: string;
  score: number;
  total: number;
  extraLine?: string;
  missed?: string[];
  /**
   * Override the score/total star formula below. Memory needs this: once
   * a memory board is finished, score === total always (you cannot
   * "finish" with unmatched pairs) so the percentage formula would always
   * give 3 stars — memory's actual skill signal is tries-per-pair, not
   * score. See the Task 19/20 report for why this was extended here
   * rather than left as a second, forked scoring implementation.
   *
   * Clamped to [0, 3] by GameShell before use — an out-of-range override
   * (or a future template that passes one) must not make '☆'.repeat(3 -
   * stars) throw a RangeError on a negative count.
   */
  stars?: number;
  /**
   * Override the generic "ענית נכון על X מתוך Y תוך Z" result line.
   * Memory needs this too: "8 מתוך 8" is trivially true for a finished
   * memory board (see `stars` above) — the meaningful result is tries,
   * not a score that can never be anything but perfect. Same shape as the
   * `stars` override: one template's genuinely different wording is an
   * explicit opt-out, not a second done-panel implementation. When set,
   * `extraLine` is still appended below it exactly as before.
   */
  resultLine?: string;
  /**
   * How many hints the child ASKED for during this play.
   *
   * Omitted by every template that offers no help, and stored as NULL in
   * that case — which means "none were on offer", not "needed none". The
   * suggestion engine depends on that distinction: a child cannot use help
   * a game never offered, so null must not read as a signal either way.
   *
   * Separate from `tries` on purpose. Tries measure outcome and speed;
   * Todoist id:6hRhqRvfX7VHgh9q is explicit that those alone are not
   * evidence of understanding.
   */
  hints?: number;
};

/** Svelte context key shared between GameShell (provider) and every game
 *  template (consumer) — see GameShell.svelte's header comment. */
export const GAME_CONTEXT_KEY = 'mea-beclick:game-engine';

export interface GameEngineContext {
  /** Starts the elapsed-time clock GameShell shows in the stat bar via
   *  `secs()`. Idempotent per game session — templates call it once from
   *  their data-loaded branch, same as `Game.startTimer(...)` did. */
  startTimer(): void;
  /** Current elapsed seconds, read reactively (a getter, so it stays live
   *  across Svelte's reactivity without the caller re-subscribing). */
  secs(): number;
  /** This student's personal best on this data file BEFORE this play,
   *  from getBest() (src/lib/server/db.ts) — null if never played. Reused
   *  by SpeedDrill to decide whether to show "new personal best", so that
   *  comparison also moves off localStorage along with the display. */
  best(): number | null;
  /** Ends the game: stops the timer, computes (or accepts an override)
   *  stars, shows GameShell's #done panel, and reports the result. */
  finish(input: FinishInput): void;
  /** Says a line to a screen reader, through GameShell's one polite live
   *  region. Colour and a moving card say nothing to a child who can't see
   *  them; every answer goes through here. Markup (<b>) is dropped. */
  say(text: string): void;
  shuffle: typeof shuffle;
  fmt: typeof fmt;
}

/** What is said after an answer: the verdict first, the right answer only
 *  when it was missed, then any note (the round's "why"). */
export function verdict(ok: boolean, detail: { answer?: string; note?: string } = {}): string {
  const parts = [ok ? 'נכון!' : 'לא נכון.'];
  if (!ok && detail.answer) parts.push(`התשובה: ${detail.answer}.`);
  if (detail.note) parts.push(detail.note);
  return parts.join(' ');
}

/**
 * Where a key moves a marker on a number line from `lo` to `hi`: an arrow
 * one step, a Page key ten, Home and End to the ends. The line runs left to
 * right even on a right-to-left page, so → is larger. An unplaced marker
 * starts in the middle. null: not a key the line uses.
 */
export function nudge(value: number | null, key: string, lo: number, hi: number, step: number): number | null {
  const from = value ?? (lo + hi) / 2;
  const moves: Record<string, number> = {
    ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step,
    PageUp: 10 * step, PageDown: -10 * step,
  };
  let to: number;
  if (key === 'Home') to = lo;
  else if (key === 'End') to = hi;
  else if (key in moves) to = value === null ? from : from + moves[key];
  else return null;
  /* toFixed: 0.2 + 0.1 is 0.30000000000000004, and a child hears the value. */
  return +Math.min(hi, Math.max(lo, to)).toFixed(10);
}

export function fmt(totalSeconds: number): string {
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

/** Fisher-Yates, in place, returned for chaining — same as games/game.js. */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** score/total → 3 stars at >=90%, 2 at >=65%, else 1. */
export function starsFor(score: number, total: number): number {
  const pct = total ? score / total : 0;
  return pct >= 0.9 ? 3 : pct >= 0.65 ? 2 : 1;
}

/** Clamps a star count to [0, 3] — the done panel renders
 *  '⭐'.repeat(stars) + '☆'.repeat(3 - stars), which throws a RangeError
 *  for any stars outside that range. No template passes one today, but
 *  FinishInput.stars is caller-supplied, so nothing else enforces it. */
export function clampStars(stars: number): number {
  return Math.max(0, Math.min(3, Math.round(stars)));
}

export type SaveResult = 'saved' | 'queued' | 'rejected';

type Deps = { fetch?: typeof fetch; storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null };

/** Results that could not be sent yet, kept on the device. */
const QUEUE_KEY = 'mea-beclick:pending-results';
const QUEUE_MAX = 20;

function defaultStorage(): Deps['storage'] {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readQueue(storage: Deps['storage']): Record<string, unknown>[] {
  try { return JSON.parse(storage?.getItem(QUEUE_KEY) ?? '[]'); } catch { return []; }
}
function writeQueue(storage: Deps['storage'], q: Record<string, unknown>[]): void {
  try {
    if (q.length) storage?.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
    else storage?.removeItem(QUEUE_KEY);
  } catch { /* storage full or blocked: nothing more to do */ }
}

/** One POST: 'saved', 'rejected' for a refusal that will not change on a
 *  retry (a 4xx — an unsigned demo link, say), or null to try again later. */
async function post(payload: Record<string, unknown>, f: typeof fetch): Promise<'saved' | 'rejected' | null> {
  try {
    const r = await f('/api/game-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      /* A tap on «שחקו שוב» or leaving the page must not cancel it. */
      keepalive: true,
    });
    if (r.ok) return 'saved';
    return r.status >= 400 && r.status < 500 ? 'rejected' : null;
  } catch {
    return null; // offline
  }
}

/**
 * Sends a finished game's result, and says what happened.
 *
 * It used to be fire-and-forget: the response was ignored, «שחקו שוב»
 * reloaded at once and could cancel it, and an offline child saw «סיימת!»
 * while nothing was saved (pre-launch review, 2026-09-28). Now a result
 * that could not be sent is kept on the device and sent by
 * flushQueuedResults() — on the next game, or when the connection returns.
 * `t` (gameUrl's signature) travels in the payload, as before.
 */
export async function reportResult(payload: Record<string, unknown>, deps: Deps = {}): Promise<SaveResult> {
  const f = deps.fetch ?? fetch;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const r = await post(payload, f);
  if (r) return r;
  writeQueue(storage, [...readQueue(storage), payload]);
  return 'queued';
}

/** Sends what was kept on the device. Returns how many were saved. */
export async function flushQueuedResults(deps: Deps = {}): Promise<number> {
  const f = deps.fetch ?? fetch;
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const queue = readQueue(storage);
  if (!queue.length) return 0;
  const keep: Record<string, unknown>[] = [];
  let saved = 0;
  for (const p of queue) {
    const r = await post(p, f);
    if (r === 'saved') saved++;
    else if (r === null) keep.push(p); // still offline: keep; refused: drop
  }
  writeQueue(storage, keep);
  return saved;
}

/**
 * Whether this game's data offered any help at all.
 *
 * A template reports `hints` only when it did (see GameResultInput.hints):
 * game data generated before a template offered hints has none, and a 0
 * there would claim the child needed no help that was never available.
 */
export function offersHints(items: ReadonlyArray<{ hint?: unknown }> | undefined): boolean {
  return (items ?? []).some(i => typeof i?.hint === 'string' && i.hint.trim() !== '');
}
