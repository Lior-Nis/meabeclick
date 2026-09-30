// tests/characterization/how-it-works.test.mjs
//
// The FAQ gave way to «איך זה עובד?» (Todoist 6hfrX4W5mfXVmG5H): five steps
// from booking to following progress, then a short FAQ of the three things
// a parent still asks — length, payment, online or in person.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startServer } from './harness.mjs';

const STEPS = ['קובעים שיעור', 'מבינים את הרמה והקושי', 'בונים תכנית אישית', 'מתרגלים ומתקדמים', 'עוקבים אחרי ההתקדמות'];

test('the home page explains how it works, in five steps, then answers three questions', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const html = await (await fetch(`${baseUrl}/`)).text();
    const how = html.match(/<section id="how-it-works"[\s\S]*?<\/section>/)?.[0];
    assert.ok(how, 'the section is on the page');
    assert.match(how, /איך זה עובד\?/);
    const ol = how.match(/<ol[\s\S]*?<\/ol>/)?.[0] ?? '';
    const at = STEPS.map(s => ol.indexOf(s));
    assert.ok(at.every(i => i >= 0), `every step, in the list: ${at}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in order');
    assert.match(how, /href="\/booking"/, 'it ends where the reader can act on it');

    const questions = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map(m => m[1].replace(/<[^>]+>/g, '').trim());
    assert.deepEqual(questions.map(q => q.replace(/\s*\+$/, '')), ['מה משך השיעור?', 'איך מתבצע התשלום?', 'השיעורים פנים מול פנים או אונליין?']);
    assert.doesNotMatch(html, /שאלות נפוצות/, 'the old section title is gone');
  } finally { await stop(); }
});

test('the questions open with the keyboard, and the menu points at the new section', () => {
  const page = readFileSync(join(process.cwd(), 'src/routes/+page.svelte'), 'utf8');
  assert.doesNotMatch(page, /faq-question/, 'no click-only divs');
  assert.match(page, /<details class="faq-item"/);
  const header = readFileSync(join(process.cwd(), 'src/lib/components/Header.svelte'), 'utf8');
  assert.match(header, /scrollToSection\('how-it-works'\)\}><Icon name="faq" size=\{18\} \/> איך זה עובד<\/button>/);
});
