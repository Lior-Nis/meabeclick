// tests/characterization/no-template-leak.test.mjs
//
// No page may serve build-template syntax to a browser.
//
// The unit test beside this one guards src/app.html specifically. This one
// guards the OUTCOME, on real rendered pages, because the failure it comes
// from was invisible everywhere else: a comment in app.html mentioned
// `%sveltekit.head%`, the build substituted that occurrence instead of the
// real one, Svelte's `-->` markers closed the comment early, and the tail of
// an English sentence rendered above the header on every page of the live
// site — while the literal string "%sveltekit.head%" was served where the
// head injection should have been.
//
// The build passed. svelte-check passed. Every other characterization test
// passed, because they all assert on markup in the body and the damage was
// in the head. Only looking at what a browser actually receives finds this.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';

/** Public pages, plus one behind a guard to prove the layout is clean too. */
const PAGES = ['/', '/booking', '/portal', '/login'];

test('no page serves a SvelteKit placeholder to the browser', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    for (const path of PAGES) {
      const html = await (await fetch(`${baseUrl}${path}`)).text();
      assert.doesNotMatch(html, /%sveltekit\./,
        `${path} served a literal build placeholder — the head injection point was consumed elsewhere`);
    }
  } finally { await stop(); }
});

test('the head is intact: one title, and the app CSS is linked', async () => {
  // The placeholder bug did not merely add junk text — it moved the entire
  // injected head inside a broken comment, so titles and stylesheets landed
  // where the browser would not use them. Asserting the head still WORKS is
  // what distinguishes "no stray text" from "actually fixed".
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const head = html.slice(0, html.indexOf('</head>'));

    assert.match(head, /<title>/, 'the page title must be injected into the head');
    assert.match(head, /rel="stylesheet"/, 'the app stylesheets must be linked from the head');
    // Checked per-comment, not with one greedy span: `[\s\S]*` across the
    // whole head matches from an earlier comment to a later terminator and
    // "fails" on a perfectly good document.
    for (const comment of head.match(/<!--[\s\S]*?-->/g) ?? []) {
      assert.doesNotMatch(comment, /rel="stylesheet"|<title>/,
        `injected head content is sitting inside a comment:\n${comment.slice(0, 200)}`);
    }
  } finally { await stop(); }
});

test('no page leaks an unclosed comment above the app', async () => {
  // The visible symptom: prose from a source comment rendering as page text.
  // Counting delimiters catches a comment that was terminated early by
  // something substituted into it.
  const { baseUrl, stop } = await startServer();
  try {
    for (const path of PAGES) {
      const html = await (await fetch(`${baseUrl}${path}`)).text();
      const opens = (html.match(/<!--/g) ?? []).length;
      const closes = (html.match(/-->/g) ?? []).length;
      assert.equal(opens, closes, `${path} has ${opens} comment openers and ${closes} closers`);
    }
  } finally { await stop(); }
});
