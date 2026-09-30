/**
 * A learning plan for the booking form's «כיתה ה–ו» level. It is one option,
 * so it is one combined tree: grade 5 material before grade 6 material inside
 * each topic. The content follows the 2006 elementary curriculum, which grades
 * 5–6 still learn in תשפ"ז, as trimmed by the Ministry's תשפ"ז teaching
 * recommendations (research doc §7).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const T = await import('../../src/lib/server/plans/templates.ts');
const booking = readFileSync(join(process.cwd(), 'src/routes/booking/+page.svelte'), 'utf8');

const GRADE = 'כיתה ה–ו';
const plan = () => T.templatesForSubject('מתמטיקה').find(x => x.id === 'math-5-6');
const skillsOf = (t) => t.topics.flatMap(x => x.branches).flatMap(b => b.skills);

test(`${GRADE} is offered a plan`, () => {
  const t = plan();
  assert.ok(t, 'math-5-6 exists and loads');
  assert.deepEqual(T.validateTemplate(t), []);
  assert.equal(T.templateFitsLevel(t, GRADE), true);
  assert.ok(booking.includes(`<option>${GRADE}</option>`), 'the level is spelled as booking spells it (with an en dash)');
  assert.equal(t.reviewed, null, 'not reviewed until the tutor has read it end to end');
  const skills = skillsOf(t);
  assert.ok(skills.length >= 20 && skills.length <= 30, `${skills.length} skills`);
  assert.ok(skills.every(s => s.gloss), 'every skill carries an English gloss, like the other trees');
});

test('it fits no other grade, and no other plan fits it', () => {
  const t = plan();
  for (const g of ['כיתה ז', 'כיתה ג–ד', 'כיתה ה', 'כיתה ו']) {
    assert.equal(T.templateFitsLevel(t, g), false, g);
  }
  const all = T.templatesForSubject('מתמטיקה');
  assert.deepEqual(all.filter(x => T.templateFitsLevel(x, GRADE)).map(x => x.id), ['math-5-6']);
  assert.equal(all.filter(x => T.templateFitsLevel(x, 'כיתה ז')).length, 1, 'grade 7 keeps exactly its own plan');
});

test('every prerequisite is a skill in this tree', () => {
  const t = plan();
  const keys = new Set(skillsOf(t).map(s => s.key));
  for (const skill of skillsOf(t)) {
    for (const req of skill.requires ?? []) {
      assert.ok(keys.has(req), `${skill.key} requires ${req}, which is absent from this tree`);
    }
  }
});

test('the tree carries the grade 5–6 anchors', () => {
  const keys = new Set(skillsOf(plan()).map(s => s.key));
  for (const k of [
    'frac.addsub.simple', // grade 5: adding and subtracting fractions
    'frac.meaning.decimal', // grade 5: decimals
    'frac.muldiv.mul', // grade 6: multiplying fractions
    'frac.percent.calc', // grade 6: percentages
    'geo.area.rect', // grade 5: area and perimeter of a rectangle
    'geo.area.polygons', // grade 5: parallelogram and triangle area
    'geo.measure.circle', // grade 6: circumference and area of a circle
    'data.stats.mean', // grade 5: the mean
  ]) {
    assert.ok(keys.has(k), `missing ${k}`);
  }
});

test('its source points at a heading that exists in the research doc', () => {
  const [file, anchor] = plan().source.split('#');
  const doc = readFileSync(join(process.cwd(), file), 'utf8');
  // GitHub's heading slug: lower-case, drop punctuation (the en dash too), spaces to hyphens.
  const slugs = [...doc.matchAll(/^#{1,6} (.+)$/gm)]
    .map(m => m[1].trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-'));
  assert.ok(slugs.includes(anchor), `#${anchor} is not a heading in ${file}`);
});
