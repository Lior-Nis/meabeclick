// tests/unit/report-draft-ui.test.mjs
//
// Step 5: the tutor sees a draft with its evidence, and nothing is applied
// unasked.
//
// Spec §7 — "any automatic change to a plan" is out of scope — and §3.3 —
// the family never sees a suggestion. Both are properties of this screen,
// and both are easy to lose in a refactor that "helpfully" preselects.
//
// Source assertions, like the rest of this repo's page tests. The report
// form's behaviour after hydration is not reachable from the
// characterization harness, so these pin the decisions; the browser check
// is in the PR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const server = read('src/routes/app/report/[booking]/+page.server.ts');
const page = read('src/routes/app/report/[booking]/+page.svelte');

test('the report load attaches an evidence draft to each skill', () => {
  assert.match(server, /suggestStatus/, 'the engine must be consulted');
  assert.match(server, /evidenceForSkill/, 'with real evidence, not a guess');
});

test('a draft never becomes the selected status on its own', () => {
  // The whole feature is the approval gate. Preselecting the draft would
  // make the tutor's approval decorative — she would be confirming the
  // system's opinion rather than recording her own, and a report filed
  // without her reading it is exactly the inference this task removes.
  assert.doesNotMatch(page, /statusChoice\[[^\]]*\]\s*=\s*[^;]*\.draft\b/,
    'nothing may assign a draft into statusChoice except an explicit click');
  assert.doesNotMatch(page, /ticked\[[^\]]*\]\s*=\s*true\s*;?\s*\/\/\s*draft/i,
    'a draft must not tick a skill either');
});

test('accepting a draft is an explicit action the tutor takes', () => {
  assert.match(page, /acceptDraft/, 'there must be a named, deliberate accept path');
  assert.match(page, /onclick=\{[^}]*acceptDraft/, 'reached by a click, not by an effect');
});

test('the draft is shown with its evidence, not as a bare verdict', () => {
  // "2 תרגולים, 95%, אחרון ..." can be checked against rows. A status on
  // its own cannot be argued with, which is how a tutor stops reading it.
  assert.match(page, /\.why\b/, 'the evidence sentence must be rendered');
});

test('status is never carried by colour alone', () => {
  // House rule, and it matters most here: a draft chip that differs from a
  // filed status only by hue is unreadable to a colour-blind tutor on a
  // phone in daylight.
  const chip = /class="draft[^"]*"/.exec(page);
  assert.ok(chip, 'the draft needs its own class to be styled and labelled');
  assert.match(page, /הצעה/, 'the chip must say in words that it is a suggestion');
});

test('the family portal never receives a suggestion', () => {
  // §3.3. Showing a family "the system thinks she is independent" while the
  // tutor has not said so makes her approval decorative and turns a
  // disagreement into a visible contradiction.
  for (const p of ['src/routes/api/portal/[code]/+server.ts',
                   'src/routes/app/parent/+page.svelte',
                   'src/routes/app/student/+page.svelte']) {
    assert.doesNotMatch(read(p), /suggestStatus|\bdraft\b/,
      `${p} must not carry a suggestion`);
  }
});
