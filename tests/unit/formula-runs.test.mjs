/**
 * A formula inside a Hebrew line keeps its own direction. In a right-to-left
 * paragraph "ב. 5-2x+4=9-2x" was laid out with its parts reordered: digits
 * and Latin letters form separate directional runs, and the minus signs
 * between them take the paragraph's direction. Found on the answer key
 * (2026-09-28); the homework task text children read has the same shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const B = await import('../../src/lib/bidi.ts');
const runs = (t) => B.formulaRuns(t).map(r => (r.ltr ? `[${r.text}]` : r.text)).join('');

test('each formula is one left-to-right run; the Hebrew around it is left alone', () => {
  assert.equal(runs('א. 8-x-3=5-x'), 'א. [8-x-3=5-x]');
  assert.equal(runs('פתחי סוגריים: א. 8-(x+3) ב. 5-(2x-4)'), 'פתחי סוגריים: א. [8-(x+3)] ב. [5-(2x-4)]');
  assert.equal(runs('2x + 3 = 11 ולכן x=4.'), '[2x + 3 = 11] ולכן [x=4].');
});

test('a leading minus belongs to its number, and sentence punctuation does not', () => {
  assert.equal(runs('התשובה: -5.'), 'התשובה: [-5].');
  assert.equal(runs('בדיקה: 12-(4+2)=6;'), 'בדיקה: [12-(4+2)=6];');
  // A Hebrew prefix hyphen is not a minus: «שווה ל-16» is "equal to 16".
  assert.equal(runs('שני האגפים שווים ל-16'), 'שני האגפים שווים ל-[16]');
});

test('prose with no formula is one plain run, and lines stay lines', () => {
  assert.deepEqual(B.formulaRuns('אין כאן נוסחה'), [{ text: 'אין כאן נוסחה', ltr: false }]);
  assert.equal(runs('א. x=1\nב. x=2'), 'א. [x=1]\nב. [x=2]');
  assert.deepEqual(B.formulaRuns(''), []);
});

test('the answer key renders through it', () => {
  const d = readFileSync(join(process.cwd(), 'src/routes/app/dashboard/+page.svelte'), 'utf8');
  assert.match(d, /<FormulaText text=\{hw\.answer\} \/>/);
});
