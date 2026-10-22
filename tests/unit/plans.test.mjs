import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, kindFor, formatAgorot, agorot } from '../../src/lib/plans.ts';

test('every plan carries the kind the payments table expects', () => {
  assert.deepEqual(PLANS.map(p => p.kind), ['single', 'double', 'triple']);
});

test('kindFor maps the three lesson lengths', () => {
  assert.equal(kindFor(45), 'single');
  assert.equal(kindFor(90), 'double');
  assert.equal(kindFor(135), 'triple');
});

test('kindFor returns null for a length that is not a plan', () => {
  // A caller must not be able to invent a kind the CHECK constraint
  // would reject at insert time, far from the mistake.
  assert.equal(kindFor(60), null);
  assert.equal(kindFor('90'), 'double', 'a numeric string is still a plan');
  assert.equal(kindFor(undefined), null);
});

test('formatAgorot prints whole shekels without decimals', () => {
  assert.equal(formatAgorot(21500), '₪215');
  assert.equal(formatAgorot(0), '₪0');
});

test('formatAgorot shows agorot only when they are non-zero', () => {
  assert.equal(formatAgorot(21550), '₪215.50');
  assert.equal(formatAgorot(21505), '₪215.05');
});

test('formatAgorot handles a negative balance', () => {
  assert.equal(formatAgorot(-12000), '-₪120');
});

test('agorot converts shekels without floating point drift', () => {
  assert.equal(agorot(215), 21500);
  assert.equal(agorot(120.5), 12050);
});

test('exactly one plan is recommended, and it is the 90-minute כפול', async () => {
  // The vision's revenue target (PRODUCT.md, "Ninety minutes by default")
  // rests on steering families to כפול. The flag lives here so the landing
  // page and the booking page cannot recommend different lessons.
  const { RECOMMENDED_BADGE } = await import('../../src/lib/plans.ts');
  const recommended = PLANS.filter(p => p.recommended);
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].minutes, 90);
  assert.equal(recommended[0].name, 'כפול');
  assert.equal(recommended[0].shekels, 215);
  assert.equal(RECOMMENDED_BADGE, '⭐ מומלץ');
});

test('the כפול card description is unchanged and invents no stat', () => {
  const recommended = PLANS.find(p => p.recommended);
  assert.equal(recommended.description, 'רצף, התקדמות, וזמן לשיעורי הבית');
  assert.doesNotMatch(recommended.description, /הכי פופולרי|רוב המשפחות|%|לקוחות|שעה וחצי בשבוע/);
});

test('prices, lengths, and slide counts are unchanged', () => {
  assert.deepEqual(
    PLANS.map(p => [p.minutes, p.shekels, p.slides, p.kind, p.duration]),
    [
      [45, 120, 8, 'single', '45 דקות'],
      [90, 215, 11, 'double', 'שעה וחצי'],
      [135, 300, 14, 'triple', 'שעתיים ורבע'],
    ],
  );
});
