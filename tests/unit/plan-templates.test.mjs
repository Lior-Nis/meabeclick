import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate } from '../../src/lib/server/plans/templates.ts';

/** A minimal valid template; each test bends one thing out of shape. */
const good = () => ({
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל',
  reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון דיפרנציאלי',
    branches: [{
      key: 'calc.rules', title: 'כללי גזירה',
      skills: [
        { key: 'calc.rules.power', title: 'נגזרת של חזקה', requires: [] },
        { key: 'calc.rules.quotient', title: 'נגזרת של מנה', requires: ['calc.rules.power'] },
      ],
    }],
  }],
});

test('a well-formed template has no errors', () => {
  assert.deepEqual(validateTemplate(good()), []);
});

test('every node needs a key and a title', () => {
  const t = good();
  delete t.topics[0].branches[0].skills[0].title;
  assert.match(validateTemplate(t).join(' '), /title/);
});

test('keys must be unique across the whole tree', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].key = 'calc.rules.power';
  assert.match(validateTemplate(t).join(' '), /calc\.rules\.power/);
});

test('a prerequisite must name a skill that exists', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].requires = ['calc.rules.nope'];
  assert.match(validateTemplate(t).join(' '), /calc\.rules\.nope/);
});

test('a prerequisite may not point at a topic or a branch', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].requires = ['calc.rules'];
  assert.match(validateTemplate(t).join(' '), /calc\.rules/);
});

test('prerequisite cycles are rejected', () => {
  const t = good();
  t.topics[0].branches[0].skills[0].requires = ['calc.rules.quotient'];
  assert.match(validateTemplate(t).join(' ').toLowerCase(), /cycle/);
});

test('a branch with no skills is a mistake, not an empty tree', () => {
  const t = good();
  t.topics[0].branches[0].skills = [];
  assert.ok(validateTemplate(t).length > 0);
});

test('reviewed is either null or a by/date pair', () => {
  const t = good();
  t.reviewed = { by: 'ניקול' };
  assert.match(validateTemplate(t).join(' '), /reviewed/);
  t.reviewed = { by: 'ניקול', date: '2026-09-20' };
  assert.deepEqual(validateTemplate(t), []);
});

test('a non-object is reported rather than thrown over', () => {
  assert.ok(validateTemplate(null).length > 0);
  assert.ok(validateTemplate('{}').length > 0);
});
