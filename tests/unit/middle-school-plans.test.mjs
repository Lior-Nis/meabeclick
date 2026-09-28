/**
 * A learning plan for the grades families actually book. Only the 4 and 5
 * יח"ל high-school trees existed, so a כיתה ח student got «אינה תואמת
 * לאף תבנית» — no plan, so no skill progress, no homework from what was
 * taught, no targeted lesson (pre-launch review, 2026-09-28).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const T = await import('../../src/lib/server/plans/templates.ts');
const booking = readFileSync(join(process.cwd(), 'src/routes/booking/+page.svelte'), 'utf8');

for (const [grade, id] of [['כיתה ז', 'math-7'], ['כיתה ח', 'math-8'], ['כיתה ט', 'math-9']]) {
  test(`${grade} is offered a plan`, () => {
    const t = T.templatesForSubject('מתמטיקה').find(x => x.id === id);
    assert.ok(t, `${id} exists`);
    assert.deepEqual(T.validateTemplate(t), []);
    assert.equal(T.templateFitsLevel(t, grade), true);
    assert.ok(booking.includes(`<option>${grade}</option>`), 'the grade is spelled as booking spells it');
    assert.equal(t.reviewed, null, 'not reviewed until the tutor has read it end to end');
    const skills = t.topics.flatMap(x => x.branches).flatMap(b => b.skills);
    assert.ok(skills.length >= 12, `${skills.length} skills`);
    assert.ok(skills.every(s => s.gloss), 'every skill carries an English gloss, like the high-school trees');
  });
}

test('each grade gets exactly one middle-school plan, and high school keeps its own', () => {
  const all = T.templatesForSubject('מתמטיקה');
  for (const g of ['כיתה ז', 'כיתה ח', 'כיתה ט']) {
    assert.equal(all.filter(t => T.templateFitsLevel(t, g)).length, 1, g);
  }
  assert.equal(all.filter(t => T.templateFitsLevel(t, 'כיתה י')).length, 2, '4u and 5u, as before');
});
