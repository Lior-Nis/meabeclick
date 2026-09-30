// tests/unit/hero-carousel.test.mjs
//
// «איך נראית הלמידה במאה בקליק?» (Todoist 6hfrX4QGqF76c6pH): each card's
// picture shows what its text says, and neither the picture nor the text is
// cut. Measured before the change at 390px: a third of each picture showed,
// and the paragraph ran 14px past the card's fixed height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const page = read('src/routes/+page.svelte');
const css = page.slice(page.indexOf('<style'));
const block = (sel) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

const CARDS = [
  ['למידה אישית', '/images/features/personal-learning.svg'],
  ['תרגול שמרגיש כמו משחק', '/images/features/practice-game.svg'],
  ['תמונה ברורה להורים', '/images/features/parent-progress.svg'],
];

test('each card has its own picture, in order', () => {
  const at = CARDS.map(([eyebrow, image]) => {
    const i = page.indexOf(`image: '${image}'`);
    assert.ok(i > 0, `${image} is used`);
    assert.ok(page.indexOf(`eyebrow: '${eyebrow}'`, i) - i < 120, `${image} belongs to «${eyebrow}»`);
    return i;
  });
  assert.deepEqual([...at].sort((a, b) => a - b), at);
});

test('the pictures are drawn at the shape they are shown in, with nothing small to read', () => {
  for (const [, image] of CARDS) {
    const file = join('static', image);
    assert.ok(existsSync(join(process.cwd(), file)), file);
    const svg = read(file);
    assert.match(svg, /viewBox="0 0 400 300"/, `${image} is 4:3`);
    assert.doesNotMatch(svg, /<script|<foreignObject|href="http/i);
    for (const m of svg.matchAll(/font-size="(\d+)"/g)) assert.ok(Number(m[1]) >= 18, `${image}: text at ${m[1]}px`);
  }
});

test('a picture is fitted whole, never cropped', () => {
  assert.match(block('.hero-feature-art img'), /object-fit:\s*contain/);
  assert.doesNotMatch(css.slice(css.indexOf('Redesigned hero feature carousel')), /object-fit:\s*cover/);
});

test('the cards grow with their text instead of cutting it at a fixed height', () => {
  const carousel = css.slice(css.indexOf('Redesigned hero feature carousel'));
  assert.doesNotMatch(carousel, /:global\(\.ac\)\s*\{[^}]*height:\s*\d+px/, 'no fixed carousel height');
  assert.match(carousel, /:global\(\.ac\)\s*\{[^}]*height:\s*auto/);
});

test('on a phone the picture sits above the text, at full width', () => {
  const phone = css.slice(css.indexOf('@media (max-width: 680px)', css.indexOf('Redesigned hero feature carousel')));
  assert.match(phone, /\.hero-feature-card\s*\{[^}]*grid-template-columns:\s*1fr/);
  assert.match(phone, /\.hero-feature-art\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9/);
});

test('no bar is laid over a picture any more', () => {
  assert.doesNotMatch(page, /hero-feature-progress/);
  assert.doesNotMatch(page, /progress-art/);
});
