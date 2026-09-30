// tests/unit/scroll-lock.test.mjs
//
// One scroll lock for every overlay (Todoist 6hfv9GRG6RvMw65q, 6hfv9ppwWp8G3w8q).
// The header's sidebar set `body.style.overflow = 'hidden'` from an effect
// with no cleanup, so following one of its links while it was open carried
// the lock into the tutor dashboard, the portal, and every page after: the
// page would not scroll until a reload.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { lockScroll } = await import('../../src/lib/scroll-lock.ts');
const page = (overflow = '') => ({ style: { overflow } });

test('a lock stops the page scrolling, and its release gives back what was there', () => {
  const body = page('auto');
  const release = lockScroll(body);
  assert.equal(body.style.overflow, 'hidden');
  release();
  assert.equal(body.style.overflow, 'auto');
});

test('two overlays: the page scrolls again only when both are gone', () => {
  const body = page();
  const a = lockScroll(body);
  const b = lockScroll(body);
  a();
  assert.equal(body.style.overflow, 'hidden', 'the second overlay is still open');
  b();
  assert.equal(body.style.overflow, '');
});

test('releasing twice cannot release someone else\'s lock', () => {
  const body = page();
  const a = lockScroll(body);
  const b = lockScroll(body);
  a();
  a();
  assert.equal(body.style.overflow, 'hidden');
  b();
  assert.equal(body.style.overflow, '');
});

test('a release after a lock that found the page already locked still ends unlocked', () => {
  // The leak itself: a page that inherited 'hidden' from a dead component.
  // The lock owns the style while held, and on the last release sets it
  // back to what it found only when that was not its own 'hidden'.
  const body = page('hidden');
  const r = lockScroll(body);
  r();
  assert.equal(body.style.overflow, '');
});
