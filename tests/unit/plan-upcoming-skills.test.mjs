// The skills a student will need next, for preparing the library ahead
// (scripts/library-local.mjs --due). Today's target first — the same choice
// a booking makes (nextTargetSkill) — then the rest of the plan in order,
// blocked skills included: a prerequisite unmet today is the lesson after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, upcomingSkills } from '../../src/lib/server/plans/view.ts';

/* A, B (requires A), C (requires B), D hidden by the tutor. */
const nodes = [
  { id: 1, key: 'calc', parent_id: null, kind: 'topic', title: 'חשבון', position: 0, visibility: 'active' },
  { id: 2, key: 'calc.r', parent_id: 1, kind: 'branch', title: 'כללי גזירה', position: 0, visibility: 'active' },
  { id: 3, key: 'calc.r.a', parent_id: 2, kind: 'skill', title: 'A', position: 0, visibility: 'active' },
  { id: 4, key: 'calc.r.b', parent_id: 2, kind: 'skill', title: 'B', position: 1, visibility: 'active' },
  { id: 5, key: 'calc.r.c', parent_id: 2, kind: 'skill', title: 'C', position: 2, visibility: 'active' },
  { id: 6, key: 'calc.r.d', parent_id: 2, kind: 'skill', title: 'D', position: 3, visibility: 'hidden' },
];
const prereqs = [{ skill_id: 4, requires_id: 3 }, { skill_id: 5, requires_id: 4 }];
const ev = (id, node_id, status, at) => ({ id, node_id, type: 'status', status, visibility: null, note: null, evidence: null, source: 'teacher', corrects: null, at });
const ahead = (events, n) => upcomingSkills(buildTree(nodes, prereqs, events, null), n).map(s => s.key);

test('an untouched plan: the first skill, then the ones its prerequisites still block', () => {
  assert.deepEqual(ahead([], 3), ['calc.r.a', 'calc.r.b', 'calc.r.c']);
});

test('the count caps it, and a hidden skill is never ahead', () => {
  assert.deepEqual(ahead([], 1), ['calc.r.a']);
  assert.deepEqual(ahead([], 10), ['calc.r.a', 'calc.r.b', 'calc.r.c']);
});

test('a mastered skill is not ahead; a pulled-back one comes first', () => {
  assert.deepEqual(ahead([ev(1, 3, 'independent', '2026-03-01')], 3), ['calc.r.b', 'calc.r.c']);
  assert.deepEqual(ahead([ev(1, 3, 'independent', '2026-03-01'), ev(2, 4, 'independent', '2026-03-02'), ev(3, 3, 'needs_review', '2026-03-03')], 3),
    ['calc.r.a', 'calc.r.c']);
});
