import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate, templateFitsLevel } from '../../src/lib/server/plans/templates.ts';

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
      ],
    }],
  }],
});

// ── templateFitsLevel ───────────────────────────────────────────────────

test('a template with grades fits a listed grade', () => {
  const t = { ...good(), grades: ['כיתה י', 'כיתה יא'] };
  assert.equal(templateFitsLevel(t, 'כיתה י'), true);
});

test('a template with grades does not fit an unlisted grade', () => {
  const t = { ...good(), grades: ['כיתה י', 'כיתה יא'] };
  assert.equal(templateFitsLevel(t, 'כיתה ח'), false);
});

test('a template with no grades fits anything, including null', () => {
  const t = good();
  assert.equal(templateFitsLevel(t, 'כיתה ח'), true);
  assert.equal(templateFitsLevel(t, null), true);
  assert.equal(templateFitsLevel(t, ''), true);
});

test('a null or empty level does not fit a template that declares grades', () => {
  const t = { ...good(), grades: ['כיתה י'] };
  assert.equal(templateFitsLevel(t, null), false);
  assert.equal(templateFitsLevel(t, ''), false);
});

test('leading and trailing whitespace in the level is tolerated', () => {
  const t = { ...good(), grades: ['כיתה י'] };
  assert.equal(templateFitsLevel(t, '  כיתה י  '), true);
});

test('a grades entry with surrounding whitespace still fits the clean level', () => {
  // A copy-pasted grade like "כיתה ז " (trailing space) validates fine, but
  // must not silently stop matching a student whose level is the clean
  // "כיתה ז" — that would bring back the exact mismatch this branch removes.
  const t = { ...good(), grades: ['כיתה ז '] };
  assert.equal(templateFitsLevel(t, 'כיתה ז'), true);
});

// ── validateTemplate: grades ─────────────────────────────────────────────

test('a valid grades array is accepted', () => {
  const t = { ...good(), grades: ['כיתה י', 'כיתה יא', 'כיתה יב'] };
  assert.deepEqual(validateTemplate(t), []);
});

test('no grades field at all is accepted (unconstrained)', () => {
  assert.deepEqual(validateTemplate(good()), []);
});

test('an empty grades array is rejected', () => {
  const t = { ...good(), grades: [] };
  assert.match(validateTemplate(t).join(' '), /grades/);
});

test('a grades value that is not an array is rejected', () => {
  const t = { ...good(), grades: 'כיתה י' };
  assert.match(validateTemplate(t).join(' '), /grades/);
});

test('a grades array containing an empty string is rejected', () => {
  const t = { ...good(), grades: ['כיתה י', ''] };
  assert.match(validateTemplate(t).join(' '), /grades/);
});
