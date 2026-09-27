// tests/characterization/student-shell.test.mjs
//
// The student board is an app shell: a fixed bar of identity on top, a
// scrolling view, and a fixed navigation bar at the bottom.
//
// What it replaced, and why these assertions are worth having: the four
// sections used to be a horizontally-scrolling row of pills in the middle of
// the page, and on a 1080px phone the fourth — "שאלה", the question box —
// was CLIPPED AT THE SCREEN EDGE. A whole feature was invisible on the
// device the board is mostly used on, and nothing failed. The rule these
// pin is therefore not "the nav looks right" but "every destination is
// reachable without horizontal scrolling", which is the property that was
// actually broken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, familySession } from './harness.mjs';

const DESTINATIONS = ['בית', 'שיעורי בית', 'משחקים', 'שאלה'];

async function studentBoard(baseUrl, query = '') {
  const booked = await (await fetch(`${baseUrl}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'אלון', subject: 'מתמטיקה', level: 'כיתה יא',
      phone: '0501234567', email: 'orit@example.com', durationMin: 90,
      start: '2027-12-01T10:00:00+02:00', end: '2027-12-01T11:30:00+02:00',
    }),
  })).json();
  const parent = await familySession(booked.portal.link);
  const share = await (await fetch(`${baseUrl}/api/student-link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: parent },
    body: JSON.stringify({ code: booked.portal.code }),
  })).json();
  const child = await familySession(share.link);
  const res = await fetch(`${baseUrl}/app/student?s=${booked.portal.code}${query}`, {
    headers: { Cookie: child }, redirect: 'manual',
  });
  return { status: res.status, html: await res.text(), code: booked.portal.code };
}

/** HTML with comments removed.
 *
 *  Twice now an assertion has passed against this repo's own explanatory
 *  COMMENTS rather than its markup — the app.html note about viewport-fit
 *  contains the string "viewport-fit=cover", so a naive match on the page
 *  succeeded with the real meta tag deleted. Comments are served to the
 *  browser; strip them before asserting anything about the document. */
const withoutComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

const navOf = (html) => html.match(/<nav class="bottom-nav[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? '';

/** Concatenated contents of every stylesheet the page links. */
async function stylesheetsOf(baseUrl, html) {
  // Attribute order is not guaranteed — SvelteKit emits href before rel —
  // so match the tag first and pull href out of it.
  const hrefs = (html.match(/<link[^>]*rel="stylesheet"[^>]*>/g) ?? [])
    .map(tag => tag.match(/href="([^"]+)"/)?.[1])
    .filter(h => h && !h.startsWith('http'));
  const inline = (html.match(/<style[\s\S]*?<\/style>/g) ?? []).join('');
  const fetched = await Promise.all(hrefs.map(h => fetch(new URL(h, baseUrl)).then(r => r.text())));
  return inline + fetched.join('');
}

test('every section is a destination in the bottom nav', async () => {
  // THE regression test. Against the old pill row this passed for three
  // labels and quietly lost the fourth off the edge of a phone.
  const { baseUrl, stop } = await startServer();
  try {
    const { status, html } = await studentBoard(baseUrl);
    assert.equal(status, 200);

    const nav = navOf(html);
    assert.ok(nav, 'the board must render a bottom navigation');

    const labels = [...nav.matchAll(/<span class="nav-label[^"]*">([^<]+)</g)].map(m => m[1]);
    assert.deepEqual(labels, DESTINATIONS, 'every destination must be present, in order');
  } finally { await stop(); }
});

test('the nav cannot scroll a destination out of reach', async () => {
  // The old row was `display:flex; overflow-x:auto`, which is exactly how a
  // destination ends up off-screen. Equal grid fractions cannot.
  const { baseUrl, stop } = await startServer();
  try {
    const { html } = await studentBoard(baseUrl);
    assert.doesNotMatch(html, /class="tabs"/, 'the scrolling pill row must be gone');

    // The build serves CSS as a linked stylesheet, not inline, so the rules
    // have to be fetched rather than read off the page.
    const css = await stylesheetsOf(baseUrl, html);
    assert.match(css, /grid-auto-columns:\s*1fr/, 'destinations must share equal fractions');
    assert.match(css, /env\(safe-area-inset-bottom\)/,
      'the bar must clear the iPhone home indicator');
  } finally { await stop(); }
});

test('the document opts into the safe area it relies on', async () => {
  // env(safe-area-inset-*) resolves to 0 without viewport-fit=cover, so the
  // nav would sit under the home indicator with nothing failing.
  const { baseUrl, stop } = await startServer();
  try {
    const { html } = await studentBoard(baseUrl);
    // Asserted on the viewport meta specifically, not anywhere in the page.
    const viewport = withoutComments(html).match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    assert.match(viewport, /viewport-fit=cover/,
      `safe-area insets need viewport-fit=cover; viewport is "${viewport}"`);
  } finally { await stop(); }
});

test('exactly one theme-color, because only the first counts', async () => {
  // The spec uses the FIRST theme-color in tree order, and %sveltekit.head%
  // renders after app.html — so a second, per-page tag is silently dead.
  const { baseUrl, stop } = await startServer();
  try {
    const { html } = await studentBoard(baseUrl);
    const tags = withoutComments(html).match(/<meta name="theme-color"/g) ?? [];
    assert.equal(tags.length, 1, `found ${tags.length} theme-color tags; any after the first do nothing`);
  } finally { await stop(); }
});

test('the view is in the URL, so the back button works', async () => {
  // Without this a phone's back gesture leaves the board entirely instead of
  // returning to the previous section — the difference between tabs and
  // something that behaves like an app.
  const { baseUrl, stop } = await startServer();
  try {
    const { html, status } = await studentBoard(baseUrl, '&v=games');
    assert.equal(status, 200, '?v= must not trip the canonical-URL redirect');
    assert.ok(navOf(html), 'the nav still renders on a deep-linked view');
  } finally { await stop(); }
});

test('the nav and sign-out survive a board that fails to load', async () => {
  // Both are chrome, not content. A nav that appears only on success is one
  // a child cannot use to leave a broken screen — and the board's data is
  // fetched after mount, so the server-rendered page is ALWAYS the
  // pre-success state.
  const { baseUrl, stop } = await startServer();
  try {
    const { html } = await studentBoard(baseUrl);
    assert.ok(navOf(html), 'nav must render before the board has its data');
    assert.match(html, /יציאה/, 'sign-out must render before the board has its data');
    assert.match(html, /<header class="app-bar/, 'the app bar is chrome too');
  } finally { await stop(); }
});
