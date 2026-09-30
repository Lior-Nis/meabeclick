// tests/unit/no-leaked-page-state.test.mjs
//
// A component that changes something outside itself — the body's overflow,
// an element moved onto <body> — undoes it when it goes away, whichever way
// it goes (close, navigation, back/forward). Two home-page leaks froze the
// pages after it (Todoist 6hfv9GRG6RvMw65q, 6hfv9ppwWp8G3w8q).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');

test('only the scroll-lock helper writes the body\'s overflow', () => {
  const hits = execSync(`git grep -l --untracked -E "body\\.style\\.overflow" -- src`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  assert.deepEqual(hits, ['src/lib/scroll-lock.ts']);
});

test('the sidebar and the booking sheet hold the lock only while open, released by the effect', () => {
  assert.match(read('src/lib/components/Header.svelte'), /\$effect\(\(\) => \{\s*if \(sidebarOpen\) return lockScroll\(\);\s*\}\);/);
  assert.match(read('src/routes/booking/+page.svelte'), /const unlock = lockScroll\(\);[\s\S]{0,400}return \(\) => \{\s*unlock\(\);/);
});

test('the home page puts its tutor popups back before it goes', () => {
  const landing = read('src/routes/+page.svelte');
  const cleanup = landing.slice(landing.indexOf('return () => {', landing.indexOf('dashObs.observe')));
  assert.match(cleanup.slice(0, 400), /closeAllPopups\(\);/);
});
