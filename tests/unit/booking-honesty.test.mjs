/**
 * What a family is told around booking — pre-launch review, 2026-09-28
 * (Todoist 6hfCvXwG38gr8C5q), the parts that need no business decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const booking = read('src/routes/booking/+page.svelte');
const parent = read('src/routes/app/parent/+page.svelte');

test('times that failed to load are not presented as "no free times", and can be retried', () => {
  assert.match(booking, /slotState = 'error'/);
  assert.match(booking, /\{:else if slotState === 'error'\}/);
  assert.match(booking, /onclick=\{loadSlots\}/);
  assert.match(booking, /לא הצלחנו לטעון את השעות/);
});

test('a slot taken meanwhile refreshes the list rather than leaving a stale one', () => {
  const at = booking.indexOf('res.status === 409');
  assert.match(booking.slice(at, at + 300), /loadSlots\(\)/);
});

test('a failed save offers the WhatsApp it tells them to use', () => {
  assert.match(booking, /\{#if submitFailed\}<a class="wa-link"/);
});

test('"booked" only when the calendar confirmed the time; otherwise "received"', () => {
  assert.match(booking, /bookedUnconfirmed \? 'הבקשה התקבלה!' : 'השיעור נקבע!'/);
  assert.match(booking, /slotState === 'unconfirmed' \|\| !!data\.fallback/);
});

test('no gendered sentence about the tutor on the booking page', () => {
  assert.doesNotMatch(booking, /\.name\} (תיצור|תאשר|מאשרת|תחזור|תשלח)|ש\{contactTutor\(\)\.name\} מאשרת/);
});

test('the parent can ask, move or cancel a lesson from their page', () => {
  assert.match(parent, /שאלה, שינוי או ביטול/);
  assert.match(parent, /wa\.me\/\$\{TUTOR_PHONE\}/);
});
