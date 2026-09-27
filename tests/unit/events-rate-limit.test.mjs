// tests/unit/events-rate-limit.test.mjs
//
// The in-memory, per-IP rate limiter behind POST /api/events
// (src/lib/server/events-rate-limit.ts). On a public, internet-facing
// endpoint an IP that visits once — or an attacker rotating IPs on
// purpose — must not be able to grow the `hits` map without bound.
// `sweepStaleRateLimitEntries` is the pure function that bounds it; it's
// exported specifically so this can assert on eviction directly, with a
// fixed `now`, instead of needing a real 10-minute wait or a running
// server.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  sweepStaleRateLimitEntries, withinRateLimit, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  withinGlobalRateLimit, GLOBAL_RATE_LIMIT_MAX, GLOBAL_RATE_LIMIT_WINDOW_MS,
} = await import('../../src/lib/server/events-rate-limit.ts');

const NOW = Date.parse('2027-01-01T00:00:00.000Z');

test('an IP whose hits are all outside the window is evicted entirely', () => {
  const map = new Map([
    ['1.2.3.4', [NOW - RATE_LIMIT_WINDOW_MS - 1000]], // one hit, just past the window
    ['5.6.7.8', [NOW - 60_000]],                       // one hit, well inside the window
  ]);

  sweepStaleRateLimitEntries(map, NOW, RATE_LIMIT_WINDOW_MS);

  assert.equal(map.has('1.2.3.4'), false, 'a fully-stale IP must be dropped, not kept as an empty array');
  assert.equal(map.has('5.6.7.8'), true, 'an IP with a fresh hit must survive the sweep');
});

test('an IP with a mix of stale and fresh hits keeps only the fresh ones', () => {
  const map = new Map([
    ['9.9.9.9', [NOW - RATE_LIMIT_WINDOW_MS - 1000, NOW - 60_000, NOW - 1000]],
  ]);

  sweepStaleRateLimitEntries(map, NOW, RATE_LIMIT_WINDOW_MS);

  assert.deepEqual(map.get('9.9.9.9'), [NOW - 60_000, NOW - 1000]);
});

test('a map with no stale entries is left untouched', () => {
  const map = new Map([['1.1.1.1', [NOW - 1000]]]);
  sweepStaleRateLimitEntries(map, NOW, RATE_LIMIT_WINDOW_MS);
  assert.deepEqual(map.get('1.1.1.1'), [NOW - 1000]);
  assert.equal(map.size, 1);
});

test('many one-off IPs are all evicted, proving the map does not grow without bound', () => {
  const map = new Map();
  for (let i = 0; i < 500; i++) {
    map.set(`10.0.0.${i}`, [NOW - RATE_LIMIT_WINDOW_MS - 1000]);
  }
  assert.equal(map.size, 500);

  sweepStaleRateLimitEntries(map, NOW, RATE_LIMIT_WINDOW_MS);

  assert.equal(map.size, 0, 'every fully-stale IP must be gone after the sweep');
});

// ── withinRateLimit itself, end to end over the shared singleton map ──

test('withinRateLimit allows up to RATE_LIMIT_MAX hits, then refuses the next one, in the same window', () => {
  const ip = `unit-test-ip-${Math.random()}`; // unique per run — the map is a shared singleton
  const base = Date.parse('2028-01-01T00:00:00.000Z');
  for (let i = 0; i < RATE_LIMIT_MAX; i++) {
    assert.equal(withinRateLimit(ip, base + i), true, `hit ${i + 1} must be allowed`);
  }
  assert.equal(withinRateLimit(ip, base + RATE_LIMIT_MAX), false, 'the hit past the limit must be refused');
});

test('withinRateLimit allows a fresh hit again once the earlier ones have aged out of the window', () => {
  const ip = `unit-test-ip-${Math.random()}`;
  const base = Date.parse('2029-01-01T00:00:00.000Z');
  for (let i = 0; i < RATE_LIMIT_MAX; i++) withinRateLimit(ip, base + i);
  assert.equal(withinRateLimit(ip, base + RATE_LIMIT_MAX), false);

  const wellPastTheWindow = base + RATE_LIMIT_WINDOW_MS + 1;
  assert.equal(withinRateLimit(ip, wellPastTheWindow), true, 'a new window must not still be refusing this IP');
});

// ── withinGlobalRateLimit — the process-wide ceiling on top of the per-IP
// one above, so an attacker spreading requests across many IPs (each well
// under RATE_LIMIT_MAX) still cannot flood the endpoint. Uses bases far from
// any other test's window (and far from each other) since this counter is a
// single shared singleton, unlike the per-IP map keyed on a unique test IP. ──

test('withinGlobalRateLimit allows up to GLOBAL_RATE_LIMIT_MAX hits, then refuses the next one, in the same window', () => {
  const base = Date.parse('2030-01-01T00:00:00.000Z');
  for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i++) {
    assert.equal(withinGlobalRateLimit(base + i), true, `hit ${i + 1} must be allowed`);
  }
  assert.equal(withinGlobalRateLimit(base + GLOBAL_RATE_LIMIT_MAX), false,
    'the hit past the global ceiling must be refused, even though no single IP is over its own limit');
});

test('withinGlobalRateLimit allows a fresh hit again once the earlier ones have aged out of the window', () => {
  const base = Date.parse('2031-01-01T00:00:00.000Z');
  for (let i = 0; i < GLOBAL_RATE_LIMIT_MAX; i++) withinGlobalRateLimit(base + i);
  assert.equal(withinGlobalRateLimit(base + GLOBAL_RATE_LIMIT_MAX), false);

  const wellPastTheWindow = base + GLOBAL_RATE_LIMIT_WINDOW_MS + 1;
  assert.equal(withinGlobalRateLimit(wellPastTheWindow), true, 'a new window must not still be refusing traffic globally');
});
