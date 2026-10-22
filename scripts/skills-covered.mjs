#!/usr/bin/env node
/**
 * Which skills were marked covered recently, across students. Read-only.
 * For MeaBeclick Growth: topic and skill names and counts only, never a
 * student name or id. Like vision-metrics.mjs it imports nothing from src/,
 * so it can be piped into the production container:
 *
 *   node scripts/skills-covered.mjs [--days 7] [--min-students 2] [--by topic|skill] [--json]
 *   ssh mea 'docker exec -i $(docker ps -qf name=mea-beclick-app) node --input-type=module - --json' < scripts/skills-covered.mjs
 *
 * "Covered" is a `plan_events` row with type 'covered' (migration 011). It
 * is written by saveReport() for every skill in a filed lesson report
 * (source 'report'), and by the plan's events API when the tutor marks a
 * skill «נלמד» by hand (source 'teacher'). It says the skill was TAUGHT,
 * not that it was understood; status events are a different fact and are
 * not counted here. A mark made when a report is filed is dated by when
 * the report was filed, not when the lesson happened.
 *
 * Each plan is its own copy of a template, so the same skill has a
 * different plan_nodes.id in every plan. Skills are grouped by
 * (plans.template_id, plan_nodes.key), the stable key the template gave
 * them, not by id or title.
 *
 * A skill has no topic column. Its topic is the nearest ancestor
 * plan_nodes row with kind 'topic', walked through parent_id. createPlan()
 * copies a template as topic → branch → skill: the topic's parent_id is
 * null, the branch points at the topic, the skill points at the branch.
 * `--by topic` (the default) groups by (plans.template_id, that ancestor's
 * key) and applies --min-students to distinct students of the topic.
 * `--by skill` keeps the per-skill grouping.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;

export function skillsCovered(db, now, { days = 7, minStudents = 2, by = 'topic' } = {}) {
  if (by !== 'topic' && by !== 'skill') throw new Error('--by must be topic or skill');
  const to = now.getTime();
  const from = to - days * DAY;

  const events = db.prepare(
    `SELECT e.node_id, e.at, p.student_id, p.template_id
       FROM plan_events e JOIN plans p ON p.id = e.plan_id
      WHERE e.type = 'covered' AND e.node_id IS NOT NULL`).all()
    .filter((e) => { const t = new Date(e.at).getTime(); return t > from && t <= to; });

  const nodes = new Map(db.prepare(
    `SELECT id, parent_id, kind, key, title FROM plan_nodes`).all().map((n) => [n.id, n]));
  const topicOf = (n) => {
    for (let cur = n, guard = 0; cur && guard < 50; cur = nodes.get(cur.parent_id), guard += 1) {
      if (cur.kind === 'topic') return cur;
    }
    return null;
  };

  const groups = new Map();
  for (const e of events) {
    const n = nodes.get(e.node_id);
    if (!n) continue;
    const topic = topicOf(n);
    const k = by === 'topic'
      ? `${e.template_id}\u0000${topic ? topic.key : ''}`
      : `${e.template_id}\u0000${n.key}`;
    let g = groups.get(k);
    if (!g) {
      groups.set(k, g = {
        template: e.template_id,
        topic: topic ? topic.title : null,
        skill: n.title,
        students: new Set(),
        times: 0,
      });
    }
    g.students.add(e.student_id);
    g.times += 1;
  }

  const all = [...groups.values()].map((g) => (by === 'skill'
    ? { template: g.template, topic: g.topic, skill: g.skill, students: g.students.size, times: g.times }
    : { template: g.template, topic: g.topic, students: g.students.size, times: g.times }));
  const rows = all.filter((r) => r.students >= minStudents)
    .sort((a, b) => b.students - a.students || b.times - a.times
      || String(a.topic).localeCompare(String(b.topic))
      || String(a.skill ?? '').localeCompare(String(b.skill ?? ''))
      || a.template.localeCompare(b.template));

  const students = new Set(events.map((e) => e.student_id)).size;
  const totals = by === 'topic'
    ? { events: events.length, topics: all.length, students, belowThreshold: all.length - rows.length }
    : { events: events.length, skills: all.length, students, belowThreshold: all.length - rows.length };

  return {
    by, days, minStudents,
    from: new Date(from).toISOString(), to: new Date(to).toISOString(),
    rows,
    /* Context without identifying anyone: how much coverage there was in
       the window at all, including groups below the student threshold. */
    totals,
  };
}

export function parseArgs(argv) {
  const out = { days: 7, minStudents: 2, json: false, by: 'topic' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (typeof a !== 'string' || a.includes('=')) {
      throw new Error(`${a} is not accepted; pass the option and its value as separate arguments`);
    }
    if (a === '--json') {
      out.json = true;
    } else if (a === '--days' || a === '--min-students') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1) throw new Error(`${a} needs a whole number ≥ 1`);
      if (a === '--days') out.days = v; else out.minStudents = v;
      i += 1;
    } else if (a === '--by') {
      const v = argv[i + 1];
      if (v !== 'topic' && v !== 'skill') throw new Error('--by must be topic or skill');
      out.by = v;
      i += 1;
    } else {
      throw new Error(`unknown option ${a}`);
    }
  }
  return out;
}

function printReport(r) {
  const noun = r.by === 'topic' ? 'topics' : 'skills';
  const shown = r.by === 'topic' ? r.totals.topics : r.totals.skills;
  console.log(`${noun} covered, last ${r.days} days, with ≥ ${r.minStudents} students`);
  if (!r.rows.length) console.log('  (none)');
  for (const x of r.rows) {
    console.log(r.by === 'topic'
      ? `  ${x.students} students · ${x.times}×  ${x.topic ?? '—'}`
      : `  ${x.students} students · ${x.times}×  ${x.topic ?? '—'} › ${x.skill}`);
  }
  console.log(`total: ${r.totals.events} covered marks, ${shown} ${noun}, ${r.totals.students} students`
    + ` (${r.totals.belowThreshold} ${noun} below the threshold not shown)`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
  const path = process.env.DB_PATH || join(process.env.DATA_DIR ?? './data', 'results.db');
  const r = skillsCovered(new DatabaseSync(path, { readOnly: true }), new Date(), opts);
  if (opts.json) { console.log(JSON.stringify(r, null, 2)); return; }
  printReport(r);
}

/* argv[1] is '-' when the script is piped to `node -` over SSH. */
const arg = process.argv[1];
if (!arg || arg === '-' || import.meta.url === pathToFileURL(arg).href) main();
