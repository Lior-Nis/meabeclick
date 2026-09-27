// tests/unit/brand-tokens.test.mjs
//
// A generated deck must keep looking like the site.
//
// A deck is a stand-alone HTML file, so it cannot import tokens.css and its
// palette has to be written into the document. That made it a hand-copy of
// the site's tokens under different names — `--brand` for `--accent`,
// `--cta` for `--accent2`, `--mint` for `--accent3`.
//
// Every value agreed when I checked. Nothing kept them agreeing, and
// Todoist id:6hRhqRXHcGj9m98H is about precisely that: a new generation
// inventing a different visual language because the guidance and the site
// drifted apart.
//
// So this test is the thing that keeps them together. It is deliberately
// not a snapshot of the deck's CSS — a snapshot would pass by being
// updated. It compares the two sources against each other, so changing one
// without the other fails, whichever one you change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECK_PALETTE, DECK_TOKEN_SOURCE, DECK_FONT, deckRootCss } from '../../src/lib/brand.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokensCss = readFileSync(join(ROOT, 'src/lib/styles/tokens.css'), 'utf8');

/** The value of a custom property as tokens.css declares it. */
function token(name) {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokensCss);
  return m ? m[1].trim().toLowerCase() : null;
}

test('every deck colour equals the site token it mirrors', () => {
  for (const [deckVar, tokenName] of Object.entries(DECK_TOKEN_SOURCE)) {
    const want = token(tokenName);
    assert.ok(want, `tokens.css has no ${tokenName} — the mapping is stale`);
    assert.equal(
      DECK_PALETTE[deckVar].toLowerCase(), want,
      `--${deckVar} in a deck is ${DECK_PALETTE[deckVar]} but the site's ${tokenName} is ${want}`,
    );
  }
});

test('the mapping covers every colour a deck declares', () => {
  // A new deck variable with no token behind it is a colour invented for
  // decks, which is the thing this task exists to prevent.
  assert.deepEqual(
    Object.keys(DECK_PALETTE).sort(),
    Object.keys(DECK_TOKEN_SOURCE).sort(),
  );
});

test('the deck uses the site type face', () => {
  assert.match(tokensCss, /Heebo/);
  assert.match(DECK_FONT, /Heebo/);
});

test('the rendered root block carries every value', () => {
  const css = deckRootCss();
  for (const [k, v] of Object.entries(DECK_PALETTE)) {
    assert.match(css, new RegExp(`--${k}:${v}`), `${k} missing from the deck's :root`);
  }
});

test('the slide renderer builds its palette from this module, not a literal', () => {
  // Anchored on the absence of the old hardcoded block: a second copy
  // reintroduced anywhere is what this whole file is guarding against.
  const prep = readFileSync(join(ROOT, 'src/lib/server/lesson/prep.ts'), 'utf8');
  assert.doesNotMatch(prep, /:root\{--bg:#/i, 'the palette must not be written inline again');
  assert.match(prep, /deckRootCss\(\)/, 'it must come from $lib/brand.ts');
});
