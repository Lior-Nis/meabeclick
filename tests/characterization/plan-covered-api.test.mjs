// The two new event kinds, through the real endpoint.
//
// Steps 1 and 2 of the progress-from-evidence design. The store tests pin
// the semantics; these pin that the route exposes them, guards them, and
// refuses the cases that would corrupt the timeline — with status codes a
// client can act on rather than a 500.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login } from './harness.mjs';

/**
 * A booked student with a real learning plan, and the first skill in it.
 *
 * A booking does not create a plan — the tutor chooses a template — so this
 * does what she does: books, then POSTs /api/plans with a template that
 * matches the enrollment's subject.
 */
async function planWithSkill(baseUrl, cookie) {
  const booked = await fetch(`${baseUrl}/api/book`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
      phone: '0501234567', email: 'plan@example.com', durationMin: 90,
      start: '2027-05-10T10:00:00+03:00', end: '2027-05-10T11:30:00+03:00',
    }),
  }).then(r => r.json());

  const created = await fetch(`${baseUrl}/api/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      code: booked.portal.code, subject: 'מתמטיקה',
      templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
    }),
  });
  // Read once: consuming the body for an assertion message and then
  // calling .json() on it throws "Body has already been read".
  const body = await created.text();
  assert.equal(created.status, 200, body);
  const { plan, tree } = JSON.parse(body);

  const skills = tree.flatMap(t => t.branches).flatMap(b => b.skills);
  return { code: booked.portal.code, planId: plan.id, skill: skills[0], topic: tree[0] };
}

const skillsOf = (tree) => tree.flatMap(t => t.branches).flatMap(b => b.skills);

const post = (baseUrl, planId, cookie, body) => fetch(`${baseUrl}/api/plans/${planId}/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body),
});

test('covered and corrections both need a tutor session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    // No session at all: the guard runs before anything else, so a made-up
    // plan id is enough to prove it.
    assert.equal((await fetch(`${baseUrl}/api/plans/1/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'covered', nodeId: 1 }),
    })).status, 401);
  } finally { await stop(); }
});

test('a skill can be marked taught without becoming progress', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { planId, skill } = await planWithSkill(baseUrl, cookie);

    const res = await post(baseUrl, planId, cookie,
      { type: 'covered', nodeId: skill.id, note: 'עברנו בשיעור' });
    const raw = await res.text();
    assert.equal(res.status, 200, raw);

    const { tree } = JSON.parse(raw);
    const same = skillsOf(tree).find(s => s.id === skill.id);
    assert.equal(same.status, 'not_checked', 'taught is not assessed');
    assert.ok(same.coveredAt, 'but the page can now say «נלמד, טרם נבדק»');
  } finally { await stop(); }
});

test('marking a topic as taught is refused — coverage is per skill', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { planId, topic } = await planWithSkill(baseUrl, cookie);

    const res = await post(baseUrl, planId, cookie, { type: 'covered', nodeId: topic.id });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /יכולת/);
  } finally { await stop(); }
});

test('a correction replaces its target, and a second one is refused with 409', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const { planId, skill } = await planWithSkill(baseUrl, cookie);

    const wrote = await post(baseUrl, planId, cookie,
      { type: 'status', nodeId: skill.id, status: 'guided' });
    const { events } = await wrote.json();
    const statusId = events.filter(e => e.type === 'status').pop().id;

    const first = await post(baseUrl, planId, cookie,
      { type: 'status', nodeId: skill.id, status: 'started', corrects: statusId, note: 'תוקן' });
    assert.equal(first.status, 200);
    const afterFix = await first.json();
    assert.equal(skillsOf(afterFix.tree).find(s => s.id === skill.id).status, 'started',
      'correcting the only assessment changes it');
    assert.equal(afterFix.events.filter(e => e.type === 'status').length, 2,
      'append-only: the original is still there');

    // Two corrections of one row would both claim its slot in the timeline.
    // Chains resolve; forks do not — so this is a conflict, not a 500.
    const second = await post(baseUrl, planId, cookie,
      { type: 'status', nodeId: skill.id, status: 'with_help', corrects: statusId });
    assert.equal(second.status, 409);
  } finally { await stop(); }
});

test('a correction naming an event from another plan is not found, and says no more', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const a = await planWithSkill(baseUrl, cookie);

    const wrote = await post(baseUrl, a.planId, cookie,
      { type: 'status', nodeId: a.skill.id, status: 'guided' });
    const idInA = (await wrote.json()).events.filter(e => e.type === 'status').pop().id;

    // A different plan on a different student.
    const booked = await fetch(`${baseUrl}/api/book`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'נועה לוי', subject: 'מתמטיקה', level: 'כיתה יא',
        phone: '0529998888', email: 'other@example.com', durationMin: 45,
        start: '2027-05-11T09:00:00+03:00', end: '2027-05-11T09:45:00+03:00',
      }),
    }).then(r => r.json());
    const other = await (await fetch(`${baseUrl}/api/plans`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'בגרות' }),
    })).json();
    const otherSkill = skillsOf(other.tree)[0];

    const res = await post(baseUrl, other.plan.id, cookie,
      { type: 'status', nodeId: otherSkill.id, status: 'started', corrects: idInA });
    assert.equal(res.status, 404, 'an event in another plan is simply not found here');
    // And the caller learns nothing about which plan it belongs to.
    assert.deepEqual(await res.json(), { error: 'לא נמצא' });
  } finally { await stop(); }
});
