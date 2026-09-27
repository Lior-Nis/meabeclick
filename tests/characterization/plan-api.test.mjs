// The learning plan is tutor-only, and it is the first thing in the app that
// records a judgement about a child. So these pin two things: that only the
// tutor can read or write it, and that every write lands in the history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const post = (url, body, cookie) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

/** Books a student, logs in, and creates a plan on their math enrollment.
 *  The endpoint takes the SUBJECT, not an enrollment id: the roster does not
 *  expose enrollment ids, and the student plus the subject already identify
 *  the enrollment uniquely (enrollments has UNIQUE (student_id, subject)). */
async function withPlan(baseUrl) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const created = await post(`${baseUrl}/api/plans`, {
    code: booked.portal.code, subject: 'מתמטיקה',
    templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
  }, cookie);
  return { booked, cookie, created };
}

test('creating a plan returns the copied tree', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { created } = await withPlan(baseUrl);
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.plan.template_id, 'math-5u');
    assert.ok(body.tree.length >= 4, 'the five-unit tree has at least four topics');
    const first = body.tree[0];
    assert.ok(first.branches.length > 0);
    assert.ok(first.branches[0].skills.length > 0);
    assert.equal(first.branches[0].skills[0].status, 'not_checked');
  } finally { await stop(); }
});

test('a second plan for the same subject is refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, booked } = await withPlan(baseUrl);
    const again = await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'שוב',
    }, cookie);
    assert.equal(again.status, 409);
  } finally { await stop(); }
});

test('an unknown template, an unenrolled subject, and a mismatched tree are refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl, { subject: 'פיזיקה' });
    const cookie = await login(baseUrl);
    const code = booked.portal.code;

    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'פיזיקה', templateId: 'no-such', goal: 'x' }, cookie)).status, 400);
    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'היסטוריה', templateId: 'math-5u', goal: 'x' }, cookie)).status, 400,
      'the student is not enrolled in that subject');
    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'פיזיקה', templateId: 'math-5u', goal: 'x' }, cookie)).status, 400,
      'a maths tree may not be attached to a physics enrollment');
  } finally { await stop(); }
});

test('a status event is recorded, and shows up in the tree', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const skill = body.tree[0].branches[0].skills[0];

    const res = await post(`${baseUrl}/api/plans/${body.plan.id}/events`, {
      type: 'status', nodeId: skill.id, status: 'guided', evidence: 'lesson', note: 'התחלנו',
    }, cookie);
    assert.equal(res.status, 200);
    const after = await res.json();
    const updated = after.tree[0].branches[0].skills[0];
    assert.equal(updated.status, 'guided');
  } finally { await stop(); }
});

test('a status may not be set on a topic, and unknown values are refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const topic = body.tree[0];
    const skill = topic.branches[0].skills[0];
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;

    assert.equal((await post(url, { type: 'status', nodeId: topic.id, status: 'guided' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'mastered' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided', evidence: 'vibes' }, cookie)).status, 400);
    // `in EVIDENCE_LABEL` / `in VISIBILITY_LABEL` used to walk the prototype
    // chain and pass these through to a CHECK-constraint 500 instead of a 400
    // (task 7 whole-branch review, finding 1).
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided', evidence: 'toString' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'visibility', nodeId: skill.id, visibility: 'constructor' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'nope', nodeId: skill.id }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: 999999, status: 'guided' }, cookie)).status, 404);
  } finally { await stop(); }
});

test('hiding and moving are applied and returned', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;
    const skills = body.tree[0].branches[0].skills;

    const hidden = await (await post(url, { type: 'visibility', nodeId: skills[0].id, visibility: 'hidden' }, cookie)).json();
    assert.equal(hidden.tree[0].branches[0].skills[0].visibility, 'hidden');

    const moved = await (await post(url, { type: 'move', nodeId: skills[1].id, direction: 'up' }, cookie)).json();
    assert.equal(moved.tree[0].branches[0].skills[0].key, skills[1].key);
  } finally { await stop(); }
});

test('the plan endpoints are tutor-only', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created, booked } = await withPlan(baseUrl);
    const body = await created.json();
    const family = await familySession(booked.portal.link);
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;
    const skill = body.tree[0].branches[0].skills[0];

    for (const who of [undefined, family]) {
      assert.equal((await post(`${baseUrl}/api/plans`, {
        code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'x',
      }, who)).status, 401);
      assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided' }, who)).status, 401);
    }
    // The tutor still works, so the 401s above are authorization, not breakage.
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided' }, cookie)).status, 200);
  } finally { await stop(); }
});

test('no plan data reaches the family', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, created } = await withPlan(baseUrl);
    await created.json();
    const family = await familySession(booked.portal.link);

    const portal = await (await fetch(`${baseUrl}/api/portal/${booked.portal.code}?kind=parent`, { headers: { Cookie: family } })).text();
    assert.doesNotMatch(portal, /plan|תכנית למידה/i);

    const studentPortal = await (await fetch(`${baseUrl}/api/portal/${booked.portal.code}?kind=student`, { headers: { Cookie: family } })).text();
    assert.doesNotMatch(studentPortal, /plan|תכנית למידה|חשבון דיפרנציאלי/i, 'the student view must not carry plan data either');

    const parentPage = await (await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: family } })).text();
    assert.doesNotMatch(parentPage, /חשבון דיפרנציאלי/, 'a topic title must not leak into the family view');
  } finally { await stop(); }
});
