// The design tokens promise certain contrast ratios, and the site is used
// by parents on phones in daylight and by 13-year-olds, so those promises
// are functional requirements (PRODUCT.md, "Accessibility & Inclusion").
//
// This reads tokens.css and checks the numbers themselves, so a future
// "let's warm the orange up a bit" cannot quietly drop the peach accent's
// text variant under WCAG AA again — which is exactly how #fa8231 ended up
// as body text at 2.5:1 on the live site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/styles/tokens.css'),
  'utf8',
);

/** The hex value a token is set to in :root, or undefined if absent. */
function token(name) {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  return m?.[1];
}

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const chan = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(1) + 0.7152 * chan(3) + 0.0722 * chan(5);
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` composited over opaque `bg`, as #rrggbb. */
function over(fg, alpha, bg) {
  const mix = (i) => Math.round(
    alpha * parseInt(fg.slice(i, i + 2), 16) + (1 - alpha) * parseInt(bg.slice(i, i + 2), 16),
  );
  return '#' + [1, 3, 5].map(i => mix(i).toString(16).padStart(2, '0')).join('');
}

const AA_TEXT = 4.5;
const AA_UI = 3;

test('the peach accent has a strong variant for text, borders and focus rings', () => {
  assert.ok(token('accent2-strong'), '--accent2-strong is missing from tokens.css');
});

test('the strong peach clears AA as small text on every light ground it sits on', () => {
  const strong = token('accent2-strong');
  const peach = token('accent2');
  const grounds = {
    'white (cards)': token('bg-card'),
    'page background': token('bg-base'),
    'blue surface': token('bg-surface'),
    // --accent2-dim is the peach at 10% over whatever is beneath it. The
    // landing page's section labels put that wash on the blue surface,
    // which is the darkest ground any orange text actually sits on — the
    // Playwright audit found it at 4.37:1 with a token that cleared every
    // other ground here.
    'peach wash on page background': over(peach, 0.10, token('bg-base')),
    'peach wash on blue surface': over(peach, 0.10, token('bg-surface')),
  };
  for (const [name, ground] of Object.entries(grounds)) {
    const ratio = contrast(strong, ground);
    assert.ok(ratio >= AA_TEXT, `${strong} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});

test('the strong peach is a visible boundary against white', () => {
  const ratio = contrast(token('accent2-strong'), token('bg-card'));
  assert.ok(ratio >= AA_UI, `border/focus contrast is ${ratio.toFixed(2)}:1, needs ${AA_UI}:1`);
});

test('button text on the peach fill still clears AA', () => {
  const ratio = contrast(token('btn-text'), token('accent2'));
  assert.ok(ratio >= AA_TEXT, `--btn-text on --accent2 is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
});

test('the peach fill itself is documented as unfit for text', () => {
  // Not a contrast assertion — a guard that the token comment still tells
  // the next reader why --accent2-strong exists, so the rule travels with
  // the value.
  assert.match(css, /--accent2-strong:[^\n]*\n/, 'token present');
  const block = css.slice(css.indexOf('Secondary accent'), css.indexOf('--accent2-strong'));
  assert.match(block, /text/i, 'the comment above --accent2-strong should say it is the text/border variant');
});

/* WhatsApp green (Todoist 6hfrX4MVcfMjPP6q). The brand's own #25d366 is
   1.98:1 on white — fills only, like the peach. The strong green is what
   text, borders and focus rings use. */
test('the strong WhatsApp green clears AA as text on every ground its buttons sit on', () => {
  const strong = token('whatsapp-strong');
  const green = token('whatsapp');
  assert.ok(strong && green, '--whatsapp and --whatsapp-strong are in tokens.css');
  const grounds = {
    'white (cards)': token('bg-card'),
    'page background': token('bg-base'),
    'blue surface': token('bg-surface'),
    'green wash on white (hover)': over(green, 0.12, token('bg-card')),
    'green wash on blue surface': over(green, 0.12, token('bg-surface')),
  };
  for (const [name, ground] of Object.entries(grounds)) {
    const ratio = contrast(strong, ground);
    assert.ok(ratio >= AA_TEXT, `${strong} on ${name} ${ground} is ${ratio.toFixed(2)}:1, needs ${AA_TEXT}:1`);
  }
});
