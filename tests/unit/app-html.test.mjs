// src/app.html is a template, and the build substitutes into it blindly.
//
// This exists because of a bug that reached production. A comment in
// app.html mentioned `%sveltekit.head%` while explaining a rule about the
// head — and the build substitutes the FIRST occurrence anywhere in the
// file, comments included. So:
//
//   1. the real head content was injected INTO the comment;
//   2. Svelte's own `-->` markers inside that content closed the comment
//      early, spilling the rest of the sentence into the page as visible
//      text above the header, on every page of the live site;
//   3. the actual placeholder further down was never substituted and was
//      served to browsers as the literal string "%sveltekit.head%".
//
// Titles and meta tags were landing inside a broken comment. Nothing failed:
// the build passed, svelte-check passed, the test suite passed, and every
// characterization test still found the markup it was looking for, because
// the damage was in the document head rather than the body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const appHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/app.html'),
  'utf8',
);

const PLACEHOLDERS = ['%sveltekit.head%', '%sveltekit.body%'];

test('each placeholder appears exactly once', () => {
  // More than one and the build fills the wrong occurrence; none and the
  // page ships with no head or no app at all.
  for (const p of PLACEHOLDERS) {
    const n = appHtml.split(p).length - 1;
    assert.equal(n, 1, `${p} appears ${n} times; it must appear exactly once`);
  }
});

test('no comment mentions a placeholder', () => {
  // THE regression test. A placeholder inside a comment is indistinguishable
  // from the real one to the build, and consuming it breaks the document in
  // a way no other check notices.
  const comments = appHtml.match(/<!--[\s\S]*?-->/g) ?? [];
  for (const c of comments) {
    assert.doesNotMatch(c, /%sveltekit\./,
      `a comment in app.html names a SvelteKit placeholder:\n${c}\n\n` +
      'The build substitutes the first match anywhere in the file, comments included.');
  }
});

test('no comment can be closed early by injected content', () => {
  // The other half of the failure: the injected head carries Svelte's own
  // `-->` markers, so anything substituted inside a comment terminates it
  // and dumps the remainder into the page. Belt and braces with the rule
  // above — a comment holding any `<` or `%` template syntax is suspect.
  const comments = appHtml.match(/<!--[\s\S]*?-->/g) ?? [];
  for (const c of comments) {
    assert.doesNotMatch(c.slice(4, -3), /-->/, 'nested comment terminator');
  }
});

test('the placeholders are where the document needs them', () => {
  const head = appHtml.indexOf('%sveltekit.head%');
  const body = appHtml.indexOf('%sveltekit.body%');
  const headClose = appHtml.indexOf('</head>');
  const bodyOpen = appHtml.indexOf('<body');
  assert.ok(head !== -1 && head < headClose, 'head placeholder must be inside <head>');
  assert.ok(body !== -1 && body > bodyOpen, 'body placeholder must be inside <body>');
});
