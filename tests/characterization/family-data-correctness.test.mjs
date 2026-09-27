// What a family and the tutor are shown, checked against what is true.
// Found in the pre-launch review, 2026-09-28 (each confirmed before fixing):
//   - the tutor's dashboard printed a lesson's UTC hour — every booking made
//     on the site is stored in UTC, so an 11:00 lesson showed as 08:00
//   - "next lesson" was frozen into the portal file at booking time
//   - the parent overview counted open homework from that file, which no
//     longer holds homework — 0 while the child's board showed tasks
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

// 14:00Z on 5 April 2027 is 17:00 in Israel (IDT, +03:00) — as the booking
// page sends it: an ISO string in UTC.
const START = '2027-04-05T14:00:00.000Z';
const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'נועה כהן', subject: 'מתמטיקה', level: 'כיתה ח', phone: '0501234567',
    email: 'times@example.com', durationMin: 90, start: START, end: '2027-04-05T15:30:00.000Z' }),
}).then(r => r.json());

test('the tutor sees the lesson at its Israel time, not its UTC hour', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await book(baseUrl);
    const cookie = await login(baseUrl);
    const a = await (await fetch(`${baseUrl}/api/students/${portal.code}/activity`, { headers: { Cookie: cookie } })).json();
    assert.deepEqual({ date: a.nextLesson.date, time: a.nextLesson.time }, { date: '2027-04-05', time: '17:00' });
  } finally { await stop(); }
});

test('the family\'s next lesson is read from the bookings, at its Israel time', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await book(baseUrl);
    const cookie = await familySession(portal.link);
    const p = await (await fetch(`${baseUrl}/api/portal/${portal.code}?kind=parent`, { headers: { Cookie: cookie } })).json();
    assert.deepEqual({ date: p.nextLesson.date, time: p.nextLesson.time }, { date: '2027-04-05', time: '17:00' });
  } finally { await stop(); }
});

test('the parent overview counts the homework the child actually has open', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { portal } = await book(baseUrl);
    const tutor = await login(baseUrl);
    await fetch(`${baseUrl}/api/students/${portal.code}/activity`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: tutor },
      body: JSON.stringify({ kind: 'homework', task: 'תרגילים 1-5', date: '2027-04-06' }),
    });
    const family = await familySession(portal.link);
    // The overview is the multi-child page: a sibling, booked signed in.
    await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: family },
      body: JSON.stringify({ name: 'יונתן כהן', subject: 'מתמטיקה', level: 'כיתה ה', phone: '0501234567',
        email: 'times@example.com', durationMin: 45, start: '2027-04-06T14:00:00.000Z', end: '2027-04-06T14:45:00.000Z' }),
    });
    const html = await (await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: family } })).text();
    const counts = [...html.matchAll(/"?openHomework"?:(\d+)/g)].map(m => Number(m[1]));
    assert.deepEqual(counts.sort(), [0, 1], 'one child has the task, the sibling has none');
  } finally { await stop(); }
});
