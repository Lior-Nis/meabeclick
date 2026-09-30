// tests/unit/whatsapp-button.test.mjs
//
// The WhatsApp buttons were drawn in the dark orange of the peach accent,
// which read as red and not as WhatsApp (Todoist 6hfrX4MVcfMjPP6q). They are
// WhatsApp green, carry WhatsApp's mark, and have hover, pressed and focus
// states; where they lead does not change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const landing = read('src/routes/+page.svelte');
const booking = read('src/routes/booking/+page.svelte');

/** The body of every CSS rule whose selector list mentions `sel`. */
const rules = (src, sel) => [...src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, s]) => s.split(',').some(x => x.trim().startsWith(sel)))
  .map(([, s, body]) => ({ selector: s.trim(), body }));

for (const cls of ['.whatsapp-cta', '.whatsapp-cta-icon']) {
  test(`${cls} is WhatsApp green, not the peach`, () => {
    const all = rules(landing, cls).filter(r => r.selector.split(',').some(x => x.trim().split(/[:\s]/)[0] === cls));
    assert.ok(all.length, `${cls} has rules`);
    for (const r of all) assert.doesNotMatch(r.body, /accent2/, `${r.selector} still uses the peach`);
    const base = all.find(r => r.selector === cls);
    assert.match(base.body, /color:\s*var\(--whatsapp-strong\)/);
    assert.match(base.body, /border:[^;]*var\(--whatsapp-strong\)/);
  });

  test(`${cls} has hover, pressed and keyboard-focus states`, () => {
    const sels = rules(landing, cls).map(r => r.selector).join(' | ');
    assert.match(sels, new RegExp(`\\${cls}:hover`));
    assert.match(sels, new RegExp(`\\${cls}:active`));
    assert.match(sels, new RegExp(`\\${cls}:focus-visible`));
  });
}

test("both landing buttons carry WhatsApp's mark, and still open the same chat", () => {
  assert.equal((landing.match(/<Icon name="whatsapp"/g) ?? []).length, 2);
  assert.equal((landing.match(/href=\{WHATSAPP_HREF\}/g) ?? []).length, 2);
  assert.match(landing, /const WHATSAPP_HREF = `https:\/\/wa\.me\/\$\{TUTOR_PHONE\}\?text=\$\{WHATSAPP_TEXT\}`;/);
});

test('the mark is an icon like the others: in the catalogue, drawn in currentColor', () => {
  assert.match(read('src/lib/icons/registry.ts'), /\n\s*whatsapp:\s*\{ fallback:/);
  const file = 'src/lib/icons/svg/whatsapp.svg';
  assert.ok(existsSync(join(process.cwd(), file)));
  const svg = read(file);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /fill="currentColor" stroke="none"/, 'a filled glyph, not outlined by the icon CSS');
  assert.doesNotMatch(svg, /#[0-9a-f]{3,8}/i, 'no hardcoded colour');
});

test("the booking page's WhatsApp links are the same green", () => {
  const wa = rules(booking, '.wa-link').find(r => r.selector === '.wa-link');
  assert.match(wa.body, /color:\s*var\(--whatsapp-strong\)/);
});
