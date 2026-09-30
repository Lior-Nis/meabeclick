/**
 * The editor page, source-level (this repo has no browser runner; the
 * browser walk is in the PR). Spec:
 * docs/superpowers/specs/2026-09-25-lesson-editor-design.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const page = read('src/routes/app/lessons/[slug]/edit/+page.svelte');
const server = read('src/routes/app/lessons/[slug]/edit/+page.server.ts');
const { formatDateTime } = await import('../../src/lib/dates.ts');

test('tutor only', () => {
  assert.match(server, /requireAuth\(event\)/);
  assert.match(server, /error\(404/);
});

test('draft and publish are separate buttons, and she is told which happened', () => {
  assert.match(page, /send\('save-plan'\)/);
  assert.match(page, /send\('publish-plan'\)/);
  assert.match(page, /עדיין רואה את הגרסה שפורסמה/);
});

test('the preview is the deck as its own document, in an isolated frame', () => {
  // srcdoc inherits this page's CSP, which blocks the deck's inline style
  // and script: the first preview rendered unstyled, every slide stacked.
  assert.doesNotMatch(page, /srcdoc=/);
  assert.match(page, /target="lesson-preview"/);
  assert.match(page, /name="lesson-preview"[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(page, /allow-same-origin/);
  const preview = read('src/routes/app/lessons/[slug]/preview/+server.ts');
  assert.match(preview, /requireAuth\(event\)/);
  assert.match(preview, /documentHeaders\(\)/);
});

test('loading an old version fills the form and does not publish it', () => {
  const load = page.slice(page.indexOf('function load('), page.indexOf('const first'));
  assert.doesNotMatch(load, /fetch|send\(/);
});

test('the dashboard links a generated lesson to its editor', () => {
  assert.match(read('src/routes/app/dashboard/+page.svelte'), /\{#if l\.status === 'ready'\}<a href="\/app\/lessons\/\{l\.slug\}\/edit">/);
});

test('history times are Israel time', () => {
  assert.equal(formatDateTime('2027-03-15T22:30:00.000Z'), '16/03/2027 00:30');
});

test('loading another version over unsaved typing asks first, and leaving warns', () => {
  assert.match(page, /const dirty = \$derived\(/);
  assert.match(page, /confirmLoad === v\.version/, 'a second, explicit tap');
  assert.match(page, /onbeforeunload|beforeunload/);
});

test('history says which version the student sees now, and is bounded', () => {
  assert.match(page, /מוצגת לתלמיד\/ה עכשיו/);
  assert.match(server, /HISTORY_LIMIT = 30/);
  assert.match(server, /formPlan\(/);
});

/* A library master's check questions and homework (tests/unit/library-editing.test.mjs). */

test("a master offers its check questions and homework; a student's lesson does not", () => {
  assert.match(server, /isMaster: isLibrarySlug\(slug\)/);
  assert.match(page, /\{#if data\.isMaster\}/);
  assert.match(page, /<h2>שאלות בדיקה<\/h2>/);
  assert.match(page, /<h2>שיעורי בית<\/h2>/);
  // Sent only from a master, and questions only when the plan has a quiz.
  assert.match(page, /data\.isMaster \?/);
  assert.match(page, /quiz !== null \? \{ quiz:/);
});

test('the right answer is picked from the options, not typed', () => {
  assert.match(page, /type="radio"/);
  assert.match(page, /name="answer-\{i\}"/);
  assert.match(page, /aria-label="התשובה הנכונה: אפשרות \{k \+ 1\}"/);
});

test('the answer key is marked as hers, and publishing a master says where it goes', () => {
  assert.match(page, /תשובון — רק לך/);
  assert.match(page, /פורסם בספרייה/);
  assert.match(page, /שיעורים שכבר נשלחו לא משתנים/);
});

test("a master's live version is the one the library copies, not one a student sees", () => {
  assert.match(page, /data\.isMaster \? '· בשימוש בספרייה עכשיו' : '· מוצגת לתלמיד\/ה עכשיו'/);
});
