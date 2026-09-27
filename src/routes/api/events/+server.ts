/**
 * POST /api/events — the marketing funnel's public write path.
 *
 * Anonymous, internet-facing, and always answers 204 with an empty body:
 * a probe (a bot, a curl script trying field names) must learn nothing
 * from the status code about why its event was or wasn't stored. Every
 * filter below is therefore "silently drop" rather than "4xx" — the only
 * way this endpoint ever fails loudly is an unexpected exception, which
 * the outer try/catch turns into the same 204 everything else gets.
 *
 * Filters run cheapest-first, before the body is even read, so a flood of
 * bot or rate-limited traffic never reaches JSON.parse or the database:
 *   1. bot-like User-Agent
 *   2. the tutor's own admin session (must never pollute her own funnel)
 *   3. the in-memory per-IP rate limit, then the process-wide ceiling on
 *      top of it (both in events-rate-limit.ts)
 *   4. body size (2 KB)
 *   5. JSON validity and field shapes
 *   6. `lesson_scheduled` — server-only, written by /api/book right after
 *      a successful booking (guarded so a failure to record it never fails
 *      the booking itself — see that route's own comment); never accepted
 *      from a client.
 *
 * Field-shape validation reuses `recordEvent`'s own semantic rules
 * (unknown event name, a target on the wrong event, an unknown target)
 * rather than duplicating its EVENTS/TARGETS lists here — recordEvent
 * already returns false and writes nothing for any of those, so this
 * endpoint only adds the two checks recordEvent cannot make for itself:
 * that every field is a string or absent (recordEvent's own trimming
 * coerces anything else, e.g. an object becomes the string
 * "[object Object]", which is not a rejection this endpoint wants to let
 * through), and that a client can never claim `lesson_scheduled`.
 */
import { recordEvent, pruneEvents, sanitizePath, VISITOR_ID_RE } from '$server/marketing.ts';
import { singleton } from '$server/singleton.ts';
import { withinRateLimit, withinGlobalRateLimit } from '$server/events-rate-limit.ts';
import type { RequestHandler } from './$types';

const NO_CONTENT = () => new Response(null, { status: 204 });

const MAX_BODY_BYTES = 2048;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless/i;

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

// `singleton()` survives Vite HMR re-evaluating this module in dev. The
// per-IP rate limiter itself lives in $server/events-rate-limit.ts — split
// out because a +server.ts may only export HTTP method handlers (see that
// module's own doc comment) and its eviction sweep needed to stay directly
// unit-testable.
const pruneState = singleton('marketing-events-last-prune', () => ({ at: 0 }));

/** At most once per 24 hours per process — see pruneEvents' own doc
 *  comment for why the cutoff is 365 days. The gate is only advanced on a
 *  SUCCESSFUL prune: if pruneEvents throws, the next request retries
 *  immediately instead of the failure silently using up the whole 24h
 *  window. A prune failure must never take this endpoint down with it. */
function maybePrune(): void {
  if (Date.now() - pruneState.at < PRUNE_INTERVAL_MS) return;
  try {
    pruneEvents(new Date());
    pruneState.at = Date.now();
  } catch (err) {
    console.error('/api/events pruneEvents', err);
  }
}

const isStringOrAbsent = (v: unknown): boolean => v === undefined || v === null || typeof v === 'string';

/**
 * Picks the four UTM sub-fields out of an unvalidated `body.utm`.
 * Returns `undefined` when `utm` itself was absent (nothing to attach),
 * or `null` when `utm` is present but the wrong shape — present-but-not-an-
 * object, or any sub-field present but not a string — which the caller
 * treats as "reject the whole event", the same as any other field-shape
 * failure.
 */
function readUtm(raw: unknown): { source?: string; medium?: string; campaign?: string; content?: string } | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isStringOrAbsent(r.source) || !isStringOrAbsent(r.medium) || !isStringOrAbsent(r.campaign) || !isStringOrAbsent(r.content)) {
    return null;
  }
  const utm: { source?: string; medium?: string; campaign?: string; content?: string } = {};
  if (typeof r.source === 'string') utm.source = r.source;
  if (typeof r.medium === 'string') utm.medium = r.medium;
  if (typeof r.campaign === 'string') utm.campaign = r.campaign;
  if (typeof r.content === 'string') utm.content = r.content;
  return utm;
}

export const POST: RequestHandler = async ({ request, locals, getClientAddress }) => {
  try {
    const ua = request.headers.get('user-agent') ?? '';
    if (BOT_UA.test(ua)) return NO_CONTENT();

    // hooks.server.ts already computed this from the session cookie via
    // auth.ts's validToken/COOKIE_NAME — reusing it here avoids parsing
    // the cookie a second time.
    if (locals.authenticated) return NO_CONTENT();

    if (!withinRateLimit(getClientAddress())) return NO_CONTENT();
    // The per-IP limit alone cannot catch a flood spread across many IPs —
    // this is the process-wide backstop on top of it (events-rate-limit.ts).
    if (!withinGlobalRateLimit()) return NO_CONTENT();

    maybePrune();

    const text = await request.text();
    if (!text || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return NO_CONTENT();

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return NO_CONTENT();
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NO_CONTENT();
    const b = body as Record<string, unknown>;

    if (typeof b.event !== 'string') return NO_CONTENT();
    // Server-only — see this file's header comment.
    if (b.event === 'lesson_scheduled') return NO_CONTENT();

    if (!isStringOrAbsent(b.target) || !isStringOrAbsent(b.path) || !isStringOrAbsent(b.visitorId)) {
      return NO_CONTENT();
    }
    const utm = readUtm(b.utm);
    if (utm === null) return NO_CONTENT();

    // bookingId is never accepted from a client: it is set only by
    // /api/book, written after the booking succeeds, in its own try/catch —
    // see that route's own comment on the recordEvent(lesson_scheduled) call.
    recordEvent({
      event: b.event,
      target: typeof b.target === 'string' ? b.target : undefined,
      // Keeps only the part before `?`/`#` and requires a leading `/`;
      // anything else is dropped rather than stored (task 3 — see
      // marketing.ts's sanitizePath).
      path: sanitizePath(typeof b.path === 'string' ? b.path : undefined),
      // A visitorId that doesn't look like what initMarketing mints
      // (task 4 — see marketing.ts's VISITOR_ID_RE) is treated as absent,
      // not rejected outright — same tolerant posture as every other field.
      visitorId: (typeof b.visitorId === 'string' && VISITOR_ID_RE.test(b.visitorId)) ? b.visitorId : undefined,
      utm,
    });
  } catch (err) {
    console.error('/api/events', err);
  }
  return NO_CONTENT();
};
