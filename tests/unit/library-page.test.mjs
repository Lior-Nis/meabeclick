/**
 * The library page, source-level (the browser walk is in the PR).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(join(process.cwd(), 'src/routes/app/library/+page.svelte'), 'utf8');

test("it opens on the students' next skills, before the templates", () => {
  const due = page.indexOf('<h2>הבאים בתור אצל התלמידים</h2>');
  assert.ok(due > 0);
  assert.ok(due < page.indexOf('{#each view.topics'), 'above the template sections');
  assert.match(page, /\{#each view\.due as d \(d\.templateId \+ d\.skillKey\)\}/);
  assert.match(page, /d\.students\.join\(', '\)/);
});

test("preparing a due skill uses that skill's own template, not the one on screen", () => {
  assert.match(page, /prepare\(d\.templateId, \{ skill: d\.skillKey \}/);
  assert.match(page, /body: JSON\.stringify\(\{ template, \.\.\.body \}\)/);
});

test('with no plans yet, it says what to do rather than showing nothing', () => {
  assert.match(page, /\{#if view\.due\.length === 0\}/);
  assert.match(page, /אין עדיין תלמידים עם תכנית/);
});

test('a due skill on its way keeps the page refreshing', () => {
  assert.match(page, /view\.due\.some\(d => d\.item && \['queued', 'preparing'\]\.includes\(d\.item\.status\)\)/);
});
