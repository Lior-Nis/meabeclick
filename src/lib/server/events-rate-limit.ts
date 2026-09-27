/**
 * The in-memory, per-IP rate limiter for `POST /api/events`
 * (src/routes/api/events/+server.ts), split into its own module for one
 * reason: a SvelteKit `+server.ts` may only export the HTTP method
 * handlers and a short allow-list of framework hooks (`GET`, `POST`,
 * `entries`, `config`, ...) — `npm run build` fails outright
 * ("Invalid export 'sweepStaleRateLimitEntries'") if anything else is
 * exported from one. The sweep below needs to be a plain, directly
 * testable function (tests/unit/events-rate-limit.test.mjs hands it a
 * `Map` and a fixed `now` and asserts on eviction), so it lives here
 * instead.
 *
 * The IP itself is held in memory only and never written anywhere — see
 * migration 016's doc comment on what marketing_events can never hold.
 *
 * Unbounded growth: every IP that ever calls this public, internet-facing
 * endpoint gets a key in `hits` — including one that visits once and never
 * returns, or one an attacker rotates on purpose specifically to grow this
 * map. Two things keep it bounded: every call drops its own key the moment
 * its hits have all aged out of the window (`freshHits`), and a periodic
 * sweep (`maybeSweep`, gated the same way `/api/events`' own
 * `maybePrune` is) walks the whole map and drops every OTHER key whose
 * hits have all aged out too, so an IP that stops calling entirely doesn't
 * sit here forever.
 */
import { singleton } from './singleton.ts';

export const RATE_LIMIT_MAX = 60;
export const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

// A process-wide ceiling on top of the per-IP one above: the per-IP limit
// alone cannot stop a flood spread across many IPs, each comfortably under
// RATE_LIMIT_MAX on its own — a rotating-IP attacker, or a botnet, being the
// exact case each single IP's own count never catches.
export const GLOBAL_RATE_LIMIT_MAX = 2000;
export const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Sweeping on the same span as the rate-limit window means a key can live
// at most one extra window past its last hit before this drops it — no
// separate constant to keep in sync with RATE_LIMIT_WINDOW_MS.
const RATE_SWEEP_INTERVAL_MS = RATE_LIMIT_WINDOW_MS;

// `singleton()` survives Vite HMR re-evaluating this module in dev,
// matching the same pattern in api/ask/+server.ts's own rate limiter.
const hits = singleton('marketing-events-rate', () => new Map<string, number[]>());
const sweepState = singleton('marketing-events-rate-sweep', () => ({ at: 0 }));

/**
 * Drops every entry in `map` whose recorded hits are now entirely outside
 * the rate-limit window, and trims the rest down to just their fresh hits.
 * A pure function of its arguments (no singleton, no `Date.now()` read
 * internally) so the unit test can hand it a map and a fixed `now` and
 * assert on eviction directly, without waiting on a real clock or spinning
 * up a server.
 */
export function sweepStaleRateLimitEntries(
  map: Map<string, number[]>,
  now: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): void {
  const windowStart = now - windowMs;
  for (const [ip, times] of map) {
    const fresh = times.filter(t => t >= windowStart);
    if (fresh.length === 0) map.delete(ip);
    else if (fresh.length !== times.length) map.set(ip, fresh);
  }
}

/** This IP's hits still inside the window. An entry whose hits have all
 *  aged out is deleted rather than left behind as an empty array, so a
 *  one-off visitor's key doesn't linger between sweeps. */
function freshHits(ip: string, now: number): number[] {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const times = (hits.get(ip) ?? []).filter(t => t >= windowStart);
  if (times.length === 0) hits.delete(ip);
  else hits.set(ip, times);
  return times;
}

/** At most once per RATE_SWEEP_INTERVAL_MS per process — gated the same
 *  way `/api/events`' own `maybePrune` is, so a busy endpoint doesn't pay
 *  for a full walk of the map on every single request. */
function maybeSweep(now: number): void {
  if (now - sweepState.at < RATE_SWEEP_INTERVAL_MS) return;
  sweepState.at = now;
  sweepStaleRateLimitEntries(hits, now);
}

/** Returns false once this IP has reached RATE_LIMIT_MAX events inside the
 *  trailing RATE_LIMIT_WINDOW_MS; otherwise records this hit and returns
 *  true. `now` defaults to `Date.now()` — overridable only so a test could
 *  control it without waiting on a real clock, the same reason `at` is a
 *  parameter on marketing.ts's `recordEvent`. */
export function withinRateLimit(ip: string, now: number = Date.now()): boolean {
  maybeSweep(now);
  const times = freshHits(ip, now);
  if (times.length >= RATE_LIMIT_MAX) return false;
  times.push(now);
  hits.set(ip, times);
  return true;
}

// One shared counter, in the same shape `hits` uses per IP — a single
// timestamp array behind a singleton, so it survives Vite HMR the same way.
// Capped at GLOBAL_RATE_LIMIT_MAX entries by construction (a call past the
// ceiling is refused before it ever pushes), so unlike `hits` this needs no
// separate sweep to stay bounded.
const globalHits = singleton('marketing-events-rate-global', () => ({ times: [] as number[] }));

/** Returns false once the whole process has recorded GLOBAL_RATE_LIMIT_MAX
 *  events inside the trailing GLOBAL_RATE_LIMIT_WINDOW_MS; otherwise records
 *  this hit and returns true. Same "keep only hits still inside the window,
 *  then check and record" shape as withinRateLimit above, just over one
 *  counter instead of one per IP — see withinRateLimit for why `now` is a
 *  parameter. Called in addition to, not instead of, withinRateLimit: a
 *  request must pass BOTH the per-IP and the global ceiling. */
export function withinGlobalRateLimit(now: number = Date.now()): boolean {
  const windowStart = now - GLOBAL_RATE_LIMIT_WINDOW_MS;
  const times = globalHits.times.filter(t => t >= windowStart);
  if (times.length >= GLOBAL_RATE_LIMIT_MAX) {
    globalHits.times = times;
    return false;
  }
  times.push(now);
  globalHits.times = times;
  return true;
}
