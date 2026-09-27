/**
 * PRODUCT.md, "Progress parents can see" — done when a parent's page shows
 * what was covered and what the child understood. It showed one percentage
 * labelled «רמת התקדמות כללית», which was a homework count for most
 * families. The lists come from progressFor() (tests/unit/progress.test.mjs
 * covers what goes in them); this pins that the page renders them and
 * labels the figure by what it counts. Browser proof is in the PR.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'src/routes/app/parent/+page.svelte'), 'utf8');

test('the parent page lists what was understood and what was covered', () => {
  assert.match(page, /CURRENT\?\.progress\?\.seen/);
  assert.match(page, /\{#each seen\.understood as u/);
  assert.match(page, /\{#each seen\.covered as title/);
});

test('the figure says what it counts, never a bare "overall progress"', () => {
  assert.doesNotMatch(page, /רמת התקדמות כללית<\/span>/);
  assert.match(page, /שיעורי בית הוגשו/);
  assert.match(page, /יכולות בתכנית הובנו/);
});

test('empty lists are not shown as two empty headings', () => {
  assert.match(page, /\{#if seen && \(seen\.understood\.length \|\| seen\.covered\.length\)\}/);
});
