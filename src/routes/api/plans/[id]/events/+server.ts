/**
 * One endpoint for every change to a plan, because every change IS an event:
 * status, visibility, move, goal. Returns the refreshed tree so the page never
 * has to guess what the write did.
 *
 * Tutor-only. A node from another plan answers 404 with the same body as a
 * missing plan — the caller has no business learning which one it was.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { STATUSES, EVIDENCES, VISIBILITIES, type Evidence, type SkillStatus, type Visibility } from '$lib/plan-status.ts';
import {
  planById, planData, nodeInPlan, addStatusEvent, addCoveredEvent, correctStatusEvent,
  setVisibility, moveNode, updateGoal, lastLessonAt,
} from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { RequestHandler } from './$types';

const NOT_FOUND = { error: 'לא נמצא' };

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const plan = planById(Number(event.params.id));
  if (!plan) return json(NOT_FOUND, { status: 404 });

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  const type = String(body.type ?? '');

  const requireNode = (kind?: 'skill') => {
    const node = nodeInPlan(plan.id, Number(body.nodeId));
    if (!node) return null;
    if (kind && node.kind !== kind) return undefined; // wrong kind, not missing
    return node;
  };

  if (type === 'status') {
    const node = requireNode('skill');
    if (node === null) return json(NOT_FOUND, { status: 404 });
    if (node === undefined) return json({ error: 'אפשר לסמן מצב רק על יכולת' }, { status: 400 });

    const status = String(body.status ?? '') as SkillStatus;
    if (!STATUSES.includes(status)) return json({ error: 'מצב לא מוכר' }, { status: 400 });

    const evidence = body.evidence ? (String(body.evidence) as Evidence) : null;
    // .includes, not `in EVIDENCE_LABEL` — `in` walks the prototype chain,
    // so 'constructor'/'toString'/'__proto__' would pass validation here and
    // then trip the CHECK constraint in SQLite, surfacing as a 500 instead
    // of this 400.
    if (evidence && !EVIDENCES.includes(evidence)) return json({ error: 'סוג ראיה לא מוכר' }, { status: 400 });

    const note = body.note ? String(body.note) : null;
    if (note && note.length > 1000) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

    /* A correction names the event it replaces. Without `corrects` this is
       an ordinary new observation — the two are different claims and the
       history has to be able to tell them apart (see the design note). */
    if (body.corrects !== undefined && body.corrects !== null) {
      const corrects = Number(body.corrects);
      if (!Number.isInteger(corrects)) return json({ error: 'מזהה תיקון לא תקין' }, { status: 400 });
      try {
        correctStatusEvent(plan.id, corrects, status, { note, evidence });
      } catch (err) {
        /* Every refusal here is about the target row: another plan's event,
           a non-status event, or one already corrected. None of them should
           500, and none should say which plan an id belongs to. */
        const why = (err as Error).message;
        if (why.includes('already corrected')) {
          return json({ error: 'הרישום הזה כבר תוקן — אפשר לתקן את התיקון' }, { status: 409 });
        }
        if (why.includes('not a status event')) {
          return json({ error: 'אפשר לתקן רק רישום מצב' }, { status: 400 });
        }
        return json(NOT_FOUND, { status: 404 });
      }
    } else {
      addStatusEvent(plan.id, node.id, status, { note, evidence });
    }
  } else if (type === 'covered') {
    /* Taught, not assessed. Writes no status on purpose: a lesson that went
       badly must still be recordable as "we covered this" without it
       counting as progress. */
    const node = requireNode('skill');
    if (node === null) return json(NOT_FOUND, { status: 404 });
    if (node === undefined) return json({ error: 'אפשר לסמן נלמד רק על יכולת' }, { status: 400 });

    const note = body.note ? String(body.note) : null;
    if (note && note.length > 1000) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

    addCoveredEvent(plan.id, node.id, { note });
  } else if (type === 'visibility') {
    const node = requireNode();
    if (!node) return json(NOT_FOUND, { status: 404 });
    const visibility = String(body.visibility ?? '') as Visibility;
    if (!VISIBILITIES.includes(visibility)) return json({ error: 'מצב תצוגה לא מוכר' }, { status: 400 });
    setVisibility(plan.id, node.id, visibility);
  } else if (type === 'move') {
    const node = requireNode();
    if (!node) return json(NOT_FOUND, { status: 404 });
    const direction = String(body.direction ?? '');
    if (direction !== 'up' && direction !== 'down') return json({ error: 'כיוון לא תקין' }, { status: 400 });
    moveNode(plan.id, node.id, direction);
  } else if (type === 'goal') {
    const goal = String(body.goal ?? '').trim();
    if (!goal || goal.length > 200) return json({ error: 'צריך מטרה (עד 200 תווים)' }, { status: 400 });
    const examDate = body.examDate ? String(body.examDate) : null;
    if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
      return json({ error: 'תאריך מבחן לא תקין' }, { status: 400 });
    }
    updateGoal(plan.id, goal, examDate, body.focus ? String(body.focus).slice(0, 200) : null);
  } else {
    return json({ error: 'סוג עדכון לא מוכר' }, { status: 400 });
  }

  const fresh = planData(plan.id);
  return json({
    plan: fresh.plan,
    tree: buildTree(fresh.nodes, fresh.prereqs, fresh.events, lastLessonAt(plan.student_id)),
    // The skill sheet's history list needs the raw log — task 7 review
    // (finding 1): the page used to fabricate a client-side event with a
    // browser-clock timestamp because this endpoint didn't return one. Same
    // `fresh` read already used for the tree above, just also forwarded.
    events: fresh.events,
  });
};
