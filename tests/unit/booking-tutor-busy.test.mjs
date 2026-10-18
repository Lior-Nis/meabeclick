// tests/unit/booking-tutor-busy.test.mjs
//
// After TUTOR_BUSY the page keeps what the family typed, shows only their
// tutor's hours, and says why (spec D3). The rendered flow is checked in a
// browser before merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../../src/routes/booking/+page.svelte', import.meta.url), 'utf8');

test("TUTOR_BUSY keeps the form, closes the sheet and reloads only their tutor's hours", () => {
  const at = page.indexOf("data.code === 'TUTOR_BUSY'");
  assert.ok(at > 0, 'the page knows the answer');
  const branch = page.slice(at, at + 700);
  assert.match(branch, /tutorFilter = data\.tutorId/);
  assert.match(branch, /closeSheet\(\)/);
  assert.match(branch, /loadSlots\(\)/);
  assert.doesNotMatch(branch, /(name|email|phone) = ''/, 'nothing they typed is cleared');
});

test('the hours ask for that tutor, and the page says whose they are', () => {
  assert.match(page, /&tutor=\$\{tutorFilter\}/);
  assert.match(page, /\{#if slotNotice\}/);
});
