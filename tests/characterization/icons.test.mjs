// tests/characterization/icons.test.mjs
//
// Icons must be RENDERED, not merely bundled.
//
// This file exists because of a bug that passed every other kind of check.
// The registry guarded its import.meta.glob with `typeof import.meta.glob
// === 'function'`. Vite rewrites the CALL at build time but leaves that
// check as a runtime test against a property the built output does not have
// — so it was always false in production, every icon silently fell back to
// its emoji, and the SVGs sat in the bundle as dead code.
//
// Grepping the bundle found that dead markup and read as success. The unit
// tests passed, because outside Vite the fallback IS the correct answer. The
// build passed. Only rendering a page and looking at the HTML told the
// truth, which is what this file does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './harness.mjs';
import { ICONS } from '../../src/lib/icons/registry.ts';

/** The span the Icon component emits, with whatever it chose to put inside —
 *  Svelte's hydration comments and the vendored licence header included. */
const ICON_SPAN = /<span class="icon[^"]*"[^>]*>([\s\S]*?)<\/span>/g;

test('branded artwork actually reaches the page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const rendered = [...html.matchAll(ICON_SPAN)].map(m => m[1]);
    assert.ok(rendered.length >= 5, `expected icons on the landing page, found ${rendered.length}`);

    const withSvg = rendered.filter(inner => inner.includes('<svg'));
    assert.equal(withSvg.length, rendered.length,
      'every icon with artwork on disk must render its SVG — a fallback here means the glob is not reaching runtime');
  } finally { await stop(); }
});

test('the artwork inherits its colour rather than hardcoding one', async () => {
  // The contract that lets ONE file work on the blue header and on a white
  // card. An icon carrying its own hex would look wrong on one of them, and
  // nothing else would fail.
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const svgs = [...html.matchAll(ICON_SPAN)].map(m => m[1]).filter(s => s.includes('<svg'));
    assert.ok(svgs.length > 0);
    for (const svg of svgs) {
      assert.match(svg, /stroke="currentColor"/, 'icons must stroke with currentColor');
      assert.doesNotMatch(svg, /(?:stroke|fill)="#[0-9a-f]{3,8}"/i, 'icon artwork must not hardcode a colour');
    }
  } finally { await stop(); }
});

test('icons are decorative unless they carry meaning alone', async () => {
  // Most sit beside their own label, so announcing them makes a screen
  // reader read every heading twice.
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const spans = html.match(/<span class="icon[^"]*"[^>]*>/g) ?? [];
    assert.ok(spans.length > 0);
    for (const s of spans) {
      const labelled = s.includes('role="img"');
      assert.ok(labelled || s.includes('aria-hidden="true"'),
        `an icon is neither labelled nor hidden: ${s}`);
    }
  } finally { await stop(); }
});

test('every catalogue name has artwork', async () => {
  // Once a set is vendored, a name without a file is an emoji hiding among
  // icons — visible to a user, invisible to every other test.
  const { readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../src/lib/icons/svg');
  const have = new Set(readdirSync(dir).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')));
  const missing = Object.keys(ICONS).filter(n => !have.has(n));
  assert.deepEqual(missing, [], `these icons have no artwork: ${missing.join(', ')}`);
});
