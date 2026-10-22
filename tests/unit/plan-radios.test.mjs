// Keyboard movement for the booking plan radiogroup. The page is RTL, so
// Left moves to the next plan in reading order and Right moves back.
// Up and Down do not flip: the cards stack top to bottom on a phone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planRadioMove } from '../../src/lib/plan-radios.ts';

const booking = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src/routes/booking/+page.svelte'),
  'utf8',
);

// DOM order is the reading order: יחיד, כפול, משולש.
const COUNT = 3;

test('RTL: Left is next and Right is previous, wrapping at both ends', () => {
  assert.equal(planRadioMove(0, 'ArrowLeft', true, COUNT), 1);
  assert.equal(planRadioMove(1, 'ArrowLeft', true, COUNT), 2);
  assert.equal(planRadioMove(2, 'ArrowLeft', true, COUNT), 0);
  assert.equal(planRadioMove(0, 'ArrowRight', true, COUNT), 2);
  assert.equal(planRadioMove(1, 'ArrowRight', true, COUNT), 0);
  assert.equal(planRadioMove(2, 'ArrowRight', true, COUNT), 1);
});

test('LTR keeps Right as next and Left as previous', () => {
  assert.equal(planRadioMove(0, 'ArrowRight', false, COUNT), 1);
  assert.equal(planRadioMove(0, 'ArrowLeft', false, COUNT), 2);
  assert.equal(planRadioMove(2, 'ArrowRight', false, COUNT), 0);
});

test('Up and Down follow the vertical stack in either direction', () => {
  for (const rtl of [true, false]) {
    assert.equal(planRadioMove(1, 'ArrowDown', rtl, COUNT), 2);
    assert.equal(planRadioMove(1, 'ArrowUp', rtl, COUNT), 0);
    assert.equal(planRadioMove(0, 'ArrowUp', rtl, COUNT), 2);
    assert.equal(planRadioMove(2, 'ArrowDown', rtl, COUNT), 0);
  }
});

test('Enter, Space and Tab are not arrow movement', () => {
  for (const key of ['Enter', ' ', 'Tab', 'Home', 'a']) {
    assert.equal(planRadioMove(1, key, true, COUNT), null);
  }
});

test('the booking cards are radios with a roving tabindex, not toggle buttons', () => {
  const cards = booking.slice(booking.indexOf('id="step-duration"'), booking.indexOf('id="step-slots"'));
  assert.match(cards, /role="radiogroup"/);
  assert.match(cards, /aria-label="סוג שיעור"/);
  assert.match(cards, /role="radio"/);
  assert.match(cards, /aria-checked=\{selectedPlan\?\.minutes === plan\.minutes\}/);
  assert.match(cards, /tabindex=\{/);
  assert.match(booking, /planRadioMove/);
  assert.match(booking, /planCards\[next\]\?\.focus\(\)/);
  assert.doesNotMatch(cards, /aria-pressed/);
  assert.match(cards, /class="dur-icon" aria-hidden="true"/);
  assert.match(cards, /class="dur-chosen" aria-hidden="true"/);
});
