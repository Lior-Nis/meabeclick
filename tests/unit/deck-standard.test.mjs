/**
 * The lesson deck as a teaching standard — Todoist 6hRhqRXHcGj9m98H, steps
 * 3-5. Colours and font already come from brand.ts (#107); this is the
 * order of the lesson, the formulas, and what a child sees before trying.
 *
 * Before: the plan's slides, then the examples — so the closing «סיכום»
 * came before the worked examples; every formula was laid out in the
 * paragraph's right-to-left direction ("8-(x+3)" as ")x+3(-8"); and each
 * example showed its answer before anyone had tried.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderSlides } = await import('../../src/lib/server/lesson/prep.ts');

const plan = (over = {}) => ({
  title: 'משוואות',
  gradeContext: 'כיתה ח',
  slides: [
    { heading: 'מה נלמד היום?', bullets: ['פותרים 2x + 3 = 11'] },
    { heading: 'פתיחת סוגריים', bullets: ['8-(x+3) הוא 5-x'], note: 'שימו לב למינוס' },
    { heading: 'סיכום: מתכון לפתרון', bullets: ['בודקים בהצבה'] },
  ],
  examples: [{ problem: 'פתרו 2(x + 4) = 18', steps: ['2x + 8 = 18', '2x = 10'], answer: 'x = 5' }],
  homework: [],
  games: { quiz: { title: 'חידון', subject: '', questions: [
    { q: 'כמה זה 3(x - 2) כש-x=4?', options: ['6', '10', '2'], answer: 0, why: '3·2=6', hint: '' },
  ] } },
  ...over,
});

const html = (p = plan()) => renderSlides(p, { subject: 'מתמטיקה', level: 'כיתה ח' });
const headings = (h) => [...h.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));

test('the lesson runs explanation → worked example → check yourself → summary', () => {
  assert.deepEqual(headings(html()), ['מה נלמד היום?', 'פתיחת סוגריים', 'דוגמה 1', 'בדקו את עצמכם', 'סיכום: מתכון לפתרון']);
});

test('a deck with no summary slide keeps its slides in order and ends with the check', () => {
  const p = plan({ slides: plan().slides.slice(0, 2) });
  assert.deepEqual(headings(html(p)), ['מה נלמד היום?', 'פתיחת סוגריים', 'דוגמה 1', 'בדקו את עצמכם']);
});

test('no quiz, no check slide — nothing is invented', () => {
  assert.ok(!headings(html(plan({ games: {} }))).includes('בדקו את עצמכם'));
});

test('every formula keeps its own left-to-right direction, in bullets, examples and the check', () => {
  const h = html();
  for (const f of ['2x + 3 = 11', '8-(x+3)', '2(x + 4) = 18', '2x + 8 = 18', 'x = 5', '3(x - 2)']) {
    assert.ok(h.includes(`<bdi dir="ltr">${f}</bdi>`), f);
  }
});

test("an example's steps and answer wait behind «הצגת הפתרון»; the problem does not", () => {
  const ex = html().split('<h2>דוגמה 1</h2>')[1].split('</section>')[0];
  const [before, after] = ex.split('<details');
  assert.match(before, /פתרו/);
  assert.match(after, /<summary>הצגת הפתרון<\/summary>/);
  assert.match(after, /2x = 10/);
  assert.match(after, /class="answer"/);
});

test('the check asks the first quiz question and keeps its answer closed', () => {
  const check = html().split('<h2>בדקו את עצמכם</h2>')[1].split('</section>')[0];
  const [before, after] = check.split('<details');
  assert.match(before, /כמה זה/);
  assert.match(before, /<li>(<bdi dir="ltr">)?10(<\/bdi>)?<\/li>/, 'the options are shown');
  assert.match(after, /<summary>הצגת התשובה<\/summary>/);
  assert.match(after, /3·2=6/, 'with its why');
});

test('printing opens every closed solution, and the numbering counts every slide', () => {
  const h = html();
  assert.match(h, /beforeprint/);
  assert.ok(h.includes('5 / 5'));
  assert.ok(!h.includes('/ 4<'), 'no stale total');
});

test('the data is still escaped inside a formula', () => {
  const p = plan({ slides: [{ heading: 'x', bullets: ['<script>alert(1)</script> 2x+1=3'] }] });
  const h = html(p);
  assert.ok(!h.includes('<script>alert(1)'));
  assert.equal(h.match(/<script/g).length, 1, "only the deck's own script tag");
  assert.match(h, /alert\(1\)&lt;\/script&gt;/);
});

test('a screen reader hears which slide it is on', () => {
  assert.match(html(), /aria-live="polite"/);
});
