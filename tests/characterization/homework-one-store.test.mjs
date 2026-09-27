// Homework has to be one thing.
//
// Before this change there were two stores and neither worked end to end:
//
//   generated homework  → the portal FILE only  → the tutor could not see
//                                                 or mark it
//   homework she typed  → the homework TABLE only → the student never saw it
//
// Verified against a running server before changing anything: a task added
// through /api/students/<code>/activity came back from that endpoint and was
// absent from /api/portal/<code>.
//
// The table wins, and not only to break the tie: it DERIVES `done` from the
// student's own game results, matched per student (see homeworkForStudent),
// which a flat array in a JSON file cannot do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501234567', email: 'hw@example.com', durationMin: 90,
    start: '2027-06-01T10:00:00+03:00', end: '2027-06-01T11:30:00+03:00', ...over,
  }),
}).then(r => r.json());

const addTask = (baseUrl, code, cookie, task, date) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ kind: 'homework', task, date }),
  });

const tutorView = (baseUrl, code, cookie) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, { headers: { Cookie: cookie }, cache: 'no-store' })
    .then(r => r.json());

const portalView = (baseUrl, code, cookie) =>
  fetch(`${baseUrl}/api/portal/${code}`, { headers: { Cookie: cookie }, cache: 'no-store' })
    .then(r => r.json());

test('homework the tutor sets reaches the student', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);

    await addTask(baseUrl, a.portal.code, cookie, 'תרגילים 1-5', '2027-06-08');

    const tutor = await tutorView(baseUrl, a.portal.code, cookie);
    const portal = await portalView(baseUrl, a.portal.code, cookie);

    assert.deepEqual(tutor.homework.map(h => h.task), ['תרגילים 1-5']);
    // This is the assertion that was false before: the child could not see
    // the homework they had been set.
    assert.deepEqual(portal.homework.map(h => h.task), ['תרגילים 1-5'],
      'the student must see the task they were given');
  } finally { await stop(); }
});

test('the family sees it through their own session, not only the tutor\'s', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);
    await addTask(baseUrl, a.portal.code, cookie, 'לפתור עמוד 42', '2027-06-08');

    const family = await familySession(a.portal.link);
    const seen = await portalView(baseUrl, a.portal.code, family);
    assert.deepEqual(seen.homework.map(h => h.task), ['לפתור עמוד 42']);
  } finally { await stop(); }
});

test('a grade the tutor gives is what the student sees too', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);
    await addTask(baseUrl, a.portal.code, cookie, 'תרגול שברים', '2027-06-08');

    const before = await portalView(baseUrl, a.portal.code, cookie);
    assert.equal(before.homework[0].submitted, false);
    assert.equal(before.homework[0].graded, false);

    const id = Number((await tutorView(baseUrl, a.portal.code, cookie)).homework[0].id);
    await fetch(`${baseUrl}/api/students/${a.portal.code}/activity`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'homework', id, grade: 'ok' }),
    });

    const after = await portalView(baseUrl, a.portal.code, cookie);
    // One store means one answer. Two stores meant the student's page could
    // show an assignment as open forever after the tutor had closed it.
    assert.equal(after.homework[0].graded, true);
    assert.equal(after.homework[0].grade, 'ok');
    // Grading implies it was handed in: she read it, so it exists.
    assert.equal(after.homework[0].submitted, true);
  } finally { await stop(); }
});

test('deleting it removes it from the student page as well', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const cookie = await login(baseUrl);
    await addTask(baseUrl, a.portal.code, cookie, 'משימה שתימחק', '2027-06-08');

    const id = Number((await tutorView(baseUrl, a.portal.code, cookie)).homework[0].id);
    await fetch(`${baseUrl}/api/students/${a.portal.code}/activity?id=${id}`, {
      method: 'DELETE', headers: { Cookie: cookie },
    });

    const after = await portalView(baseUrl, a.portal.code, cookie);
    assert.deepEqual(after.homework, []);
  } finally { await stop(); }
});

test('one child\'s homework never appears on another\'s page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const a = await book(baseUrl);
    const b = await book(baseUrl, {
      name: 'נועה לוי', email: 'hw-b@example.com', phone: '0529998888',
      start: '2027-06-02T09:00:00+03:00', end: '2027-06-02T09:45:00+03:00', durationMin: 45,
    });
    const cookie = await login(baseUrl);
    await addTask(baseUrl, a.portal.code, cookie, 'רק של יובל', '2027-06-08');

    const seenByB = await portalView(baseUrl, b.portal.code, cookie);
    assert.deepEqual(seenByB.homework, []);
  } finally { await stop(); }
});
