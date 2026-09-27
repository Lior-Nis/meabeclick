// tests/unit/plan-target-skill.test.mjs
//
// Which skill a generated lesson is for.
//
// From docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md
// §6 step 3, "the generator is told which skills a lesson targets". Nothing
// today connects a game or a homework task to a skill, so every
// evidence-based suggestion in §3.2 is unreachable — the evidence exists
// and has nothing to attach to.
//
// The choice is made HERE, from the plan, and never by the model. A model
// asked to emit a node id can emit one that does not exist, or one
// belonging to another student's plan; the pipeline already knows which
// skills it asked about, so the link is a fact rather than an output to be
// trusted. That is the same reasoning as games/registry.json's data-only
// templates: let the model produce content, never identity.
//
// Pure, like the rest of plans/view.ts — this is a judgement a tutor acts
// on, so it is tested directly rather than through a route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, nextTargetSkill } from '../../src/lib/server/plans/view.ts';

/* One topic, one branch, three skills: A, B (requires A), C (requires B). */
const nodes = [
  { id: 1, key: 'calc', parent_id: null, kind: 'topic', title: 'חשבון', position: 0, visibility: 'active' },
  { id: 2, key: 'calc.r', parent_id: 1, kind: 'branch', title: 'כללי גזירה', position: 0, visibility: 'active' },
  { id: 3, key: 'calc.r.a', parent_id: 2, kind: 'skill', title: 'חוקי חזקות', position: 0, visibility: 'active' },
  { id: 4, key: 'calc.r.b', parent_id: 2, kind: 'skill', title: 'כלל המנה', position: 1, visibility: 'active' },
  { id: 5, key: 'calc.r.c', parent_id: 2, kind: 'skill', title: 'נגזרת שורש', position: 2, visibility: 'active' },
];
const prereqs = [{ skill_id: 4, requires_id: 3 }, { skill_id: 5, requires_id: 4 }];

const ev = (id, node_id, status, at) => ({
  id, node_id, type: 'status', status, visibility: null, note: null,
  evidence: null, source: 'teacher', corrects: null, at,
});

const target = (events, lastLessonAt = null) =>
  nextTargetSkill(buildTree(nodes, prereqs, events, lastLessonAt));

test('an untouched plan targets the first unblocked skill', () => {
  // B and C are blocked by prerequisites, so there is only one honest answer.
  assert.deepEqual(target([]), { id: 3, title: 'חוקי חזקות' });
});

test('a skill already in progress is continued before a new one is started', () => {
  // A is satisfied, so B is unblocked and started. Starting C instead —
  // or restarting A — would both be worse than finishing what is open.
  const events = [ev(1, 3, 'independent', '2026-03-01'), ev(2, 4, 'started', '2026-03-02')];
  assert.deepEqual(target(events), { id: 4, title: 'כלל המנה' });
});

test('needs_review outranks a skill that was never started', () => {
  // A skill the tutor pulled back is the most urgent thing in the plan:
  // the student was taught it and it did not hold.
  const events = [
    ev(1, 3, 'needs_review', '2026-03-01'),
  ];
  assert.deepEqual(target(events), { id: 3, title: 'חוקי חזקות' });
});

test('a finished plan targets nothing rather than inventing work', () => {
  const events = [
    ev(1, 3, 'independent', '2026-03-01'),
    ev(2, 4, 'independent', '2026-03-02'),
    ev(3, 5, 'independent', '2026-03-03'),
  ];
  assert.equal(target(events), null);
});

test('a hidden skill is never targeted', () => {
  // Visibility is the tutor saying "not this student, not now". A lesson
  // generated against it would be work she deliberately removed.
  const hidden = nodes.map(n => (n.id === 3 ? { ...n, visibility: 'hidden' } : n));
  const tree = buildTree(hidden, prereqs, [], null);
  const chosen = nextTargetSkill(tree);
  assert.notEqual(chosen?.id, 3, 'a hidden skill must not be chosen');
});

test('a blocked skill is never targeted, even when it is the only one left', () => {
  // A is satisfied-adjacent but not satisfied: `guided` does not meet a
  // prerequisite, so B stays blocked and A is still the work.
  const events = [ev(1, 3, 'guided', '2026-03-01')];
  assert.deepEqual(target(events), { id: 3, title: 'חוקי חזקות' });
});

/* ── Practice follows what was actually taught ────────────────────────────
 *
 * Todoist id:6hRhqRvfX7VHgh9q step 1. Homework and games "may be created
 * from material that was planned but not actually taught" — which is what
 * choosing purely by plan order does. A plan knows what was PLANNED; only a
 * report knows what happened, and since reports now write `covered` events
 * the target can prefer the thing the child was just taught.
 */

const cov = (id, node_id, at) => ({
  id, node_id, type: 'covered', status: null, visibility: null, note: null,
  evidence: null, source: 'report', corrects: null, at,
});

test('a skill taught last lesson is practised before an untaught one', () => {
  // Plan order says A. The lesson actually covered B. Generating homework
  // for A would be practice for something the child has not seen.
  const events = [cov(1, 4, '2026-03-10')];
  const tree = buildTree(nodes, [], events, null);  // no prereqs: both open
  assert.deepEqual(nextTargetSkill(tree), { id: 4, title: 'כלל המנה' });
});

test('the most recently taught skill wins when several were covered', () => {
  const events = [cov(1, 3, '2026-03-01'), cov(2, 4, '2026-03-10')];
  const tree = buildTree(nodes, [], events, null);
  assert.deepEqual(nextTargetSkill(tree), { id: 4, title: 'כלל המנה' });
});

test('needs_review still outranks what was taught most recently', () => {
  // A skill the tutor pulled back is the most urgent thing in the plan,
  // even if last week's lesson was about something else.
  const events = [ev(1, 3, 'needs_review', '2026-03-01'), cov(2, 4, '2026-03-10')];
  const tree = buildTree(nodes, [], events, null);
  assert.deepEqual(nextTargetSkill(tree), { id: 3, title: 'חוקי חזקות' });
});

test('a taught skill that is already satisfied is not practised again', () => {
  // Coverage is not a reason to revisit something she can do.
  const events = [cov(1, 3, '2026-03-10'), ev(2, 3, 'independent', '2026-03-10')];
  const tree = buildTree(nodes, [], events, null);
  assert.deepEqual(nextTargetSkill(tree), { id: 4, title: 'כלל המנה' });
});

test('a taught skill that is blocked is not practised', () => {
  const events = [cov(1, 5, '2026-03-10')];
  const tree = buildTree(nodes, prereqs, events, null);
  assert.notEqual(nextTargetSkill(tree)?.id, 5, 'skill C needs B first');
});
