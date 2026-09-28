/**
 * The family-facing part of the pre-launch polish list, 2026-09-28
 * (Todoist 6hfCvVxgRmq8h2fq): dates a day behind after 21:00, a child
 * greeted by full name, a raw path for a parent to type, a typo, a label
 * said twice, a 0% bar beside "nothing to measure yet", and back arrows
 * that pointed both ways.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const D = await import('../../src/lib/dates.ts');
const N = await import('../../src/lib/names.ts');

function sources(dir = 'src') {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.(ts|svelte)$/.test(p) ? [p] : [];
  });
}

test("today is Israel's day, not UTC's: 00:30 on the 29th is the 29th", () => {
  assert.equal(D.israelToday(new Date('2026-09-28T21:30:00Z')), '2026-09-29');
  assert.equal(D.israelToday(new Date('2026-12-28T21:30:00Z')), '2026-12-28', 'winter: UTC+2, still the 28th');
});

test('no date a person reads is cut from a UTC timestamp', () => {
  // calendar.ts keys recurrence overrides by the UTC instant, which is what
  // node-ical keys them by; it is never shown.
  const allowed = new Set([join('src', 'lib', 'server', 'calendar.ts')]);
  const offenders = sources().filter((f) => !allowed.has(f)).filter((f) => {
    const s = read(f);
    return /toISOString\(\)\.slice\(0, ?10\)|toISOString\(\)\.split\('T'\)\[0\]|assigned_at\??\.slice\(0, ?10\)/.test(s);
  });
  assert.deepEqual(offenders, []);
});

test("the Israel date is formatted in one place: payments.ts borrows it", () => {
  assert.doesNotMatch(read('src/lib/server/payments.ts'), /Asia\/Jerusalem/);
});

test('a child is greeted by first name', () => {
  assert.equal(N.firstName('נוגה כהן'), 'נוגה');
  assert.equal(N.firstName('  אלון  '), 'אלון');
  assert.equal(N.firstName(''), '');
  assert.match(read('src/routes/app/student/+page.svelte'), /היי \$\{firstName\(DATA\.name\)\}!/);
});

test('a parent without WhatsApp is given an address to type, not a path', () => {
  const p = read('src/routes/app/parent/+page.svelte');
  assert.doesNotMatch(p, /ב-<span dir="ltr">\/portal<\/span>/);
  assert.match(p, /<span dir="ltr">\{page\.url\.host\}\/portal<\/span>/);
});

test('small copy: «לתיאום», and the next lesson is named once', () => {
  for (const f of sources()) assert.doesNotMatch(read(f), /לתאום/, f);
  assert.doesNotMatch(read('src/routes/app/parent/+page.svelte'), />שיעור הבא</);
});

test('no 0% bar beside "nothing to measure yet"', () => {
  const p = read('src/routes/app/parent/+page.svelte');
  const guard = p.indexOf('{#if CURRENT.progress?.total}');
  assert.ok(guard > 0, 'the bar is behind a total');
  assert.ok(guard < p.indexOf('class="bar-bg"') && guard < p.indexOf('class="po-pct"'));
});

test('every «חזרה» link points the same way: → first, as a right-to-left page reads back', () => {
  for (const f of sources()) {
    const s = read(f);
    assert.doesNotMatch(s, /← ?חזרה/, f);
    assert.doesNotMatch(s, /חזרה[^<>{}]*→/, f);
  }
});
