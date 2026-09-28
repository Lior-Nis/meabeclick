import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadTemplates, templateById, validateTemplate } from '../../src/lib/server/plans/templates.ts';

/**
 * The grade options offered by the booking form's level `<select>`, parsed
 * out of the real route source — not a second hand-typed copy of the list,
 * which would guard nothing against the two drifting apart.
 */
function bookingGradeOptions() {
  const path = fileURLToPath(new URL('../../src/routes/booking/+page.svelte', import.meta.url));
  const source = readFileSync(path, 'utf8');
  const selectMatch = source.match(/<select\s[^>]*id="inp-level"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(selectMatch, 'could not find the #inp-level <select> in booking/+page.svelte');
  const options = [...selectMatch[1].matchAll(/<option([^>]*)>([^<]*)<\/option>/g)]
    .filter(m => !/value=""/.test(m[1])) // drop the "בחרו רמה..." placeholder
    .map(m => m[2].trim())
    .filter(Boolean);
  return options;
}

const skillsOf = (t) => t.topics.flatMap(topic => topic.branches.flatMap(b => b.skills));
const keysOf = (t) => new Set(skillsOf(t).map(s => s.key));

test('every shipped math template loads and validates', () => {
  const ids = loadTemplates().map(t => t.id).sort();
  // High school (4u, 5u) and, since 2026-09-28, grades ז–ט.
  assert.deepEqual(ids, ['math-4u', 'math-5u', 'math-7', 'math-8', 'math-9']);
  for (const id of ids) assert.deepEqual(validateTemplate(templateById(id)), [], id);
});

test('each template names its subject, track and questionnaires', () => {
  const five = templateById('math-5u');
  assert.equal(five.subject, 'מתמטיקה');
  assert.deepEqual(five.questionnaires, ['35571', '35572']);
  const four = templateById('math-4u');
  assert.equal(four.subject, 'מתמטיקה');
  assert.deepEqual(four.questionnaires, ['35471', '35472']);
});

test('the five-unit tree carries the topics the task asks for', () => {
  const topics = templateById('math-5u').topics.map(t => t.key);
  for (const key of ['func', 'calc', 'geo', 'prob']) {
    assert.ok(topics.includes(key), `missing topic ${key}: ${topics.join(', ')}`);
  }
});

test('second derivative, concavity and inflection are five-unit only', () => {
  // The Ministry curriculum puts F22 outside the 4-unit programme. A tree that
  // shows it to a 4-unit student would have the tutor teaching off-syllabus.
  assert.ok(keysOf(templateById('math-5u')).has('calc.second.inflection'));
  assert.ok(!keysOf(templateById('math-4u')).has('calc.second.inflection'));
});

test('trigonometric calculus and the cosine law are five-unit only', () => {
  const four = keysOf(templateById('math-4u'));
  const five = keysOf(templateById('math-5u'));
  assert.ok(five.has('calc.trig.investigate') && !four.has('calc.trig.investigate'));
  assert.ok(five.has('trig.general.cosine') && !four.has('trig.general.cosine'));
});

test('the function-investigation branch holds the whole standard sequence', () => {
  for (const id of ['math-4u', 'math-5u']) {
    const keys = keysOf(templateById(id));
    for (const k of ['calc.investigate.polynomial', 'calc.extrema.polynomial', 'calc.rules.quotient']) {
      assert.ok(keys.has(k), `${id} is missing ${k}`);
    }
  }
});

test('every prerequisite resolves inside its own template', () => {
  for (const id of ['math-4u', 'math-5u']) {
    const t = templateById(id);
    const keys = keysOf(t);
    for (const skill of skillsOf(t)) {
      for (const req of skill.requires ?? []) {
        assert.ok(keys.has(req), `${id}: ${skill.key} requires ${req}, which is absent from this track`);
      }
    }
  }
});

test('the four-unit tree is smaller than the five-unit one, and neither is trivial', () => {
  const four = skillsOf(templateById('math-4u')).length;
  const five = skillsOf(templateById('math-5u')).length;
  assert.ok(four >= 40, `4u has only ${four} skills`);
  assert.ok(five > four, `5u (${five}) must cover more than 4u (${four})`);
});

test('every grade a shipped template declares is a real booking-form option', () => {
  // The booking form's grade <select> and each template's `grades` list are
  // maintained independently. If a grade is renamed on one side and not the
  // other, matching silently breaks for every student of that grade — this
  // test is the only thing standing between that rename and a green suite.
  const bookingGrades = bookingGradeOptions();
  for (const t of loadTemplates()) {
    for (const grade of t.grades ?? []) {
      assert.ok(
        bookingGrades.includes(grade),
        `template ${t.id}: grade "${grade}" is not one of the booking form's grade options (${bookingGrades.join(', ')})`,
      );
    }
  }
});

test('both shipped math templates declare that they are high-school-only', () => {
  // Bagrut tracks (4/5 units) only mean anything in high school — a grade
  // below that can never fit either template.
  const highSchool = ['כיתה י', 'כיתה יא', 'כיתה יב'];
  for (const id of ['math-4u', 'math-5u']) {
    assert.deepEqual(templateById(id).grades, highSchool, id);
  }
});
