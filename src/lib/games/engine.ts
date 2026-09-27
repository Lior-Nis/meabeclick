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
  shuffle: typeof shuffle;
  fmt: typeof fmt;
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

/**
 * Fire-and-forget: a storage hiccup must never make a finished game look
 * broken to the student. `t` (the signature minted by src/lib/server/
 * urls.ts's gameUrl()) travels in the payload so /api/game-result can
 * verify this result actually belongs to a legitimately issued assignment
 * — games/game.js's version predates that check and never sent it.
 */
export function reportResult(payload: Record<string, unknown>): void {
  fetch('/api/game-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
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
