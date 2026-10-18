// tests/characterization/student-tutor-picker.test.mjs
//
// The student card's tutor picker says which tutors cannot take bookings
// yet, and never shows a deactivated tutor's student as someone else's.
// Found in the per-tutor booking review, 2026-10-18.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const markup = (h) => h.split(/<script nonce=/)[0];
const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'דנה', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'dana@example.com', durationMin: 90, start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00' }),
});
function run(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath);
  try { db.prepare(sql).run(...params); } finally { db.close(); }
}
const pickerOf = (page) => page.match(/<select id="pf-tutor-[^"]+"[\s\S]*?<\/select>/)?.[0] ?? '';

test('a tutor who cannot take bookings yet is labelled in the picker', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    await book(baseUrl);
    const picker = pickerOf(markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie: await login(baseUrl) } })).text()));
    assert.match(picker, /ליאור \(עוד לא מקבל\/ת הזמנות\)/);
    assert.doesNotMatch(picker, /ניקול \(/, 'Nikol takes bookings: her name alone');
  } finally { await stop(); }
});

test("a student whose tutor was deactivated shows that, not another tutor's name", async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    await book(baseUrl);
    run(dbPath, `INSERT INTO teachers (name, phone, active) VALUES ('לשעבר', NULL, 0)`);
    run(dbPath, `UPDATE enrollments SET teacher_id = (SELECT id FROM teachers WHERE name = 'לשעבר')`);
    const picker = pickerOf(markup(await (await fetch(`${baseUrl}/app/dashboard`, { headers: { cookie: await login(baseUrl) } })).text()));
    assert.match(picker, /<option value="" selected[^>]*>— מורה שכבר לא פעיל\/ה —<\/option>/);
    assert.doesNotMatch(picker, /<option value="\d+" selected/, 'no active tutor is shown as theirs');
  } finally { await stop(); }
});

test('a failed move puts the picker back on the tutor actually saved', () => {
  const page = readFileSync(new URL('../../src/routes/app/dashboard/+page.svelte', import.meta.url), 'utf8');
  const fn = page.slice(page.indexOf('async function moveStudent'), page.indexOf('let codesLoading'));
  assert.match(fn, /select\.value = /, 'the select is reset when the move fails');
  assert.equal((fn.match(/select\.value = /g) ?? []).length >= 1, true);
  assert.match(fn, /עוד לא מקבל\/ת הזמנות/, 'moving to a tutor without settings warns');
});
