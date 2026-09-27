// The prompt endpoint is the first thing in this codebase that a machine
// calls rather than a person, so what it checks at the door matters more
// than what it sends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

const CRON_KEY = 'test-cron-key';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

/** Ages the booking to two hours ago, relative to the running clock. */
async function ageLesson(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath);
  const end = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const start = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE bookings_v2 SET start = ?, "end" = ?`).run(start, end);
  db.close();
}

const prompt = (baseUrl, key) => fetch(`${baseUrl}/api/reports/prompt`, {
  method: 'POST', headers: key ? { 'X-Cron-Key': key } : {},
});

test('the prompt endpoint refuses anyone without the key', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    assert.equal((await prompt(baseUrl, null)).status, 401);
    assert.equal((await prompt(baseUrl, 'wrong')).status, 401);
    // A tutor session is not a substitute: this endpoint is for the timer.
    const cookie = await login(baseUrl);
    const asTutor = await fetch(`${baseUrl}/api/reports/prompt`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(asTutor.status, 401);
  } finally { await stop(); }
});

test('with no key configured the endpoint is closed, not open', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    assert.equal((await prompt(baseUrl, null)).status, 401);
    assert.equal((await prompt(baseUrl, '')).status, 401);
  } finally { await stop(); }
});

test('an unsent prompt (no mail transport in this harness) is retried next run, not forgotten', async () => {
  // This pins the RETRY path, not dedup: the harness has no mail
  // credentials, so sendReportPromptEmail always fails here and
  // markPrompted is never called — meaning the lesson is considered again
  // on the second call. This file cannot exercise the dedup path (a
  // successful send marking the lesson prompted so it is NOT considered
  // again) at all; that is covered by report-store.test.mjs's "a lesson is
  // offered for prompting once" (R.markPrompted + R.promptCandidates),
  // which does not depend on a real mail send.
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl);
    await ageLesson(dbPath);

    const first = await (await prompt(baseUrl, CRON_KEY)).json();
    assert.equal(first.considered, 1);
    // No mail credentials in the harness, so nothing is actually sent and
    // the lesson is NOT marked — it must still be considered next time.
    assert.equal(first.emailed, 0);
    assert.equal(first.skipped, 1);

    const second = await (await prompt(baseUrl, CRON_KEY)).json();
    assert.equal(second.considered, 1, 'an unsent prompt is retried, not forgotten');
  } finally { await stop(); }
});

test('a lesson that has not finished is never considered', async () => {
  const { baseUrl, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl); // 2027, untouched
    assert.equal((await (await prompt(baseUrl, CRON_KEY)).json()).considered, 0);
  } finally { await stop(); }
});

test('a reported lesson is never chased', async () => {
  const { baseUrl, dbPath, stop } = await startServer({ env: { CRON_KEY } });
  try {
    await book(baseUrl);
    await ageLesson(dbPath);
    const cookie = await login(baseUrl);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const bookingId = Number(db.prepare(`SELECT id FROM bookings_v2 ORDER BY id DESC LIMIT 1`).get().id);
    db.close();

    await fetch(`${baseUrl}/api/reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ bookingId, note: 'דווח', entries: [] }),
    });

    assert.equal((await (await prompt(baseUrl, CRON_KEY)).json()).considered, 0);
  } finally { await stop(); }
});
