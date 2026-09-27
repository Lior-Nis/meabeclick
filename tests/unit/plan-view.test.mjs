import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, currentStatus } from '../../src/lib/server/plans/view.ts';

/* One topic, one branch, three skills: A, B (requires A), C (requires B). */
const nodes = [
  { id: 1, key: 'calc', parent_id: null, kind: 'topic', title: 'חשבון דיפרנציאלי', position: 0, visibility: 'active' },
  { id: 2, key: 'calc.rules', parent_id: 1, kind: 'branch', title: 'כללי גזירה', position: 0, visibility: 'active' },
  { id: 3, key: 'calc.rules.a', parent_id: 2, kind: 'skill', title: 'חוקי חזקות', position: 0, visibility: 'active' },
  { id: 4, key: 'calc.rules.b', parent_id: 2, kind: 'skill', title: 'כלל המנה', position: 1, visibility: 'active' },
  { id: 5, key: 'calc.rules.c', parent_id: 2, kind: 'skill', title: 'נגזרת שורש', position: 2, visibility: 'active' },
];
const prereqs = [{ skill_id: 4, requires_id: 3 }, { skill_id: 5, requires_id: 4 }];

const ev = (id, node_id, status, at) => ({
  id, node_id, type: 'status', status, visibility: null, note: null,
  evidence: null, source: 'teacher', at,
});

const skills = (tree) => tree[0].branches[0].skills;
const byKey = (tree, key) => skills(tree).find(s => s.key === key);

test('a skill with no events is not checked', () => {
  const tree = buildTree(nodes, prereqs, [], null);
  assert.equal(byKey(tree, 'calc.rules.a').status, 'not_checked');
});

test('the latest status event wins, whatever order the rows arrive in', () => {
  const events = [ev(2, 3, 'independent', '2026-03-02'), ev(1, 3, 'guided', '2026-03-01')];
  assert.equal(currentStatus(events, 3), 'independent');
  const tree = buildTree(nodes, prereqs, events, null);
  assert.equal(byKey(tree, 'calc.rules.a').status, 'independent');
});

test('counts roll up per status, and hidden skills are excluded', () => {
  const hidden = nodes.map(n => (n.id === 5 ? { ...n, visibility: 'hidden' } : n));
  const tree = buildTree(hidden, prereqs, [ev(1, 3, 'independent', '2026-03-01')], null);
  assert.equal(tree[0].counts.independent, 1);
  assert.equal(tree[0].counts.not_checked, 1, 'the hidden skill must not be counted');
});

test('a hidden branch is excluded from the topic roll-up, not just its own', () => {
  // A second branch under the same topic, hidden, with one skill of its own —
  // there was a test for a hidden SKILL above but none for a hidden GROUP,
  // and countInto used to run for a branch's skills regardless of the
  // branch's own visibility.
  const withHiddenBranch = [
    ...nodes,
    { id: 6, key: 'calc.extra', parent_id: 1, kind: 'branch', title: 'ענף נוסף', position: 1, visibility: 'hidden' },
    { id: 7, key: 'calc.extra.a', parent_id: 6, kind: 'skill', title: 'יכולת מוסתרת', position: 0, visibility: 'active' },
  ];
  const tree = buildTree(withHiddenBranch, prereqs, [], null);
  assert.equal(tree[0].counts.not_checked, 3, "the hidden branch's skill must not inflate the topic count");
  // The hidden branch still computes its own counts correctly, in case a
  // future UI reads them directly — only the topic roll-up is exempted.
  const hiddenBranch = tree[0].branches.find(b => b.key === 'calc.extra');
  assert.equal(hiddenBranch.counts.not_checked, 1);
});

test('a paused skill still counts', () => {
  const paused = nodes.map(n => (n.id === 5 ? { ...n, visibility: 'paused' } : n));
  const tree = buildTree(paused, prereqs, [], null);
  assert.equal(tree[0].counts.not_checked, 3);
});

test('a skill is blocked until its prerequisite is done, with or without help', () => {
  const blocked = buildTree(nodes, prereqs, [], null);
  assert.equal(byKey(blocked, 'calc.rules.b').blocked, true);
  assert.deepEqual(byKey(blocked, 'calc.rules.b').blockedBy, ['חוקי חזקות']);

  const helped = buildTree(nodes, prereqs, [ev(1, 3, 'with_help', '2026-03-01')], null);
  assert.equal(byKey(helped, 'calc.rules.b').blocked, false);
});

test('a prerequisite marked needs review blocks again', () => {
  const tree = buildTree(nodes, prereqs, [ev(1, 3, 'needs_review', '2026-03-01')], null);
  assert.equal(byKey(tree, 'calc.rules.b').blocked, true);
});

test('a hidden prerequisite blocks nothing', () => {
  const hidden = nodes.map(n => (n.id === 3 ? { ...n, visibility: 'hidden' } : n));
  const tree = buildTree(hidden, prereqs, [], null);
  assert.equal(byKey(tree, 'calc.rules.b').blocked, false);
});

test('changed-since-last-lesson uses the lesson start as the boundary', () => {
  const events = [ev(1, 3, 'guided', '2026-03-01T09:00:00.000Z'), ev(2, 4, 'guided', '2026-03-03T09:00:00.000Z')];
  const tree = buildTree(nodes, prereqs, events, '2026-03-02T10:00:00.000Z');
  assert.equal(byKey(tree, 'calc.rules.a').changed, false, 'before the lesson');
  assert.equal(byKey(tree, 'calc.rules.b').changed, true, 'after the lesson');
});

test('with no past lesson, nothing is marked as changed', () => {
  const tree = buildTree(nodes, prereqs, [ev(1, 3, 'guided', '2026-03-01')], null);
  assert.equal(byKey(tree, 'calc.rules.a').changed, false);
});

test('recommended means practisable now: unblocked and not yet independent', () => {
  const events = [ev(1, 3, 'needs_review', '2026-03-01')];
  const tree = buildTree(nodes, prereqs, events, null);
  assert.equal(byKey(tree, 'calc.rules.a').recommended, true, 'needs review, nothing blocks it');
  assert.equal(byKey(tree, 'calc.rules.b').recommended, false, 'blocked by A');
  assert.equal(byKey(tree, 'calc.rules.c').recommended, false, 'blocked by B');
});

test('an independent skill is never recommended', () => {
  const tree = buildTree(nodes, prereqs, [ev(1, 3, 'independent', '2026-03-01')], null);
  assert.equal(byKey(tree, 'calc.rules.a').recommended, false);
});

test('nodes come back in position order', () => {
  const shuffled = [nodes[0], nodes[1], nodes[4], nodes[3], nodes[2]];
  const tree = buildTree(shuffled, prereqs, [], null);
  assert.deepEqual(skills(tree).map(s => s.key), ['calc.rules.a', 'calc.rules.b', 'calc.rules.c']);
});
