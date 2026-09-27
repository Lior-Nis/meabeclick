// tests/characterization/landing-pricing.test.mjs
//
// The landing page sells the lessons; plans.ts prices them. They used to be
// two independent lists of the same three numbers, and plans.ts's own header
// records what that cost the last time: three surfaces disagreeing about
// what a lesson costs, with a parent carrying the mapping in their head.
//
// The page kept its own copy through all of that. These tests are what make
// "the landing page imports plans.ts" a property rather than a commit
// message — the negative one especially, which fails if anyone types a price
// back into the template.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';
import { PLANS, formatPrice } from '../../src/lib/plans.ts';

const landing = async (baseUrl) => (await fetch(`${baseUrl}/`)).text();

test('every plan is sold at the price plans.ts sets', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await landing(baseUrl);
    for (const plan of PLANS) {
      assert.match(html, new RegExp(plan.name), `${plan.name} is missing from the pricing grid`);
      assert.match(html, new RegExp(formatPrice(plan.shekels)), `${plan.name} is not priced`);
      assert.match(html, new RegExp(plan.duration), `${plan.name} has no duration`);
    }
  } finally { await stop(); }
});

test('no price appears that plans.ts does not set', async () => {
  // THE regression test. A hardcoded ₪ figure in the template passes the
  // test above — it only fails here, and only here would a stale price
  // survive a change to plans.ts.
  const { baseUrl, stop } = await startServer();
  try {
    const html = await landing(baseUrl);
    const sold = new Set(PLANS.map(p => formatPrice(p.shekels)));
    const shown = new Set((html.match(/₪\d[\d.,]*/g) ?? []));
    for (const price of shown) {
      assert.ok(sold.has(price), `the page shows ${price}, which is not a price in plans.ts`);
    }
    assert.equal(shown.size, sold.size, 'every plan price should appear exactly as a set');
  } finally { await stop(); }
});

test('the FAQ answer agrees with the cards above it', async () => {
  // The FAQ used to name all three durations in its own prose, one scroll
  // below the cards, with nothing keeping the two in step.
  const { baseUrl, stop } = await startServer();
  try {
    const html = await landing(baseUrl);
    const faq = html.match(/קיימת אפשרות להזמין[^<]*/)?.[0];
    assert.ok(faq, 'the duration FAQ answer is missing');
    for (const plan of PLANS) {
      assert.ok(faq.includes(plan.name), `${plan.name} missing from the FAQ`);
      assert.ok(faq.includes(plan.duration), `${plan.duration} missing from the FAQ`);
    }
  } finally { await stop(); }
});

test('the pricing cards keep their scoped reveal animation', async () => {
  // The delays are applied by `.reveal-delay-N.svelte-<hash>`, and the class
  // is now built dynamically ({i + 1}), which Svelte cannot see when it
  // decides which scoped selectors to keep. They survive today only because
  // the showcase cards above still use them statically — remove those and
  // the pricing animation silently stops. This is the tripwire for that.
  const { baseUrl, stop } = await startServer();
  try {
    const html = await landing(baseUrl);
    // Anchored so the inner pricing-card-name / -price / -duration divs do
    // not count as cards: "pricing-card" must be followed by whitespace or
    // the closing quote, never a hyphen.
    const cards = [...html.matchAll(/<div class="(pricing-card(?:\s[^"]*)?)"/g)].map(m => m[1]);
    assert.equal(cards.length, PLANS.length);

    cards.forEach((cls, i) => {
      assert.match(cls, new RegExp(`reveal-delay-${i + 1}\\b`), `card ${i + 1} lost its delay class`);
      assert.match(cls, /\bsvelte-[a-z0-9]+\b/, `card ${i + 1} lost its scope class, so the delay CSS cannot match`);
    });

    // The highlighted plan is named by duration, not grid position.
    const featured = cards.filter(c => /\bfeatured\b/.test(c));
    assert.equal(featured.length, 1, 'exactly one plan should be highlighted');
  } finally { await stop(); }
});
