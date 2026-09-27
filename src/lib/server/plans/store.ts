/**
 * Every SQL statement a learning plan needs.
 *
 * Two rules hold throughout:
 *   1. One transaction per write, and every write appends its event in the
 *      same transaction as its effect — a status the log cannot explain is
 *      worse than no status.
 *   2. Nothing here derives anything. Current status, counts and blocking are
 *      plans/view.ts's job, so they stay testable without a database.
 */
import { handle } from '../db.ts';
import type { Evidence, SkillStatus, Visibility } from '../../plan-status.ts';
import type { EventRow, NodeRow, PrereqRow } from './view.ts';
import type { PlanTemplate } from './templates.ts';

export type PlanRow = {
  id: number;
  student_id: number;
  enrollment_id: number;
  template_id: string;
  template_version: number;
  goal: string;
  exam_date: string | null;
  focus: string | null;
  created_at: string;
};

const now = (): string => new Date().toISOString();

function logEvent(
  planId: number,
  e: { nodeId?: number | null; type: EventRow['type']; status?: SkillStatus | null;
       visibility?: Visibility | null; note?: string | null; evidence?: Evidence | null;
       corrects?: number | null },
): number {
  const r = handle().prepare(
    `INSERT INTO plan_events (plan_id, node_id, type, status, visibility, note, evidence, source, corrects, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'teacher', ?, ?)`
  ).run(planId, e.nodeId ?? null, e.type, e.status ?? null, e.visibility ?? null,
        e.note ?? null, e.evidence ?? null, e.corrects ?? null, now());
  return Number(r.lastInsertRowid);
}

/** Copies a template into rows for one enrollment. Returns the new plan id.
 *  Throws (and rolls back) if the enrollment already has a plan or the
 *  template contains a duplicate key. */
export function createPlan(input: {
  studentId: number; enrollmentId: number; template: PlanTemplate;
  goal: string; examDate?: string | null; focus?: string | null;
}): number {
  const db = handle();
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, exam_date, focus, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.studentId, input.enrollmentId, input.template.id, input.template.version,
          input.goal, input.examDate ?? null, input.focus ?? null, now());
    const planId = Number((db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id);

    const insertNode = db.prepare(
      `INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const lastId = () => Number((db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id);
    const idByKey = new Map<string, number>();

    input.template.topics.forEach((topic, ti) => {
      insertNode.run(planId, topic.key, null, 'topic', topic.title, ti);
      const topicId = lastId();
      idByKey.set(topic.key, topicId);
      topic.branches.forEach((branch, bi) => {
        insertNode.run(planId, branch.key, topicId, 'branch', branch.title, bi);
        const branchId = lastId();
        idByKey.set(branch.key, branchId);
        branch.skills.forEach((skill, si) => {
          insertNode.run(planId, skill.key, branchId, 'skill', skill.title, si);
          idByKey.set(skill.key, lastId());
        });
      });
    });

    const insertPrereq = db.prepare(
      `INSERT INTO plan_prereqs (skill_id, requires_id) VALUES (?, ?)`
    );
    for (const topic of input.template.topics) {
      for (const branch of topic.branches) {
        for (const skill of branch.skills) {
          for (const req of skill.requires ?? []) {
            const from = idByKey.get(skill.key);
            const to = idByKey.get(req);
            // Templates are validated before they get here; a missing target
            // would mean an unvalidated caller, and silently dropping the edge
            // would hide it.
            if (from === undefined || to === undefined) {
              throw new Error(`prerequisite ${skill.key} → ${req} does not resolve`);
            }
            insertPrereq.run(from, to);
          }
        }
      }
    }

    db.prepare(
      `INSERT INTO plan_events (plan_id, type, note, source, at) VALUES (?, 'created', ?, 'teacher', ?)`
    ).run(planId, `${input.template.id} v${input.template.version}`, now());

    db.exec('COMMIT');
    return planId;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function planForEnrollment(enrollmentId: number): PlanRow | null {
  return (handle().prepare(`SELECT * FROM plans WHERE enrollment_id = ?`).get(enrollmentId) as PlanRow) ?? null;
}

export function planById(id: number): PlanRow | null {
  return (handle().prepare(`SELECT * FROM plans WHERE id = ?`).get(id) as PlanRow) ?? null;
}

export function planData(planId: number): {
  plan: PlanRow; nodes: NodeRow[]; prereqs: PrereqRow[]; events: EventRow[];
} {
  const db = handle();
  const plan = planById(planId);
  if (!plan) throw new Error(`no plan ${planId}`);
  return {
    plan,
    nodes: db.prepare(
      `SELECT id, key, parent_id, kind, title, position, visibility FROM plan_nodes WHERE plan_id = ? ORDER BY position`
    ).all(planId) as NodeRow[],
    prereqs: db.prepare(
      `SELECT p.skill_id, p.requires_id FROM plan_prereqs p
       JOIN plan_nodes n ON n.id = p.skill_id WHERE n.plan_id = ?`
    ).all(planId) as PrereqRow[],
    events: db.prepare(
      /* `corrects` is not optional here: effectiveStatusEvents() resolves
         corrections from it, and omitting the column would silently make
         every correction look like a fresh opinion appended at the end. */
      `SELECT id, node_id, type, status, visibility, note, evidence, source, report_id, corrects, at
       FROM plan_events WHERE plan_id = ? ORDER BY id`
    ).all(planId) as EventRow[],
  };
}

export function nodeInPlan(planId: number, nodeId: number): NodeRow | null {
  return (handle().prepare(
    `SELECT id, key, parent_id, kind, title, position, visibility FROM plan_nodes WHERE plan_id = ? AND id = ?`
  ).get(planId, nodeId) as NodeRow) ?? null;
}

/** Spec §5: "status only on skills". The API route already refuses a
 *  non-skill node before it gets here, but the store is the module that
 *  should not be able to write an inconsistent event regardless of caller —
 *  a status on a topic or branch would show up in no `SkillView.status`
 *  anywhere and just sit in the log unexplained. */
export function addStatusEvent(
  planId: number, nodeId: number, status: SkillStatus,
  opts: { note?: string | null; evidence?: Evidence | null } = {},
): void {
  const node = nodeInPlan(planId, nodeId);
  if (!node || node.kind !== 'skill') {
    throw new Error(`node ${nodeId} is not a skill in plan ${planId}`);
  }
  logEvent(planId, { nodeId, type: 'status', status, note: opts.note, evidence: opts.evidence });
}

/**
 * Records that a skill was TAUGHT, which is not a claim about how it went.
 *
 * Deliberately writes no status. currentStatus() ignores every event that is
 * not a status event, so this cannot move a skill — a lesson that went badly
 * must not be recordable as progress, which is the whole reason coverage is
 * its own type rather than a point on the scale.
 */
export function addCoveredEvent(
  planId: number, nodeId: number,
  opts: { note?: string | null } = {},
): void {
  const node = nodeInPlan(planId, nodeId);
  if (!node || node.kind !== 'skill') {
    throw new Error(`node ${nodeId} is not a skill in plan ${planId}`);
  }
  logEvent(planId, { nodeId, type: 'covered', note: opts.note });
}

/**
 * Replaces an earlier status event, saying so.
 *
 * Not an edit and not a delete: the corrected row stays exactly as written,
 * and this appends a new event pointing at it. That is what lets the history
 * show what was first recorded, struck through beneath its replacement —
 * "explainable and restorable" is a property of the data here, not a
 * feature bolted on later.
 *
 * Refuses to correct an event from another plan, a non-status event, or one
 * that has already been corrected: a second correction of the same row would
 * make two events claim one slot in the timeline, and
 * effectiveStatusEvents() would have to pick between them arbitrarily.
 * Correct the correction instead — chains resolve, forks do not.
 */
export function correctStatusEvent(
  planId: number, eventId: number, status: SkillStatus,
  opts: { note?: string | null; evidence?: Evidence | null } = {},
): number {
  const db = handle();
  const target = db.prepare(
    `SELECT id, plan_id, node_id, type FROM plan_events WHERE id = ? AND plan_id = ?`
  ).get(eventId, planId) as { id: number; node_id: number | null; type: string } | undefined;

  if (!target) throw new Error(`event ${eventId} is not in plan ${planId}`);
  if (target.type !== 'status') throw new Error(`event ${eventId} is not a status event`);

  const already = db.prepare(
    `SELECT id FROM plan_events WHERE corrects = ? LIMIT 1`
  ).get(eventId) as { id: number } | undefined;
  if (already) throw new Error(`event ${eventId} was already corrected by ${already.id}`);

  return logEvent(planId, {
    nodeId: target.node_id, type: 'status', status,
    note: opts.note, evidence: opts.evidence, corrects: eventId,
  });
}

export function setVisibility(planId: number, nodeId: number, visibility: Visibility): void {
  const db = handle();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE plan_nodes SET visibility = ? WHERE plan_id = ? AND id = ?`).run(visibility, planId, nodeId);
    logEvent(planId, { nodeId, type: 'visibility', visibility });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Swaps a node with its neighbour among its siblings. At the edge this is a
 *  no-op: nothing moved, so nothing is logged. */
export function moveNode(planId: number, nodeId: number, direction: 'up' | 'down'): void {
  const db = handle();
  const node = nodeInPlan(planId, nodeId);
  if (!node) throw new Error('node not in plan');

  const neighbour = db.prepare(
    direction === 'up'
      ? `SELECT id, position FROM plan_nodes WHERE plan_id = ? AND parent_id IS ? AND position < ? ORDER BY position DESC LIMIT 1`
      : `SELECT id, position FROM plan_nodes WHERE plan_id = ? AND parent_id IS ? AND position > ? ORDER BY position ASC LIMIT 1`
  ).get(planId, node.parent_id, node.position) as { id: number; position: number } | undefined;
  if (!neighbour) return;

  db.exec('BEGIN');
  try {
    const set = db.prepare(`UPDATE plan_nodes SET position = ? WHERE id = ?`);
    set.run(neighbour.position, node.id);
    set.run(node.position, neighbour.id);
    logEvent(planId, { nodeId, type: 'move', note: direction });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function updateGoal(planId: number, goal: string, examDate: string | null, focus: string | null): void {
  const db = handle();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE plans SET goal = ?, exam_date = ?, focus = ? WHERE id = ?`)
      .run(goal, examDate, focus, planId);
    // Labelled and always all three fields — `[goal, examDate, focus].filter(Boolean).join(' · ')`
    // used to drop empty fields silently, so clearing an exam date (or
    // never having set one) logged the identical note either way and the
    // log couldn't explain what changed.
    logEvent(planId, {
      type: 'goal',
      note: `מטרה: ${goal} · מבחן: ${examDate ?? '—'} · מיקוד: ${focus ?? '—'}`,
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** The start of the student's most recent confirmed lesson that has already
 *  begun — the boundary plans/view.ts marks "changed since" against. */
export function lastLessonAt(studentId: number, nowIso: string = now()): string | null {
  const row = handle().prepare(
    `SELECT start FROM bookings_v2
     WHERE student_id = ? AND status = 'confirmed' AND start <= ?
     ORDER BY start DESC LIMIT 1`
  ).get(studentId, nowIso) as { start: string } | undefined;
  return row?.start ?? null;
}
