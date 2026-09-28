/**
 * Homework task text keeps its formulas left to right wherever it is read:
 * the child's board, the parent's, and the tutor's dashboard. Generated
 * tasks write plain formulas inside Hebrew («פתחו סוגריים: א. 8-(x+3)»),
 * and in a right-to-left line "8-(x+3)" was laid out as ")x+3(-8"
 * (measured in Chromium, 2026-09-28). See $lib/bidi.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');

test('every page that shows a homework task shows it through FormulaText', () => {
  const pages = {
    'src/routes/app/student/+page.svelte': /<FormulaText text=\{h\.task\} \/>/,
    'src/routes/app/parent/+page.svelte': /<FormulaText text=\{h\.task\} \/>/,
    'src/routes/app/dashboard/+page.svelte': /<FormulaText text=\{hw\.task\} \/>/,
  };
  for (const [f, re] of Object.entries(pages)) {
    const s = read(f);
    assert.match(s, re, f);
    assert.doesNotMatch(s, />\s*\{h(w)?\.task\}\s*</, `${f}: no bare task text left`);
  }
});
