/**
 * The marketing funnel's browser half: first-touch attribution and event
 * tracking. Runs in the browser, imported directly into page bundles — no
 * `$app` import, so it can be unit-tested under plain `node --test` (see
 * tests/unit/marketing-client.test.mjs) with no SvelteKit runtime at all.
 *
 * Everything here MUST swallow its own failures. This is measurement, not
 * the product: a disabled localStorage, a blocked beacon, or an offline
 * network must make the site behave exactly as it does with none of this
 * code present, never surface an error to a caller that never expected
 * tracking to be able to break a page load or a click handler.
 *
 * `storage` is an explicit last parameter on every exported function
 * (defaulting to the real `localStorage`) purely so the unit test can hand
 * in a fake and a throwing one — there is no other consumer of that
 * indirection.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
}

export interface Attribution {
  utm: Utm;
  visitorId: string;
}

const FIRST_TOUCH_KEY = 'mb_first_touch';
const VISITOR_KEY = 'mb_visitor';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const EVENTS_URL = '/api/events';

interface StoredFirstTouch {
  utm: Utm;
  at: string;
}

/** The real localStorage when one exists (a browser), or null during SSR
 *  or in a test — every caller already treats a null storage as "nothing
 *  stored, nothing to do", so there is no separate SSR branch to maintain. */
function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some browsers throw on the mere reference (privacy mode, disabled
    // storage) rather than returning undefined.
    return null;
  }
}

function readFirstTouch(storage: StorageLike): StoredFirstTouch | null {
  try {
    const raw = storage.getItem(FIRST_TOUCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.at !== 'string') return null;
    return parsed as StoredFirstTouch;
  } catch {
    return null;
  }
}

function isStale(at: string): boolean {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return true;
  return Date.now() - t > THIRTY_DAYS_MS;
}

function utmFromUrl(url: URL): Utm {
  const p = url.searchParams;
  const utm: Utm = {};
  const source = p.get('utm_source');
  const medium = p.get('utm_medium');
  const campaign = p.get('utm_campaign');
  const content = p.get('utm_content');
  if (source) utm.source = source;
  if (medium) utm.medium = medium;
  if (campaign) utm.campaign = campaign;
  if (content) utm.content = content;
  return utm;
}

/**
 * Stores the first touch (this URL's `utm_*` plus "now") if none is stored
 * yet, or the stored one is older than 30 days — otherwise the existing
 * first touch is kept untouched, even if this visit carries different UTM
 * values (that is the entire point of "first" touch). Also creates a
 * visitor id (`crypto.randomUUID()`) if one doesn't exist yet; an existing
 * visitor id is never replaced, since it is a separate, permanent identity
 * that must survive attribution resetting after 30 days.
 *
 * Call once per page load, before any `track()` call on that page.
 */
export function initMarketing(url: URL, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const existing = readFirstTouch(storage);
    if (!existing || isStale(existing.at)) {
      const fresh: StoredFirstTouch = { utm: utmFromUrl(url), at: new Date().toISOString() };
      storage.setItem(FIRST_TOUCH_KEY, JSON.stringify(fresh));
    }
  } catch {
    // Storage disabled or full — the site must work exactly as if this
    // module were never called.
  }

  try {
    if (!storage.getItem(VISITOR_KEY)) {
      storage.setItem(VISITOR_KEY, crypto.randomUUID());
    }
  } catch {
    // Same tolerance as above.
  }
}

/** The stored first-touch UTM and visitor id, or null when nothing has
 *  been stored yet (storage disabled, or `initMarketing` never ran). */
export function attribution(storage: StorageLike | null = defaultStorage()): Attribution | null {
  if (!storage) return null;
  try {
    const firstTouch = readFirstTouch(storage);
    const visitorId = storage.getItem(VISITOR_KEY);
    if (!firstTouch || !visitorId) return null;
    return { utm: firstTouch.utm, visitorId };
  } catch {
    return null;
  }
}

/**
 * Sends one event to `POST /api/events`. The stored first-touch
 * attribution (utm + visitorId) is attached to EVERY event, not only
 * `landing_visit` — `funnel()` (src/lib/server/marketing.ts) groups each
 * event row by that row's own UTM columns, so a `cta_click` fired later in
 * the same session must carry the same attribution the landing visit did,
 * or it falls into the "direct / untagged" bucket by mistake.
 *
 * Prefers `navigator.sendBeacon` (survives the page unloading, e.g. a
 * WhatsApp or tel: link navigating away right after the click) and falls
 * back to a keepalive `fetch` when sendBeacon is unavailable or refuses
 * the payload. Every failure — a throwing storage, a beacon that returns
 * false, a rejected fetch — is swallowed; this function never throws and
 * its caller never needs to catch anything.
 */
export function track(
  event: string,
  extra: Record<string, unknown> = {},
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    const attrib = attribution(storage);
    const body: Record<string, unknown> = {
      ...extra,
      event,
      ...(attrib ? { utm: attrib.utm, visitorId: attrib.visitorId } : {}),
    };
    const payload = JSON.stringify(body);

    let sent = false;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        sent = navigator.sendBeacon(EVENTS_URL, new Blob([payload], { type: 'application/json' }));
      }
    } catch {
      sent = false;
    }

    if (!sent && typeof fetch === 'function') {
      fetch(EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Measurement must never be able to break the click/navigation it was
    // attached to.
  }
}
