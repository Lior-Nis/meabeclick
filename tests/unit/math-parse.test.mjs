/**
 * The maths notation the student chat accepts, and everything it refuses.
 *
 * The parser's job is as much refusal as acceptance: anything it does not
 * fully understand must fail so the caller can show the original text.
 * Rendering half an equation is worse than rendering none, because half an
 * equation is wrong rather than ugly, and a child cannot tell.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseMath, splitMath } = await import('../../src/lib/math/parse.ts');

const ok = (src) => {
  const r = parseMath(src);
  assert.notEqual(r, null, `expected ${src} to parse`);
  return r;
};
const rejects = (src) => assert.equal(parseMath(src), null, `expected ${src} to be refused`);

test('the five constructs the task names all parse', () => {
  ok('\\frac{1}{2}');                 // fraction
  ok('x^{2}');                        // power
  ok('\\sqrt{16}');                   // root
  ok('2x + 3 = 11');                  // equation
  ok('a_{1} + a_{2}');                // indexed sequence of steps
});

test('a fraction keeps numerator and denominator apart', () => {
  const [node] = ok('\\frac{3}{4}');
  assert.equal(node.k, 'frac');
  assert.deepEqual(node.num, [{ k: 'text', v: '3' }]);
  assert.deepEqual(node.den, [{ k: 'text', v: '4' }]);
});

test('a power attaches to what precedes it, not to the whole line', () => {
  const nodes = ok('2x^{3}');
  const sup = nodes.find(n => n.k === 'sup');
  assert.ok(sup);
  assert.deepEqual(sup.exp, [{ k: 'text', v: '3' }]);
});

test('nesting works, and Hebrew may appear inside a formula', () => {
  ok('\\frac{\\sqrt{x}}{2}');
  ok('\\frac{1}{\\frac{1}{2}}');
  ok('שטח = \\frac{בסיס \\cdot גובה}{2}');
});

test('single-character arguments need no braces', () => {
  ok('x^2');
  ok('\\sqrt2');
  ok('a_1');
});

test('an unknown command fails the whole formula', () => {
  // This is the security property, not a nicety: the accepted set is a
  // list, so nothing outside it can be reached by construction.
  rejects('\\includegraphics{x}');
  rejects('\\html{a}');
  rejects('\\unknown');
  rejects('\\href{javascript:alert(1)}{x}');
});

test('unbalanced or stray braces fail', () => {
  rejects('\\frac{1}{2');
  rejects('{1');
  rejects('1}');
  rejects('\\frac{1}');
});

test('a character outside the allowed set fails', () => {
  rejects('a & b');
  rejects('100%');
  rejects('x → y');
  rejects('a ~ b');
});

test('angle brackets stay allowed, because an inequality needs them', () => {
  ok('x < 5');
  ok('3 > 2');
});

test('markup-shaped input can only ever become text', () => {
  /* `<` and `>` are legitimate maths, so this parses — and that is fine,
     because the notation has no construct that produces an element. The
     property worth pinning is that every node here is a text node: the
     renderer builds from this tree, so if nothing but text can be in it,
     nothing but text can come out, whatever the model was talked into
     emitting. */
  const nodes = parseMath('<script>alert(1)</script>');
  assert.notEqual(nodes, null);

  const kinds = new Set();
  const walk = (list) => {
    for (const n of list) {
      kinds.add(n.k);
      for (const key of ['num', 'den', 'body', 'exp', 'idx']) {
        if (Array.isArray(n[key])) walk(n[key]);
      }
      if (n.base) walk([n.base]);
    }
  };
  walk(nodes);
  assert.deepEqual([...kinds], ['text'], 'only text nodes, so only text can be rendered');
});

test('a dangling exponent with nothing to attach to fails', () => {
  rejects('^{2}');
  rejects('_{1}');
});

test('the parser is total — no input throws', () => {
  const nasty = ['', '\\', '\\\\', '{'.repeat(50), '^'.repeat(50), '\\frac'.repeat(20), String.fromCharCode(0)];
  for (const s of nasty) {
    assert.doesNotThrow(() => parseMath(s), `threw on ${JSON.stringify(s)}`);
  }
});

test('nesting deeper than the cap is refused rather than recursed', () => {
  const deep = '\\frac{1}{'.repeat(40) + '2' + '}'.repeat(40);
  assert.equal(parseMath(deep), null);
});

test('splitMath separates prose from formulas and keeps the source', () => {
  const segs = splitMath('נחשב \\(\\frac{1}{2}\\) ואז נמשיך');
  assert.equal(segs.length, 3);
  assert.equal(segs[0].math, null);
  assert.equal(segs[0].raw, 'נחשב ');
  assert.ok(segs[1].math, 'the middle segment is a formula');
  assert.equal(segs[1].raw, '\\frac{1}{2}', 'the source is kept for copying and fallback');
  assert.equal(segs[2].raw, ' ואז נמשיך');
});

test('a formula that does not parse becomes readable text, not a broken render', () => {
  const segs = splitMath('בדקו \\(\\includegraphics{x}\\) כאן');
  const bad = segs.find(s => s.raw === '\\includegraphics{x}');
  assert.ok(bad);
  assert.equal(bad.math, null, 'refused, and handed back as its own source');
});

test('an unterminated formula opener is prose, not something that eats the rest', () => {
  const text = 'הנה \\( בלי סוגר';
  const segs = splitMath(text);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].math, null);
  assert.equal(segs[0].raw, text, 'the whole answer survives intact');
});

test('an answer with no formulas is one plain segment', () => {
  const segs = splitMath('בוקר טוב, איך אפשר לעזור?');
  assert.deepEqual(segs, [{ math: null, raw: 'בוקר טוב, איך אפשר לעזור?' }]);
});
