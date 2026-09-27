import { test } from 'node:test';
import assert from 'node:assert/strict';

const { toHref } = await import('../../src/lib/urls.ts');

test('toHref leaves an already-absolute new-shape gameUrl() output untouched', () => {
  // What gameUrl() (src/lib/server/urls.ts) actually returns for a
  // new-shape {template,dataId} entry — already has a leading slash.
  const signed = '/app/play/memory?d=noga-integrals-memory&s=%D7%9C%D7%99%D7%96%D7%94&t=abc123';
  assert.equal(toHref(signed), signed);
});

test('toHref prepends the missing slash on a legacy old-shape url', () => {
  // What server/lesson-queue.mjs baked directly into portal/<code>.json and
  // the `lessons` table's `games` column before this migration — no
  // leading slash.
  assert.equal(
    toHref('games/memory.html?d=noga-integrals-memory&s=נוגה'),
    '/games/memory.html?d=noga-integrals-memory&s=נוגה',
  );
});

test('a raw legacy url resolves to two different real paths depending on which /app/* page renders it — the divergence toHref exists to prevent', () => {
  // Ruling P13's third failure mode: rendering a legacy url raw (no
  // toHref) from a page already under /app/* (e.g. /app/dashboard)
  // resolves it relative to that path instead of root — a real but
  // wrong, silently-broken link. This first assertion demonstrates the
  // bug directly: resolving the SAME raw stored value against two
  // different page bases lands on two different paths. (This is not
  // testable by resolving toHref's own output against two bases — once a
  // string starts with '/', URL resolution ignores the base path by
  // construction, so that would only restate `href.startsWith('/')` in a
  // roundabout way, proving nothing about the divergence itself.)
  const raw = 'games/memory.html?d=x';
  const fromDashboardRaw = new URL(raw, 'http://x/app/dashboard').pathname;
  const fromRootRaw = new URL(raw, 'http://x/').pathname;
  assert.notEqual(
    fromDashboardRaw, fromRootRaw,
    'expected the unfixed, raw legacy url to resolve differently by base — if this ever passes, toHref is no longer preventing anything',
  );

  // toHref fixes it: the same input now resolves identically everywhere.
  //
  // NOTE — this is NOT the regression guard for toHref itself: once a
  // string starts with '/', URL resolution ignores the base by
  // construction, so this equality holds for ANY root-absolute href,
  // correct or not — it can't detect toHref producing the wrong (but
  // still root-absolute) path. It only re-demonstrates, on toHref's
  // output, that the divergence shown above is gone. The second test in
  // this file ("prepends the missing slash on a legacy old-shape url") is
  // the actual regression guard — it pins toHref's exact output.
  const href = toHref(raw);
  assert.ok(href.startsWith('/'), `expected a root-absolute href, got ${href}`);
  assert.equal(
    new URL(href, 'http://x/app/dashboard').pathname,
    new URL(href, 'http://x/').pathname,
    'href must resolve identically regardless of which /app/* page renders it',
  );
});
