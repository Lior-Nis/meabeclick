// tests/unit/landing-ctas.test.mjs
//
// Task 4 of the marketing-funnel plan (docs/superpowers/specs/
// 2026-09-24-marketing-funnel-design.md): both /booking buttons on the
// landing page are relabelled, each gets a WhatsApp button beside it, and
// every one of the three CTAs (booking x2, WhatsApp x2, header phone)
// fires its own cta_click. Asserted against the source, like
// booking-heard-from-question.test.mjs — a stable markup/wiring contract
// that a browser check then proves actually renders and wraps cleanly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUTOR_PHONE, TUTOR_PHONE_DISPLAY } from '../../src/lib/contact.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const landing = readFileSync(join(ROOT, 'src/routes/+page.svelte'), 'utf8');
const header = readFileSync(join(ROOT, 'src/lib/components/Header.svelte'), 'utf8');
const booking = readFileSync(join(ROOT, 'src/routes/booking/+page.svelte'), 'utf8');

test('src/lib/contact.ts exports the international and local-display phone forms', () => {
  assert.equal(TUTOR_PHONE, '972546969891');
  assert.equal(TUTOR_PHONE_DISPLAY, '0546969891');
});

test('both /booking buttons on the landing page read exactly "בדקו מועד לשיעור"', () => {
  // href="/booking" ... >Icon ... בדקו מועד לשיעור</a> — matched loosely
  // enough to survive the Icon markup between the anchor and the label.
  const matches = [...landing.matchAll(/href="\/booking"[^>]*>[\s\S]{0,120}?בדקו מועד לשיעור<\/a>/g)];
  assert.equal(matches.length, 2, `expected exactly 2 relabelled /booking buttons, found ${matches.length}`);

  // The regression this guards: the old copy must not survive anywhere on
  // the page (it was "הזמנת שיעור" on both the pricing and sticky CTAs).
  assert.doesNotMatch(landing, /href="\/booking"[^>]*>[\s\S]{0,120}?הזמנת שיעור<\/a>/,
    'a /booking button still carries the old label');
});

test('no prose quotes a button label that no longer exists on this page', () => {
  // src/routes/+page.svelte only — Header.svelte's own nav-cta ("הזמנת
  // שיעור") is a separate file/component and out of scope here. The FAQ
  // answer that quoted the /booking label became «איך זה עובד?»'s first
  // step (Todoist 6hfrX4W5mfXVmG5H), which names no button.
  assert.doesNotMatch(landing, /כפתור\s*"הזמנת שיעור"/,
    'prose quotes the old button label, which no longer appears on this page');
});

test('every landing /booking button sends cta_click with target "booking"', () => {
  // Pricing, the sticky bar, and «קובעים שיעור ראשון» under «איך זה עובד?».
  const buttons = (landing.match(/href="\/booking"/g) ?? []).length;
  const matches = [...landing.matchAll(/href="\/booking"[\s\S]{0,300}?track\(\s*'cta_click'\s*,\s*\{\s*target:\s*'booking'\s*\}\s*\)/g)];
  assert.equal(buttons, 3);
  assert.equal(matches.length, buttons, `expected every /booking button to track target booking, found ${matches.length} of ${buttons}`);
});

test('a WhatsApp button sits beside each /booking button, built from contact.ts', () => {
  assert.equal((landing.match(/href=\{WHATSAPP_HREF\}/g) ?? []).length, 2, 'expected exactly 2 WhatsApp buttons');
  assert.equal((landing.match(/wa\.me\//g) ?? []).length, 1,
    'the wa.me URL should be built once (WHATSAPP_HREF) and reused by both buttons, not duplicated');
  assert.match(landing, /import \{ TUTOR_PHONE \} from '\$lib\/contact\.ts'/,
    'the WhatsApp href must be built from the shared contact.ts constant, not a new literal');
  assert.doesNotMatch(landing, /972546969891/, 'the phone digits must not be re-duplicated in +page.svelte');

  // A warm Hebrew prefilled message, not a bare link.
  assert.match(landing, /wa\.me\/\$\{TUTOR_PHONE\}\?text=\$\{WHATSAPP_TEXT\}/);
  assert.match(landing, /WHATSAPP_TEXT = encodeURIComponent\('[^']*היי[^']*'\)/,
    'the prefilled WhatsApp message should open with a warm Hebrew greeting');
});

test('both WhatsApp buttons open in a new tab safely and send cta_click with target "whatsapp"', () => {
  const buttons = [...landing.matchAll(/<a\s+href=\{WHATSAPP_HREF\}[\s\S]{0,300}?<\/a>/g)];
  assert.equal(buttons.length, 2, `expected 2 WhatsApp anchors, found ${buttons.length}`);
  for (const [markup] of buttons) {
    assert.match(markup, /target="_blank"/);
    assert.match(markup, /rel="noopener"/);
    assert.match(markup, /track\(\s*'cta_click'\s*,\s*\{\s*target:\s*'whatsapp'\s*\}\s*\)/);
  }
});

// Controller ruling: the fixed sticky bar must stay one line at every
// width. Two full labelled buttons there made it ~120px tall on phones —
// so the sticky bar's WhatsApp action is icon-only (aria-label, no visible
// text), while the pricing-section row (not fixed, has room) keeps the
// full labelled button.
test('the pricing-section WhatsApp button keeps its visible "וואטסאפ" label', () => {
  assert.match(landing, /class="whatsapp-cta"[\s\S]{0,120}?וואטסאפ<\/a>/,
    'the pricing row\'s WhatsApp button must still show its label');
});

test('the sticky bar\'s WhatsApp button is icon-only, with an aria-label, not a visible label', () => {
  const stickyRow = landing.match(/<div class="sticky-cta-row">[\s\S]*?<\/div>/)?.[0];
  assert.ok(stickyRow, 'sticky-cta-row markup not found');

  const icon = stickyRow.match(/<a\s+href=\{WHATSAPP_HREF\}[\s\S]{0,300}?<\/a>/)?.[0];
  assert.ok(icon, 'sticky bar WhatsApp anchor not found');
  assert.match(icon, /class="whatsapp-cta-icon"/, 'the sticky WhatsApp button must use the icon-only class');
  assert.match(icon, /aria-label="וואטסאפ"/, 'the sticky WhatsApp button must carry an aria-label, since it has no visible text');
  assert.doesNotMatch(icon, />\s*<Icon[^>]*\/>\s*וואטסאפ\s*<\/a>/,
    'the sticky WhatsApp button must not print a visible "וואטסאפ" label beside the icon');

  // The primary booking button is the only labelled CTA left in this row.
  assert.match(stickyRow, /בדקו מועד לשיעור/);
});

test('the sticky bar row never wraps — book-cta sizes to content and the row is nowrap', () => {
  const rowRule = landing.match(/\.sticky-cta-row\s*\{[^}]*\}/)?.[0];
  assert.ok(rowRule, '.sticky-cta-row rule not found');
  assert.match(rowRule, /flex-wrap:\s*nowrap/, 'the sticky bar must never wrap onto a second line');
});

test('.whatsapp-cta-icon meets the 44px touch-target minimum and uses only tokens.css colours', () => {
  const rule = landing.match(/\.whatsapp-cta-icon\s*\{[^}]*\}/)?.[0];
  assert.ok(rule, '.whatsapp-cta-icon rule not found');
  const minW = rule.match(/min-width:\s*(\d+)px/)?.[1];
  const minH = rule.match(/min-height:\s*(\d+)px/)?.[1];
  assert.ok(minW && Number(minW) >= 44, 'min-width must be at least 44px');
  assert.ok(minH && Number(minH) >= 44, 'min-height must be at least 44px');
  for (const prop of ['background', 'color', 'border']) {
    const decl = rule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1] ?? '';
    if (decl) assert.match(decl, /var\(--/, `.whatsapp-cta-icon's ${prop} must come from a tokens.css variable, got "${decl}"`);
  }
});

test('landing_visit fires once from onMount, after initMarketing', () => {
  assert.match(landing, /import \{ initMarketing, track \} from '\$lib\/marketing\.ts'/);
  assert.match(landing,
    /onMount\(\(\)\s*=>\s*\{\s*[\s\S]{0,80}?initMarketing\(new URL\(location\.href\)\);\s*track\('landing_visit'\);/,
    'initMarketing must run, then track(\'landing_visit\'), as the first thing onMount does');
  assert.equal((landing.match(/track\('landing_visit'\)/g) ?? []).length, 1,
    'landing_visit must fire exactly once per page load');
});

test('no new colour is introduced for the WhatsApp button — it only uses tokens.css variables', () => {
  const whatsappRule = landing.match(/\.whatsapp-cta\s*\{[^}]*\}/)?.[0];
  assert.ok(whatsappRule, '.whatsapp-cta rule not found');
  // Every colour-bearing property must reference a var(--...) token, never
  // a literal hex/rgb value.
  for (const prop of ['background', 'color', 'border']) {
    const decl = whatsappRule.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1] ?? '';
    if (decl) assert.match(decl, /var\(--/, `.whatsapp-cta's ${prop} must come from a tokens.css variable, got "${decl}"`);
  }
});

test('the header phone link uses contact.ts and sends cta_click with target "phone"', () => {
  assert.match(header, /import \{ TUTOR_PHONE, TUTOR_PHONE_DISPLAY \} from '\$lib\/contact\.ts'/);
  assert.doesNotMatch(header, /972546969891/, 'the phone digits must not be hardcoded in Header.svelte anymore');
  assert.match(header, /href="tel:\+\{TUTOR_PHONE\}"/);
  assert.match(header, />\s*\{TUTOR_PHONE_DISPLAY\}\s*<\/a>/);
  assert.match(header,
    /href="tel:\+\{TUTOR_PHONE\}"[\s\S]{0,200}?track\(\s*'cta_click'\s*,\s*\{\s*target:\s*'phone'\s*\}\s*\)/,
    'the phone link must track cta_click with target phone');
});

test('booking/+page.svelte reuses TUTOR_PHONE from contact.ts instead of its own literal', () => {
  assert.match(booking, /import \{ TUTOR_PHONE \} from '\$lib\/contact\.ts'/);
  assert.doesNotMatch(booking, /const TUTOR_PHONE = '972546969891'/,
    'booking must no longer declare its own TUTOR_PHONE literal');
});
