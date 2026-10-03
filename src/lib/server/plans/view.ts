/**
 * Plan rows in, rendered tree out.
 *
 * PURE — no database, no clock, no filesystem. Every rule the page shows
 * (current status, counts, blocked, changed since the last lesson, recommended)
 * is decided here and tested directly, because these are the judgements a tutor
 * acts on and they must not be buried in a Svelte component or an SQL string.
 */
import { SATISFIED, STATUSES, type Evidence, type SkillStatus, type Visibility } from '../../plan-status.ts';

export type NodeRow = {
  id: number;
  key: string;
  parent_id: number | null;
  kind: 'topic' | 'branch' | 'skill';
  title: string;
  position: number;
  visibility: Visibility;
};

export type EventRow = {
  id: number;
  node_id: number | null;
  type: 'created' | 'status' | 'visibility' | 'move' | 'goal' | 'covered';
  status: SkillStatus | null;
  visibility: Visibility | null;
  note: string | null;
  evidence: Evidence | null;
  source: string;
  report_id: number | null;
  /** The event this one replaces, or null for an original observation.
   *  See effectiveStatusEvents() for what that does to the timeline. */
  corrects: number | null;
  at: string;
};

export type PrereqRow = { skill_id: number; requires_id: number };

export interface SkillView {
  id: number;
  key: string;
  title: string;
  visibility: Visibility;
  status: SkillStatus;
  /** Its status moved after the student's last lesson began. */
  changed: boolean;
  blocked: boolean;
  /** Titles of the prerequisites that are not met yet. */
  blockedBy: string[];
  recommended: boolean;
  /** When this skill was last TAUGHT, independent of how it went. Null when
   *  it has never been covered. A skill with a coveredAt and a status of
   *  not_checked is the honest state after a first lesson: shown as
   *  «נלמד, טרם נבדק», not as a bare «לא נבדק». */
  coveredAt: string | null;
}

export type Counts = Record<SkillStatus, number>;

export interface ProgressSummary {
  total: number;
  completed: number;
  mastered: number;
  percent: number;
}

export interface BranchView {
  id: number; key: string; title: string; visibility: Visibility;
  counts: Counts; skills: SkillView[];
  progress: ProgressSummary;
}

export interface TopicView {
  id: number; key: string; title: string; visibility: Visibility;
  counts: Counts; branches: BranchView[];
  progress: ProgressSummary;
}

const zeroCounts = (): Counts =>
  Object.fromEntries(STATUSES.map(s => [s, 0])) as Counts;

const progressFor = (skills: SkillView[]): ProgressSummary => {
  const total = skills.length;
  const completed = skills.filter(s => SATISFIED.includes(s.status)).length;
  const mastered = skills.filter(s => s.status === 'independent').length;
  return { total, completed, mastered, percent: total ? Math.round((completed / total) * 100) : 0 };
};

/** The latest status event for a node, or not_checked when there is none.
 *  Ordered by event id: two events can share a timestamp, ids cannot. */
/**
 * The status events that still stand, with corrections applied in place.
 *
 * A correction replaces an earlier event; it does not pile a newer opinion
 * on top of it. Those differ whenever the corrected event is not the most
 * recent one: fixing a typo in last month's entry must not override what
 * the tutor recorded last week, which is what "newest row wins" would do,
 * since the correction is appended last.
 *
 * So a correcting event takes the CORRECTED event's position in the
 * timeline, and the corrected event drops out. Correct a chain (a fix of a
 * fix) and it still resolves to one event at the original position.
 *
 * Exported for the history view, which needs to show a superseded event
 * struck through beneath its replacement rather than hide it — the log is
 * append-only, and being able to read what was first written is the point.
 */
export function effectiveStatusEvents(events: EventRow[], nodeId: number): EventRow[] {
  const mine = events.filter(e => e.type === 'status' && e.node_id === nodeId && e.status);
  const byId = new Map(mine.map(e => [e.id, e]));
  const correctedBy = new Map<number, EventRow>();
  for (const e of mine) {
    if (e.corrects !== null && byId.has(e.corrects)) correctedBy.set(e.corrects, e);
  }

  const out: EventRow[] = [];
  for (const e of mine) {
    // A correction is placed at the event it corrects, not at its own id.
    if (e.corrects !== null && byId.has(e.corrects)) continue;
    // Follow the chain: the newest correction of this event wins its slot.
    let resolved = e;
    const seen = new Set<number>([e.id]);
    while (correctedBy.has(resolved.id)) {
      const next = correctedBy.get(resolved.id)!;
      if (seen.has(next.id)) break;   // a cycle cannot happen through the API, but must not hang if it does
      seen.add(next.id);
      resolved = next;
    }
    // …at the ORIGINAL event's position.
    out.push({ ...resolved, id: e.id });
  }
  return out;
}

export function currentStatus(events: EventRow[], nodeId: number): SkillStatus {
  let best: EventRow | null = null;
  for (const e of effectiveStatusEvents(events, nodeId)) {
    if (!best || e.id > best.id) best = e;
  }
  return best?.status ?? 'not_checked';
}

/**
 * When a skill was last taught, from `covered` events — never from status.
 *
 * "Taught" and "understood" are different facts (see the design note). A
 * skill can be covered and still `not_checked`, which is the honest state
 * after a first lesson on it, and the one the plan page should show as
 * «נלמד, טרם נבדק» rather than a bare «לא נבדק».
 */
export function lastCoveredAt(events: EventRow[], nodeId: number): string | null {
  let best: EventRow | null = null;
  for (const e of events) {
    if (e.type !== 'covered' || e.node_id !== nodeId) continue;
    if (!best || e.id > best.id) best = e;
  }
  return best?.at ?? null;
}

/**
 * The one skill a generated lesson should target, or null.
 *
 * Spec §6 step 3. The pipeline decides this and hands the TITLE to the
 * generator; the node id never leaves the server and is what the resulting
 * homework rows are tagged with. A model asked for an id can return one
 * that does not exist or belongs to another student's plan — the pipeline
 * already knows which skill it asked about, so the link is a fact rather
 * than an output to be trusted.
 *
 * Order, most urgent first:
 *
 *   1. `needs_review` — the tutor taught it and pulled it back. Nothing in
 *      the plan matters more than the thing that did not hold.
 *   2. in progress (`guided`, `started`) — finish what is open before
 *      opening something new.
 *   3. `not_checked` — start the next thing.
 *
 * Skipped entirely: hidden skills (the tutor said not this student, not
 * now), blocked skills (a prerequisite is unmet), and satisfied ones. A
 * plan with nothing left returns null rather than inventing work — the
 * caller then generates as it always did, with no skill attached, and the
 * lesson simply produces no evidence link.
 *
 * `recommended` is deliberately NOT reused: it means "in progress and
 * unblocked" and excludes `not_checked`, so it can be empty for a plan
 * whose work has not started. That is the right flag for highlighting a
 * row and the wrong one for choosing what to teach.
 */
const TARGET_ORDER: SkillStatus[] = ['needs_review', 'guided', 'started', 'not_checked'];

export function nextTargetSkill(tree: TopicView[]): { id: number; title: string } | null {
  const open = tree
    .filter(t => t.visibility !== 'hidden')
    .flatMap(t => t.branches.filter(b => b.visibility !== 'hidden'))
    .flatMap(b => b.skills)
    /* Satisfied skills are excluded HERE rather than by the status loop
       below, because the coverage branch does not go through that loop and
       would otherwise hand back a skill she can already do, just because
       last lesson touched it. Coverage is not a reason to revisit
       something she has finished. */
    .filter(s => s.visibility !== 'hidden' && !s.blocked && !SATISFIED.includes(s.status));

  /* needs_review first, before anything else: a skill the tutor taught and
     then pulled back is the most urgent thing in the plan, whatever last
     week's lesson happened to be about. */
  const pulled = open.find(s => s.status === 'needs_review');
  if (pulled) return { id: pulled.id, title: pulled.title };

  /* Then what was actually TAUGHT, most recent first.
  
     Plan order alone answers "what is next on paper", and homework built
     from that is practice for material the child may not have seen —
     exactly the failure Todoist id:6hRhqRvfX7VHgh9q names. Reports write
     `covered` events now, so the lesson that happened can steer the
     practice that follows it.
  
     Satisfied and blocked skills are already filtered out of `open`, so
     coverage cannot drag back a skill she can do, nor one whose
     prerequisite is unmet. */
  const taught = open
    .filter(s => s.coveredAt)
    .sort((a, b) => (b.coveredAt as string).localeCompare(a.coveredAt as string));
  if (taught.length) return { id: taught[0].id, title: taught[0].title };

  for (const status of TARGET_ORDER) {
    /* Nothing has been taught yet. Plan order within a status band: `nodes`
       arrives ordered by position and every step above preserves it, so the
       first match is the earliest skill the tutor put in the plan. */
    const hit = open.find(s => s.status === status);
    if (hit) return { id: hit.id, title: hit.title };
  }
  return null;
}

/**
 * The skills a student will need next, nearest first — for preparing the
 * library ahead (/api/library/due, scripts/library-local.mjs --due), not
 * for choosing a lesson. Today's target first (nextTargetSkill, the choice
 * a booking makes), then every other visible skill not yet mastered, in
 * plan order — blocked ones included, unlike the target: a prerequisite
 * unmet today is exactly the lesson after.
 */
export function upcomingSkills(tree: TopicView[], n: number): { id: number; key: string; title: string }[] {
  const visible = tree
    .filter(t => t.visibility !== 'hidden')
    .flatMap(t => t.branches.filter(b => b.visibility !== 'hidden'))
    .flatMap(b => b.skills)
    .filter(s => s.visibility !== 'hidden' && !SATISFIED.includes(s.status));
  const first = nextTargetSkill(tree);
  const ordered = first ? [visible.find(s => s.id === first.id)!, ...visible.filter(s => s.id !== first.id)] : visible;
  return ordered.filter(Boolean).slice(0, Math.max(0, n)).map(s => ({ id: s.id, key: s.key, title: s.title }));
}

export function buildTree(
  nodes: NodeRow[],
  prereqs: PrereqRow[],
  events: EventRow[],
  lastLessonAt: string | null,
): TopicView[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenOf = new Map<number | null, NodeRow[]>();
  for (const node of nodes) {
    const list = childrenOf.get(node.parent_id) ?? [];
    list.push(node);
    childrenOf.set(node.parent_id, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.position - b.position);

  const status = new Map<number, SkillStatus>();
  const changedAt = new Map<number, string>();
  for (const node of nodes) {
    if (node.kind === 'skill') status.set(node.id, currentStatus(events, node.id));
  }
  for (const e of events) {
    if (e.type !== 'status' || e.node_id === null) continue;
    const seen = changedAt.get(e.node_id);
    if (!seen || e.at > seen) changedAt.set(e.node_id, e.at);
  }

  const requiredBy = new Map<number, number[]>();
  for (const { skill_id, requires_id } of prereqs) {
    requiredBy.set(skill_id, [...(requiredBy.get(skill_id) ?? []), requires_id]);
  }

  const skillView = (node: NodeRow): SkillView => {
    const blockedBy: string[] = [];
    for (const requiredId of requiredBy.get(node.id) ?? []) {
      const required = byId.get(requiredId);
      // A hidden prerequisite is one the tutor has taken out of this student's
      // plan; it cannot go on blocking what is still in it.
      if (!required || required.visibility === 'hidden') continue;
      if (!SATISFIED.includes(status.get(requiredId) ?? 'not_checked')) blockedBy.push(required.title);
    }
    const own = status.get(node.id) ?? 'not_checked';
    const at = changedAt.get(node.id);
    return {
      id: node.id,
      key: node.key,
      title: node.title,
      visibility: node.visibility,
      status: own,
      changed: !!(lastLessonAt && at && at > lastLessonAt),
      blocked: blockedBy.length > 0,
      blockedBy,
      recommended: blockedBy.length === 0 && ['needs_review', 'guided', 'started'].includes(own),
      coveredAt: lastCoveredAt(events, node.id),
    };
  };

  const countInto = (counts: Counts, skills: SkillView[]): void => {
    for (const s of skills) {
      if (s.visibility === 'hidden') continue;
      counts[s.status] += 1;
    }
  };

  return (childrenOf.get(null) ?? [])
    .filter(n => n.kind === 'topic')
    .map(topic => {
      const counts = zeroCounts();
      const branches = (childrenOf.get(topic.id) ?? []).map(branch => {
        const skills = (childrenOf.get(branch.id) ?? [])
          .filter(n => n.kind === 'skill')
          .map(skillView);
        const branchCounts = zeroCounts();
        countInto(branchCounts, skills);
        // A hidden branch's own row never renders (PlanTree filters it out),
        // so its skills must not silently keep summarising the topic above
        // it — the same exemption countInto already gives a hidden SKILL.
        if (branch.visibility !== 'hidden') countInto(counts, skills);
        return {
          id: branch.id, key: branch.key, title: branch.title,
          visibility: branch.visibility, counts: branchCounts, skills,
          progress: progressFor(skills),
        };
      });
      return {
        id: topic.id, key: topic.key, title: topic.title,
        visibility: topic.visibility, counts, branches,
        progress: progressFor(branches.flatMap(b => b.skills)),
      };
    });
}
