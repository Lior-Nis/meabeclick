/**
 * The tutor half of the pre-launch polish list, 2026-09-28 (Todoist
 * 6hfCvVxgRmq8h2fq): a session that ran out read as an English
 * "unauthorized" or as a save that failed, the calendar banner spoke in
 * error codes and UTC, the dashboard explained its own plumbing, the tutor
 * was addressed as a man, a woman and a group, one button led nowhere, and
 * five tabs did not fit a phone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f) => readFileSync(join(process.cwd(), f), 'utf8');
const dash = () => read('src/routes/app/dashboard/+page.svelte');
const S = await import('../../src/lib/tutor-session.ts');
const C = await import('../../src/lib/calendar-words.ts');

test('a 401 says once that the sign-in ran out; any other answer passes through untouched', async () => {
  let told = 0;
  const statuses = [200, 401, 401, 500];
  const session = S.sessionAware(async () => new Response('{}', { status: statuses.shift() }), () => { told++; });
  assert.equal(session.over, false);
  assert.equal((await session.fetch('/a')).status, 200);
  assert.equal((await session.fetch('/b')).status, 401);
  assert.equal(session.over, true);
  await session.fetch('/c');
  assert.equal((await session.fetch('/d')).status, 500);
  assert.equal(told, 1, 'said once, not per request');
});

test('the dashboard asks through the session-aware fetch, and holds the error toasts it would explain', () => {
  const d = dash();
  assert.doesNotMatch(d, /\bfetch\(['`"]/, 'every request goes through api()');
  assert.match(d, /sessionAware\(/);
  assert.match(d, /\/login\?next=\/app\/dashboard/);
  assert.match(d, /if \(session\.over && kind === 'error' && !opts\.link\) return;/);
  // A tint alone let the header show through the message.
  assert.match(d, /\.toast\.error\s+\{[^}]*background: linear-gradient\([^}]*\), var\(--bg-card\)/);
});

test('a calendar that could not be read is explained in words, at Israel time', () => {
  assert.equal(C.readIssueWords('timeout'), 'היומן לא ענה בזמן');
  assert.match(C.readIssueWords('HTTP 404'), /לא נמצא/);
  assert.match(C.readIssueWords('HTTP 403'), /אין הרשאה/);
  assert.match(C.readIssueWords('HTTP 500'), /שגיאה/);
  assert.match(C.readIssueWords('parse error'), /פורמט/);
  assert.equal(C.readIssueWords('שגיאת קריאה'), 'שגיאת קריאה');
  const d = dash();
  assert.match(d, /readIssueWords\(s\.reason\)/);
  assert.match(d, /formatDateTime\(s\.at\)/);
  assert.doesNotMatch(d, /String\(s\.at\)\.slice/);
});

test('the dashboard does not explain its plumbing', () => {
  const d = dash();
  for (const jargon of ['נטענים מההזמנות שבשרת', 'קוד אישי', 'ייבוא לשרת', 'בשרת:', 'רק בדפדפן הזה']) {
    assert.ok(!d.includes(jargon), `«${jargon}»`);
  }
});

test('the tutor is addressed one way: in the plural, as the rest of the site speaks', () => {
  assert.doesNotMatch(dash(), /לחץ "|שיחק לאחרונה/);
  assert.doesNotMatch(read('src/routes/app/plan/[code]/+page.svelte'), /בחרי|עדכני/);
});

test('no button leads the tutor to a page that sends her away', () => {
  assert.doesNotMatch(dash(), /href="\/app\/parent"/);
});

test('five tabs fit a phone: the row scrolls, and says which tab is open', () => {
  const d = dash();
  assert.match(d, /\.sc-tabs \{[^}]*overflow-x: auto/);
  assert.match(d, /class="sc-tabs" role="tablist"/);
  assert.match(d, /aria-selected=\{tabFor\(s\.code\) === 'overview'\}/);
});
