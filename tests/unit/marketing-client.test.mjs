// tests/unit/marketing-client.test.mjs
//
// The browser-side half of the marketing funnel: src/lib/marketing.ts.
// It must run with no $app import (it is loaded straight into the browser
// bundle, not through SvelteKit's module graph) and it must never let a
// storage or network failure become a thrown error — see this module's own
// doc comment for why (the site must behave exactly as it does today even
// when localStorage is disabled or a beacon fails).
//
// Node has no localStorage, so every test injects a fake StorageLike. Node
// DOES have a global `navigator` (with no sendBeacon), so track() always
// falls through to the fetch keepalive path here — which is convenient:
// tests intercept it by stubbing globalThis.fetch, exactly like a browser
// test would stub sendBeacon.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { initMarketing, track, attribution } = await import('../../src/lib/marketing.ts');

/** An in-memory StorageLike. `throwing: true` makes every call throw, to
 *  prove the module swallows storage failures rather than propagating
 *  them into a caller that never expected marketing to be able to break
 *  the page. */
function fakeStorage(initial = {}, { throwing = false } = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      if (throwing) throw new Error('storage disabled');
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      if (throwing) throw new Error('storage disabled');
      map.set(key, value);
    },
    _map: map,
  };
}

const urlWith = (query) => new URL(`https://meabeclick.com/?${query}`);

test('a fresh first touch is kept, not overwritten by a later visit with different UTM', () => {
  const storage = fakeStorage();
  initMarketing(urlWith('utm_source=fb&utm_campaign=promo'), storage);
  const stored = JSON.parse(storage._map.get('mb_first_touch'));
  assert.equal(stored.utm.source, 'fb');

  // Second visit, same session, different campaign link — first touch wins.
  initMarketing(urlWith('utm_source=google&utm_campaign=other'), storage);
  const after = JSON.parse(storage._map.get('mb_first_touch'));
  assert.equal(after.utm.source, 'fb', 'the original first touch must survive a second, fresher visit');
  assert.equal(after.utm.campaign, 'promo');
});

test('a first touch older than 30 days is replaced by the current visit', () => {
  const THIRTY_ONE_DAYS_AGO = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const storage = fakeStorage({
    mb_first_touch: JSON.stringify({ utm: { source: 'old-source' }, at: THIRTY_ONE_DAYS_AGO }),
    mb_visitor: 'existing-visitor-id',
  });

  initMarketing(urlWith('utm_source=new-source&utm_medium=cpc'), storage);

  const after = JSON.parse(storage._map.get('mb_first_touch'));
  assert.equal(after.utm.source, 'new-source', 'a stale first touch must be replaced');
  assert.equal(after.utm.medium, 'cpc');
  // The visitor id is a separate, permanent identity and must not be reset
  // just because attribution reset.
  assert.equal(storage._map.get('mb_visitor'), 'existing-visitor-id');
});

test('initMarketing creates a visitor id when none exists, and leaves an existing one alone', () => {
  const storage = fakeStorage();
  initMarketing(urlWith(''), storage);
  const first = storage._map.get('mb_visitor');
  assert.ok(first && first.length > 0, 'a visitor id must be created');

  initMarketing(urlWith('utm_source=x'), storage);
  assert.equal(storage._map.get('mb_visitor'), first, 'an existing visitor id must never be replaced');
});

test('a storage that throws on every call does not throw out of initMarketing, track, or attribution', async () => {
  const storage = fakeStorage({}, { throwing: true });

  assert.doesNotThrow(() => initMarketing(urlWith('utm_source=x'), storage));
  assert.doesNotThrow(() => attribution(storage));

  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network should never be reached, but must not matter'); };
  try {
    assert.doesNotThrow(() => track('cta_click', { target: 'whatsapp' }, storage));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('attribution() returns null when nothing has been stored yet', () => {
  const storage = fakeStorage();
  assert.equal(attribution(storage), null);
});

test('attribution() returns the stored first-touch utm and visitor id', () => {
  const storage = fakeStorage();
  initMarketing(urlWith('utm_source=fb&utm_medium=cpc&utm_campaign=promo&utm_content=ad1'), storage);

  const attrib = attribution(storage);
  assert.ok(attrib);
  assert.equal(attrib.visitorId, storage._map.get('mb_visitor'));
  assert.deepEqual(attrib.utm, { source: 'fb', medium: 'cpc', campaign: 'promo', content: 'ad1' });
});

// ── The controller's decision under test ──────────────────────────────
//
// funnel() (src/lib/server/marketing.ts, task 1) groups every event by
// that ROW's own UTM columns — it does not look up a visitor's first
// touch from any other row. So track() must attach the stored first-touch
// utm + visitorId to EVERY event it sends, not only landing_visit, or a
// cta_click fired on page 2 of a session would fall into the "direct /
// untagged" bucket even though this visitor arrived via a campaign link.

test('track() attaches the stored first-touch utm and visitorId to a non-landing_visit event', async () => {
  const storage = fakeStorage();
  initMarketing(urlWith('utm_source=fb&utm_campaign=promo'), storage);

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  try {
    track('cta_click', { target: 'whatsapp' }, storage);
    // fetch is fire-and-forget from track()'s perspective; give its
    // microtask a tick before asserting.
    await Promise.resolve();
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/events');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event, 'cta_click');
  assert.equal(body.target, 'whatsapp');
  assert.equal(body.utm.source, 'fb', 'the stored first-touch utm must ride along on every event, not only landing_visit');
  assert.equal(body.utm.campaign, 'promo');
  assert.equal(body.visitorId, storage._map.get('mb_visitor'));
});

test('track() still sends (with no attribution) when nothing has been stored', async () => {
  const storage = fakeStorage();

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => { calls.push({ url, init }); return Promise.resolve(new Response(null, { status: 204 })); };
  try {
    track('landing_visit', {}, storage);
    await Promise.resolve();
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.event, 'landing_visit');
  assert.equal(body.utm, undefined);
  assert.equal(body.visitorId, undefined);
});

test('a fetch failure inside track() is swallowed', async () => {
  const storage = fakeStorage();
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('offline'));
  try {
    assert.doesNotThrow(() => track('cta_click', { target: 'phone' }, storage));
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    globalThis.fetch = realFetch;
  }
});
