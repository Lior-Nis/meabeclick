/**
 * The tutor's homework checkbox, broken since #92.
 *
 * #92 split "done" into two stages — submitted, then graded — and changed
 * the activity route to send `submitted`/`graded` and to accept only
 * `{ submitted }` or `{ grade }` on PATCH. The dashboard kept its own copy
 * of the old shape, `{ done: boolean }`: every task rendered unticked,
 * every card counted every task as pending, and ticking one PATCHed
 * `{ done }`, which the route answers with 400 and the page shows as
 * «לא ניתן לעדכן את שיעורי הבית». The same shape declared twice, again —
 * so it is declared once now, in $lib, and both sides import it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const dash = read('src/routes/app/dashboard/+page.svelte');
const route = read('src/routes/api/students/[code]/activity/+server.ts');

test('the shape is declared once and both sides use it', () => {
  assert.match(read('src/lib/tutor-homework.ts'), /export interface TutorHomework/);
  assert.match(dash, /import type \{ TutorHomework \} from '\$lib\/tutor-homework\.ts'/);
  assert.match(route, /import type \{ TutorHomework \} from '\$lib\/tutor-homework\.ts'/);
  assert.doesNotMatch(dash, /interface HomeworkRec/);
});

test('nothing reads a `done` field the server never sends', () => {
  assert.doesNotMatch(dash, /\bhw\.done\b|\bh\.done\b/);
});

test('ticking sends the stage the route accepts', () => {
  const fn = dash.slice(dash.indexOf('async function toggleHw'), dash.indexOf('async function toggleHw') + 600);
  assert.match(fn, /submitted:\s*!hw\.submitted/);
  assert.doesNotMatch(fn, /done:/);
});

test('a card counts only work nobody has handed in or judged as pending', () => {
  assert.match(dash, /hwPending: ex\.homework\.filter\(h => !h\.submitted && !h\.graded\)\.length/);
});
