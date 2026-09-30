/**
 * The plan tree's skill drawer links the skill's library lesson, when the
 * tutor's page passes one (source-level; the browser walk is in the PR).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const tree = read('src/lib/components/LearningPlanTree.svelte');
const page = read('src/routes/app/plan/[code]/+page.svelte');
const server = read('src/routes/app/plan/[code]/+page.server.ts');

test('the tutor page passes the ready masters by plan node', () => {
  assert.match(server, /readyMaster\(plan\.template_id, n\.key\)/);
  assert.match(page, /library=\{planRow && data\.plan\?\.library\}|library=\{data\.plan\?\.library \?\? \{\}\}/);
});

test("the drawer shows a skill's library lesson with view and edit", () => {
  assert.match(tree, /library\[selected\.sourceId\]/);
  assert.match(tree, /שיעור מוכן מהספרייה/);
  assert.match(tree, /href="\/app\/lessons\/\{libSlug\}\/edit"/);
  assert.match(tree, /href="\/lessons\/\{libSlug\}"/);
});

test('the family view passes none, so it shows none', () => {
  assert.match(tree, /library = \{\}/);
});
