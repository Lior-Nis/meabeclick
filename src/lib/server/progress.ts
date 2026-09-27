/**
 * What a child is told about how they are doing.
 *
 * The student page used to show "{progress}% התקדמות" from a hand-typed
 * integer on students_v2. Measured on production 2026-09-22: it is **0 for
 * every student, and always has been** — nobody has ever typed it. So a
 * child who had a lesson, homework and three games opened their page and
 * was told they were at zero percent.
 *
 * That is worse than showing nothing. A number with no definition cannot be
 * argued with, and a wrong one is discouraging in a place designed to
 * encourage.
 *
 * Two rules, from the progress design note:
 *
 *   Count, don't blend. "2 of 4 handed in" traces to rows a person can
 *   look at. A single percentage that mixes activity, coverage and
 *   assessment answers no question anyone actually has.
 *
 *   Never show a figure whose meaning is undefined. Every number here
 *   carries the words that say what it counts.
 *
 * Skills come first when they exist, because a learning plan is the only
 * thing here that measures understanding rather than diligence. Homework is
 * the fallback, and it is honest about being one: it counts what was handed
 * in, which is effort, not mastery.
 */
import { getStudentByCode, enrollmentsForStudent } from './entities.ts';
import { planForEnrollment, planData, lastLessonAt } from './plans/store.ts';
import { buildTree } from './plans/view.ts';
import { homeworkForStudent } from './lessons.ts';

import type { ProgressFacts, SkillsSeen } from '../progress-facts.ts';
import { SATISFIED, STATUS_LABEL } from '../plan-status.ts';
import type { SkillView } from './plans/view.ts';
/* The shape lives in $lib so the pages that render it and the code that
   computes it cannot drift apart — see progress-facts.ts for what drifting
   cost. Re-exported so existing importers of this module keep working. */
export type { ProgressFacts } from '../progress-facts.ts';

const pct = (done: number, total: number): number =>
  total > 0 ? Math.round((done / total) * 100) : 0;

export function progressFor(code: string): ProgressFacts {
  const student = getStudentByCode(code);
  const note = student?.progress_note?.trim() || null;
  if (!student) return { kind: 'none', done: 0, total: 0, percent: 0, note: null, seen: null };
  let seen: SkillsSeen | null = null;

  /* Skills, when the student has a plan with anything assessed in it.
     `completed` is SATISFIED — done with help counts, needs-review does
     not — which is the same rule the plan page shows the tutor, so the two
     cannot disagree about the same child. */
  for (const enrollment of enrollmentsForStudent(student.id)) {
    const plan = planForEnrollment(enrollment.id);
    if (!plan) continue;
    const { nodes, prereqs, events } = planData(plan.id);
    const skills = buildTree(nodes, prereqs, events, lastLessonAt(student.id))
      .flatMap(t => t.branches)
      .flatMap(b => b.skills)
      .filter(s => s.visibility !== 'hidden');
    seen ??= seenIn(skills);

    const done = skills.filter(s => ['with_help', 'independent'].includes(s.status)).length;
    /* A plan with nothing assessed yet is not progress information — it is
       a plan. Falling through to homework says something true instead of
       showing a child 0% of a tree nobody has marked. */
    if (done > 0) {
      return { kind: 'skills', done, total: skills.length, percent: pct(done, skills.length), note, seen };
    }
  }

  /* Homework handed in. Effort rather than understanding, and labelled as
     such by the caller — but it is a real number that moves when the child
     does something, which the hand-typed one never was. */
  const homework = homeworkForStudent(student.id);
  if (homework.length) {
    const done = homework.filter(h => h.submitted || h.graded).length;
    return { kind: 'homework', done, total: homework.length, percent: pct(done, homework.length), note, seen };
  }

  return { kind: 'none', done: 0, total: 0, percent: 0, note, seen };
}

/** Understood = SATISFIED, the rule the `done` count above uses, so a name
 *  in the list and the number beside it cannot disagree. */
function seenIn(skills: SkillView[]): SkillsSeen {
  const understood = skills.filter(s => SATISFIED.includes(s.status));
  const covered = skills
    .filter(s => s.coveredAt && !SATISFIED.includes(s.status))
    .sort((a, b) => (b.coveredAt ?? '').localeCompare(a.coveredAt ?? ''));
  return {
    covered: covered.map(s => s.title),
    understood: understood.map(s => ({ title: s.title, label: STATUS_LABEL[s.status] })),
  };
}
