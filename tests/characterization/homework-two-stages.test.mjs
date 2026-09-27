// The student's own "I finished it", and the line between the two stages.
//
// Before this, the student page rendered a done flag and offered no way to
// change it, and the PATCH that could was tutor-only — so a child who did
// the exercises had no way to say so, and the tutor had never marked
// anything, which meant the homework list only ever grew.
//
// The line these tests defend: a child may say they finished their OWN work,
// and may not grade it. Submission and grading live on separate routes with
// separate guards precisely so a family session can never reach a judgement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'מאיה לוי', subject: 'מתמטיקה', level: 'כיתה ט',
    phone: '0501112233', email: 'two@example.com', durationMin: 90,
    start: '2027-12-07T16:00:00+02:00', end: '2027-12-07T17:30:00+02:00', ...over,
  }),
}).then(r => r.json());

const setTask = (baseUrl, code, cookie, task) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ kind: 'homework', task, date: '2027-12-14' }),
  }).then(r => r.json());

const submit = (baseUrl, code, cookie, id, submitted = true) =>
  fetch(`${baseUrl}/api/portal/${code}/homework`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ id, submitted }),
  });

const tutorView = (baseUrl, code, cookie) =>
  fetch(`${baseUrl}/api/students/${code}/activity`, { headers: { Cookie: cookie }, cache: 'no-store' })
    .then(r => r.json());

async function oneTask(baseUrl) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const view = await setTask(baseUrl, booked.portal.code, cookie, 'צמצמי את 18/24');
  return { booked, cookie, code: booked.portal.code, id: Number(view.homework[0].id) };
}

test('a child can say they finished their own work, and it is recorded as theirs', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, cookie, code, id } = await oneTask(baseUrl);
    const family = await familySession(booked.portal.link);

    assert.equal((await submit(baseUrl, code, family, id)).status, 200);

    const [row] = (await tutorView(baseUrl, code, cookie)).homework;
    assert.equal(row.submitted, true);
    assert.equal(row.submittedBy, 'student', 'who made the claim is part of the claim');
    assert.equal(row.graded, false, 'saying you did it is not a mark');
  } finally { await stop(); }
});

test('a child cannot grade their own work', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, cookie, code, id } = await oneTask(baseUrl);
    const family = await familySession(booked.portal.link);

    // The submission route takes no grade, and the grading route is behind
    // the tutor's guard. Two routes, two guards, on purpose.
    await fetch(`${baseUrl}/api/portal/${code}/homework`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: family },
      body: JSON.stringify({ id, submitted: true, grade: 'ok' }),
    });
    assert.equal((await tutorView(baseUrl, code, cookie)).homework[0].graded, false);

    const viaTutorRoute = await fetch(`${baseUrl}/api/students/${code}/activity`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: family },
      body: JSON.stringify({ kind: 'homework', id, grade: 'ok' }),
    });
    assert.equal(viaTutorRoute.status, 401, 'a family session must not reach a judgement');
  } finally { await stop(); }
});

test('submission is reversible, grading does not undo it', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, cookie, code, id } = await oneTask(baseUrl);
    const family = await familySession(booked.portal.link);

    // A child who taps it by accident must be able to take it back.
    await submit(baseUrl, code, family, id, true);
    await submit(baseUrl, code, family, id, false);
    assert.equal((await tutorView(baseUrl, code, cookie)).homework[0].submitted, false);

    await submit(baseUrl, code, family, id, true);
    await fetch(`${baseUrl}/api/students/${code}/activity`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'homework', id, grade: 'redo' }),
    });

    const row = (await tutorView(baseUrl, code, cookie)).homework[0];
    assert.equal(row.graded, true);
    assert.equal(row.grade, 'redo');
    assert.equal(row.submitted, true, 'the child still did it');
  } finally { await stop(); }
});

test('one family cannot submit another family\'s homework', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, cookie, code, id } = await oneTask(baseUrl);
    const other = await book(baseUrl, {
      name: 'נועה כהן', email: 'other@example.com', phone: '0529998888',
      start: '2027-12-08T09:00:00+02:00', end: '2027-12-08T09:45:00+02:00', durationMin: 45,
    });
    const theirs = await familySession(other.portal.link);

    /* Two ways in, both closed: their session against our path, and their
       own path carrying our homework id — because the id is an integer in
       the body, so ownership has to be checked rather than inferred. */
    assert.equal((await submit(baseUrl, code, theirs, id)).status, 401);
    assert.equal((await submit(baseUrl, other.portal.code, theirs, id)).status, 404);

    assert.equal((await tutorView(baseUrl, code, cookie)).homework[0].submitted, false);
    void booked;
  } finally { await stop(); }
});

test('no session submits nothing', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { code, id } = await oneTask(baseUrl);
    assert.equal((await submit(baseUrl, code, null, id)).status, 401);
    assert.equal((await submit(baseUrl, code, 'maab_family=forged', id)).status, 401);
  } finally { await stop(); }
});

test('the tutor can submit on the child\'s behalf, and it says so', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, code, id } = await oneTask(baseUrl);
    // She will do this when they told her in the room. It is a different
    // statement from the child saying it themselves, and it is recorded as
    // a different one.
    assert.equal((await submit(baseUrl, code, cookie, id)).status, 200);
    const row = (await tutorView(baseUrl, code, cookie)).homework[0];
    assert.equal(row.submitted, true);
    assert.equal(row.submittedBy, 'teacher');
  } finally { await stop(); }
});

test('an unknown grade is refused rather than stored', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, code, id } = await oneTask(baseUrl);
    const res = await fetch(`${baseUrl}/api/students/${code}/activity`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ kind: 'homework', id, grade: 'brilliant' }),
    });
    assert.equal(res.status, 400);
    assert.equal((await tutorView(baseUrl, code, cookie)).homework[0].graded, false);
  } finally { await stop(); }
});
