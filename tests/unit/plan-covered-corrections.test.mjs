/**
 * Coverage as its own fact, and corrections that say what they replace.
 *
 * Steps 1 and 2 of
 * docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md.
 *
 * Coverage: "this was taught" and "she can do it" are different claims, and
 * the six-point status scale can only make the second. Recording coverage
 * as a status would mean a lesson that went badly still had to be written
 * down as progress — the exact conflation the task exists to remove.
 *
 * Corrections: a correction is not a newer opinion. The difference shows
 * whenever the corrected event is not the most recent one — fixing last
 * month's entry must not override what was recorded last week, which is
 * what "newest row wins" would do, since the correction is appended last.
 * So a correction takes the CORRECTED event's slot in the timeline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'plan-cc-')), 'results.db');

const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const V = await import('../../src/lib/server/plans/view.ts');

const template = {
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון דיפרנציאלי',
    branches: [{
      key: 'calc.rules', title: 'כללי גזירה',
      skills: [
        { key: 'calc.rules.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.rules.b', title: 'כלל המנה', requires: [] },
      ],
    }],
  }],
};

let seq = 0;
/** A fresh student, enrollment and plan per test, so none can leak into
 *  another through shared events. */
function freshPlan() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  const planId = S.createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות' });

  const { nodes } = S.planData(planId);
  const skills = nodes.filter(n => n.kind === 'skill');
  return { planId, skill: skills[0], otherSkill: skills[1], topic: nodes.find(n => n.kind === 'topic') };
}

const eventsOf = (planId) => S.planData(planId).events;

test('a covered skill is taught but still not assessed', () => {
  const { planId, skill } = freshPlan();
  S.addCoveredEvent(planId, skill.id, { note: 'עברנו על זה בשיעור' });

  const events = eventsOf(planId);
  // The whole point: coverage must not move the skill along the scale.
  assert.equal(V.currentStatus(events, skill.id), 'not_checked');
  assert.ok(V.lastCoveredAt(events, skill.id), 'but it is on record as taught');
});

test('coverage never becomes progress, however many times it is taught', () => {
  const { planId, skill } = freshPlan();
  for (let i = 0; i < 5; i++) S.addCoveredEvent(planId, skill.id);
  assert.equal(V.currentStatus(eventsOf(planId), skill.id), 'not_checked');
});

test('coverage and assessment coexist, and the assessment is what counts', () => {
  const { planId, skill } = freshPlan();
  S.addCoveredEvent(planId, skill.id);
  S.addStatusEvent(planId, skill.id, 'needs_review', { evidence: 'lesson' });
  S.addCoveredEvent(planId, skill.id);   // taught again after a bad result

  const events = eventsOf(planId);
  assert.equal(V.currentStatus(events, skill.id), 'needs_review',
    'teaching it again does not undo "needs review"');
  assert.ok(V.lastCoveredAt(events, skill.id));
});

test('coverage is refused on anything that is not a skill', () => {
  const { planId, topic } = freshPlan();
  assert.throws(() => S.addCoveredEvent(planId, topic.id), /not a skill/);
});

test('a correction replaces the event it names, not the latest one', () => {
  const { planId, skill } = freshPlan();
  const first = S.addStatusEvent(planId, skill.id, 'guided');
  void first;
  const events0 = eventsOf(planId);
  const firstId = events0.find(e => e.type === 'status').id;

  // A later, legitimate assessment.
  S.addStatusEvent(planId, skill.id, 'independent', { evidence: 'test' });

  // Now correct the FIRST one — a typo, say. It must not override the
  // later assessment, which is what appending a newer row would do.
  S.correctStatusEvent(planId, firstId, 'started', { note: 'תוקן: היה רישום שגוי' });

  assert.equal(V.currentStatus(eventsOf(planId), skill.id), 'independent',
    'correcting an old entry must not overwrite a newer one');
});

test('correcting the most recent event does change the current status', () => {
  const { planId, skill } = freshPlan();
  S.addStatusEvent(planId, skill.id, 'independent');
  const latestId = eventsOf(planId).filter(e => e.type === 'status').pop().id;

  S.correctStatusEvent(planId, latestId, 'needs_review', { note: 'סומן בטעות' });

  assert.equal(V.currentStatus(eventsOf(planId), skill.id), 'needs_review');
});

test('the corrected event is kept, so the history can still be read', () => {
  const { planId, skill } = freshPlan();
  S.addStatusEvent(planId, skill.id, 'independent');
  const originalId = eventsOf(planId).filter(e => e.type === 'status').pop().id;
  S.correctStatusEvent(planId, originalId, 'with_help');

  const all = eventsOf(planId).filter(e => e.type === 'status');
  assert.equal(all.length, 2, 'append-only: nothing is edited or deleted');
  const original = all.find(e => e.id === originalId);
  assert.equal(original.status, 'independent', 'the original still says what it said');
  assert.equal(all.find(e => e.corrects === originalId).status, 'with_help');
});

test('a correction of a correction resolves to the last one, in the original slot', () => {
  const { planId, skill } = freshPlan();
  S.addStatusEvent(planId, skill.id, 'guided');
  const firstId = eventsOf(planId).filter(e => e.type === 'status').pop().id;
  S.addStatusEvent(planId, skill.id, 'independent');

  const fixId = S.correctStatusEvent(planId, firstId, 'started');
  S.correctStatusEvent(planId, fixId, 'needs_review');

  const effective = V.effectiveStatusEvents(eventsOf(planId), skill.id);
  const inFirstSlot = effective.find(e => e.id === firstId);
  assert.equal(inFirstSlot.status, 'needs_review', 'the chain resolves to its end');
  // And it is still in the FIRST slot, so it cannot outrank the later entry.
  assert.equal(V.currentStatus(eventsOf(planId), skill.id), 'independent');
});

test('the same event cannot be corrected twice', () => {
  const { planId, skill } = freshPlan();
  S.addStatusEvent(planId, skill.id, 'guided');
  const id = eventsOf(planId).filter(e => e.type === 'status').pop().id;
  S.correctStatusEvent(planId, id, 'started');

  // Two corrections of one row would both claim one slot in the timeline,
  // and effectiveStatusEvents() would have to pick arbitrarily. Chains
  // resolve; forks do not.
  assert.throws(() => S.correctStatusEvent(planId, id, 'with_help'), /already corrected/);
});

test('a correction cannot reach across plans, or target a non-status event', () => {
  const a = freshPlan();
  const b = freshPlan();
  S.addStatusEvent(a.planId, a.skill.id, 'guided');
  const idInA = eventsOf(a.planId).filter(e => e.type === 'status').pop().id;

  assert.throws(() => S.correctStatusEvent(b.planId, idInA, 'started'), /not in plan/);

  S.addCoveredEvent(a.planId, a.skill.id);
  const coveredId = eventsOf(a.planId).filter(e => e.type === 'covered').pop().id;
  assert.throws(() => S.correctStatusEvent(a.planId, coveredId, 'started'), /not a status event/);
});

test('a skill that was taught but not assessed is distinguishable in the tree', () => {
  const { planId, skill, otherSkill } = freshPlan();
  S.addCoveredEvent(planId, skill.id);

  const { nodes, prereqs, events } = S.planData(planId);
  const tree = V.buildTree(nodes, prereqs, events, null);
  const all = tree.flatMap(t => t.branches.flatMap(b => b.skills));

  const taught = all.find(s => s.id === skill.id);
  const untouched = all.find(s => s.id === otherSkill.id);

  // Both are not_checked. Only one of them has actually been in a lesson,
  // and the page needs to be able to say «נלמד, טרם נבדק» for that one.
  assert.equal(taught.status, 'not_checked');
  assert.equal(untouched.status, 'not_checked');
  assert.ok(taught.coveredAt, 'taught skill carries when it was covered');
  assert.equal(untouched.coveredAt, null);
});
