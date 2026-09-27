# Learning Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tutor one tutor-only page per student and subject that shows a prerequisite-ordered skill tree, where she sets each skill's status by hand and every change keeps its source, note and history.

**Architecture:** Curated per-track template files (`templates/plans/*.json`) are copied into SQLite rows when a plan is created, so a template edit never reshapes a live plan. All state changes are appended to one `plan_events` table; current status, roll-up counts, blocked flags and "changed since the last lesson" are derived on read by a pure module. A SvelteKit page at `/app/plan/<code>` renders the tree and posts events to two tutor-only endpoints.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes, `adapter-node`), TypeScript, `node:sqlite`, `node --test`. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-12-learning-plan-design.md` (read it before Task 1; the curriculum it draws on is `docs/superpowers/research/2026-09-12-israeli-math-curriculum.md`)

## Global Constraints

- Node `>=22.18`. Unit tests import `.ts` sources directly and rely on Node's type stripping; keep that style.
- No new runtime or dev dependencies. Browser checks are ad-hoc scripts in the session scratchpad, never committed.
- Server-only code lives under `src/lib/server/` and is imported via the `$server` alias. Import paths keep their `.ts` extension.
- Every UI string is Hebrew. The page is RTL, phone-first, must work at 320px with no horizontal scroll, and every tappable control is at least 44px tall.
- Status is never communicated by colour alone; every status pill carries its Hebrew label. Use existing tokens only: `--accent2-strong`, `--accent3-strong`, `--danger`, `--text-muted`, `--accent`.
- CSP is enforced (`svelte.config.js`): no new inline `<script>`, no new remote origins. Inline `style="..."` attributes are allowed.
- Everything under `/app/plan` and `/api/plans` is tutor-only. No plan data may appear in `/api/portal`, `/app/parent` or `/app/student`.
- Tests use invented names only. Never copy a real student from `mea-beclick-kb/`.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Run `npm run build` before any characterization test: the harness spawns `build/index.js` and does not build for you.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/plan-status.ts` | Shared vocabulary: status, evidence and visibility values plus Hebrew labels. Imported by both server and page. |
| `src/lib/server/plans/templates.ts` | Load, validate and cache `templates/plans/*.json`. |
| `src/lib/server/plans/view.ts` | **Pure.** Rows in, rendered tree out: current status, counts, blocked, changed-since-lesson, recommended. |
| `src/lib/server/plans/store.ts` | All plan SQL. One transaction per write. |
| `src/lib/server/migrations/004_learning_plans.ts` | Schema. |
| `templates/plans/math-5u.json`, `templates/plans/math-4u.json` | Curated trees. |
| `src/routes/api/plans/+server.ts` | `POST` create plan. |
| `src/routes/api/plans/[id]/events/+server.ts` | `POST` one event of any type. |
| `src/routes/app/plan/[code]/+page.server.ts` | Tutor guard + load. |
| `src/routes/app/plan/[code]/+page.svelte` | Page shell, subject chips, filters, create card. |
| `src/lib/components/plan/PlanTree.svelte` | Topics, branches, skill rows, counts. |
| `src/lib/components/plan/SkillSheet.svelte` | Bottom sheet / side panel: status, evidence, note, prerequisites, history. |

---

### Task 1: Schema

**Files:**
- Create: `src/lib/server/migrations/004_learning_plans.ts`
- Modify: `src/lib/server/migrations/list.ts`
- Test: `tests/unit/plan-schema.test.mjs`

**Interfaces:**
- Consumes: `migrate()` from `src/lib/server/migrations/index.ts`.
- Produces: tables `plans`, `plan_nodes`, `plan_prereqs`, `plan_events` exactly as in spec §5. Every later task depends on these column names.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-schema.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/lib/server/migrations/index.ts';

async function freshDb() {
  const dir = await mkdtemp(join(tmpdir(), 'plan-schema-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/** One account, one student, one enrollment — the rows a plan hangs off. */
function seed(db) {
  db.prepare(
    `INSERT INTO accounts (name, phone, credential, is_self, created_at)
     VALUES ('משפחת כהן', NULL, 'x', 0, '2026-01-01T00:00:00.000Z')`
  ).run();
  const accountId = db.prepare(`SELECT id FROM accounts ORDER BY id DESC LIMIT 1`).get().id;
  db.prepare(
    `INSERT INTO students_v2 (code, name, account_id, credential, created_at)
     VALUES ('yuval', 'יובל', ?, 'x', '2026-01-01T00:00:00.000Z')`
  ).run(accountId);
  const studentId = db.prepare(`SELECT id FROM students_v2 WHERE code = 'yuval'`).get().id;
  db.prepare(
    `INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'מתמטיקה', 'כיתה יא')`
  ).run(studentId);
  const enrollmentId = db.prepare(`SELECT id FROM enrollments WHERE student_id = ?`).get(studentId).id;
  return { studentId, enrollmentId };
}

function newPlan(db, studentId, enrollmentId) {
  db.prepare(
    `INSERT INTO plans (student_id, enrollment_id, template_id, template_version, goal, created_at)
     VALUES (?, ?, 'math-5u', 1, 'בגרות 5 יח״ל', '2026-01-02T00:00:00.000Z')`
  ).run(studentId, enrollmentId);
  return db.prepare(`SELECT id FROM plans ORDER BY id DESC LIMIT 1`).get().id;
}

test('the migration creates the four plan tables', async () => {
  const db = await freshDb();
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['plans', 'plan_nodes', 'plan_prereqs', 'plan_events']) {
    assert.ok(tables.includes(t), `expected table ${t}`);
  }
});

test('one enrollment can hold only one plan', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  newPlan(db, studentId, enrollmentId);
  assert.throws(() => newPlan(db, studentId, enrollmentId), /UNIQUE/i);
});

test('a node key is unique inside its plan, and free across plans', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  const planId = newPlan(db, studentId, enrollmentId);
  const insert = (plan, key) => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
     VALUES (?, ?, NULL, 'topic', 'חקירת פונקציה', 0)`
  ).run(plan, key);

  insert(planId, 'calc');
  assert.throws(() => insert(planId, 'calc'), /UNIQUE/i);

  // A second student's plan may use the same template keys.
  db.prepare(`INSERT INTO enrollments (student_id, subject, level) VALUES (?, 'פיזיקה', NULL)`).run(studentId);
  const other = db.prepare(`SELECT id FROM enrollments WHERE subject = 'פיזיקה'`).get().id;
  const otherPlan = newPlan(db, studentId, other);
  insert(otherPlan, 'calc');
});

test('the constrained columns reject values outside their vocabulary', async () => {
  const db = await freshDb();
  const { studentId, enrollmentId } = seed(db);
  const planId = newPlan(db, studentId, enrollmentId);

  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position) VALUES (?, 'a', 'chapter', 'x', 0)`
  ).run(planId), /CHECK/i, 'kind must be topic|branch|skill');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position, visibility)
     VALUES (?, 'b', 'skill', 'x', 0, 'archived')`
  ).run(planId), /CHECK/i, 'visibility must be active|paused|hidden');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, status, at) VALUES (?, 'status', 'mastered', '2026-01-03')`
  ).run(planId), /CHECK/i, 'status must be one of the six');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, at) VALUES (?, 'deleted', '2026-01-03')`
  ).run(planId), /CHECK/i, 'type must be a known event type');

  assert.throws(() => db.prepare(
    `INSERT INTO plan_events (plan_id, type, status, evidence, at)
     VALUES (?, 'status', 'guided', 'vibes', '2026-01-03')`
  ).run(planId), /CHECK/i, 'evidence must be a known kind');
});

test('a node cannot belong to a plan that does not exist', async () => {
  const db = await freshDb();
  assert.throws(() => db.prepare(
    `INSERT INTO plan_nodes (plan_id, key, kind, title, position) VALUES (9999, 'a', 'topic', 'x', 0)`
  ).run(), /FOREIGN KEY/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/plan-schema.test.mjs`
Expected: FAIL — `no such table: plans`.

- [ ] **Step 3: Write the migration**

Create `src/lib/server/migrations/004_learning_plans.ts`:

```ts
/**
 * Migration 004 — the learning plan.
 *
 * A plan is one student's copy of a reviewed skill-tree template, for one
 * enrollment (student + subject). The copy is deliberate: editing a template
 * must never reshape a plan a tutor has already been marking against. Nodes
 * keep the template's stable `key` so a future opt-in re-sync can match them.
 *
 * `plan_events` is the history for EVERYTHING — status, hiding, pausing,
 * reordering and goal edits — because a status change is only trustworthy
 * next to the structure changes around it. Current status is NOT stored on
 * plan_nodes: it is the latest status event (see plans/view.ts), so the log
 * and the display cannot disagree.
 *
 * `source` is CHECKed to 'teacher' alone today. The lesson-report spec adds
 * 'report' and the evidence spec adds 'game'/'homework'; each is a one-line
 * migration that touches no other table. That is the point of the shape.
 */
export const sql = `
CREATE TABLE plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id       INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id    INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
  template_id      TEXT    NOT NULL,
  template_version INTEGER NOT NULL,
  goal             TEXT    NOT NULL,
  exam_date        TEXT,
  focus            TEXT,
  created_at       TEXT    NOT NULL
);

CREATE TABLE plan_nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  key        TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES plan_nodes(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('topic', 'branch', 'skill')),
  title      TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  visibility TEXT    NOT NULL DEFAULT 'active'
             CHECK (visibility IN ('active', 'paused', 'hidden')),
  UNIQUE (plan_id, key)
);

CREATE INDEX plan_nodes_plan ON plan_nodes (plan_id, parent_id, position);

CREATE TABLE plan_prereqs (
  skill_id    INTEGER NOT NULL REFERENCES plan_nodes(id),
  requires_id INTEGER NOT NULL REFERENCES plan_nodes(id),
  PRIMARY KEY (skill_id, requires_id)
);

CREATE TABLE plan_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal')),
  status     TEXT    CHECK (status IN ('not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson', 'homework', 'game', 'test', 'other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher')),
  at         TEXT    NOT NULL
);

CREATE INDEX plan_events_node ON plan_events (node_id, id);
`;
```

- [ ] **Step 4: Register it**

In `src/lib/server/migrations/list.ts`, add the import beside the others and the entry at the end of `MIGRATIONS`:

```ts
import { sql as sql004 } from './004_learning_plans.ts';
```
```ts
  { version: 4, name: '004_learning_plans', sql: sql004 },
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/plan-schema.test.mjs tests/unit/migrations.test.mjs`
Expected: PASS. (`migrations.test.mjs` derives the latest version from the registry, so adding a migration does not break it.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/migrations/004_learning_plans.ts src/lib/server/migrations/list.ts tests/unit/plan-schema.test.mjs
git commit -m "Add the learning-plan schema

Four tables: a plan per enrollment, its copied nodes, their prerequisites,
and one append-only event log covering status, visibility, moves and goal
edits. Current status is derived from the log rather than stored, so the
two can never disagree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared vocabulary and the template validator

**Files:**
- Create: `src/lib/plan-status.ts`
- Create: `src/lib/server/plans/templates.ts`
- Test: `tests/unit/plan-templates.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/lib/plan-status.ts`: `type SkillStatus`, `STATUSES: SkillStatus[]`, `STATUS_LABEL: Record<SkillStatus, string>`, `SATISFIED: SkillStatus[]`, `type Evidence`, `EVIDENCE_LABEL`, `type Visibility`.
  - `src/lib/server/plans/templates.ts`: `interface PlanTemplate`, `interface TemplateTopic`, `interface TemplateBranch`, `interface TemplateSkill`, `validateTemplate(value: unknown): string[]`, `loadTemplates(): PlanTemplate[]`, `templateById(id: string): PlanTemplate | null`, `templatesForSubject(subject: string): PlanTemplate[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-templates.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplate } from '../../src/lib/server/plans/templates.ts';

/** A minimal valid template; each test bends one thing out of shape. */
const good = () => ({
  id: 'demo', version: 1, subject: 'מתמטיקה', track: '5 יח״ל',
  reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון דיפרנציאלי',
    branches: [{
      key: 'calc.rules', title: 'כללי גזירה',
      skills: [
        { key: 'calc.rules.power', title: 'נגזרת של חזקה', requires: [] },
        { key: 'calc.rules.quotient', title: 'נגזרת של מנה', requires: ['calc.rules.power'] },
      ],
    }],
  }],
});

test('a well-formed template has no errors', () => {
  assert.deepEqual(validateTemplate(good()), []);
});

test('every node needs a key and a title', () => {
  const t = good();
  delete t.topics[0].branches[0].skills[0].title;
  assert.match(validateTemplate(t).join(' '), /title/);
});

test('keys must be unique across the whole tree', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].key = 'calc.rules.power';
  assert.match(validateTemplate(t).join(' '), /calc\.rules\.power/);
});

test('a prerequisite must name a skill that exists', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].requires = ['calc.rules.nope'];
  assert.match(validateTemplate(t).join(' '), /calc\.rules\.nope/);
});

test('a prerequisite may not point at a topic or a branch', () => {
  const t = good();
  t.topics[0].branches[0].skills[1].requires = ['calc.rules'];
  assert.match(validateTemplate(t).join(' '), /calc\.rules/);
});

test('prerequisite cycles are rejected', () => {
  const t = good();
  t.topics[0].branches[0].skills[0].requires = ['calc.rules.quotient'];
  assert.match(validateTemplate(t).join(' ').toLowerCase(), /cycle/);
});

test('a branch with no skills is a mistake, not an empty tree', () => {
  const t = good();
  t.topics[0].branches[0].skills = [];
  assert.ok(validateTemplate(t).length > 0);
});

test('reviewed is either null or a by/date pair', () => {
  const t = good();
  t.reviewed = { by: 'ניקול' };
  assert.match(validateTemplate(t).join(' '), /reviewed/);
  t.reviewed = { by: 'ניקול', date: '2026-09-20' };
  assert.deepEqual(validateTemplate(t), []);
});

test('a non-object is reported rather than thrown over', () => {
  assert.ok(validateTemplate(null).length > 0);
  assert.ok(validateTemplate('{}').length > 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/plan-templates.test.mjs`
Expected: FAIL — cannot find module `templates.ts`.

- [ ] **Step 3: Write the shared vocabulary**

Create `src/lib/plan-status.ts`:

```ts
/**
 * The vocabulary of a learning plan, shared by the server and the page.
 *
 * Lives in $lib (not $lib/server) because the plan page renders these labels;
 * the values themselves are also the CHECK constraints in migration 004, so
 * changing one means changing both.
 */
export type SkillStatus =
  | 'not_checked' | 'started' | 'guided' | 'with_help' | 'independent' | 'needs_review';

/** Display order: how far along the skill is, ending with the flag that pulls
 *  a skill back into the next lesson. */
export const STATUSES: SkillStatus[] = [
  'not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review',
];

export const STATUS_LABEL: Record<SkillStatus, string> = {
  not_checked: 'לא נבדק',
  started: 'התחלה',
  guided: 'בתרגול מודרך',
  with_help: 'בוצע עם עזרה',
  independent: 'בוצע עצמאית',
  needs_review: 'דורש חזרה',
};

/** A prerequisite counts as met at these statuses and no others — "done with
 *  help" is enough to move on, "needs review" is not. */
export const SATISFIED: SkillStatus[] = ['with_help', 'independent'];

export type Evidence = 'lesson' | 'homework' | 'game' | 'test' | 'other';

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  lesson: 'תצפית בשיעור',
  homework: 'שיעורי בית',
  game: 'משחק תרגול',
  test: 'מבחן',
  other: 'אחר',
};

export type Visibility = 'active' | 'paused' | 'hidden';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  active: 'פעיל',
  paused: 'מושהה',
  hidden: 'מוסתר',
};
```

- [ ] **Step 4: Write the validator and loader**

Create `src/lib/server/plans/templates.ts`:

```ts
/**
 * Reviewed skill-tree templates: one per subject and track.
 *
 * These are CONFIG, not content — they live in the repo beside
 * games/registry.json, are read off process.cwd() at runtime, and are copied
 * into the image by their own COPY line in the Dockerfile. They never live
 * under DATA_DIR.
 *
 * validateTemplate() is exported separately from the loader so CI can run it
 * against the shipped files (tests/unit/plan-template-content.test.mjs). A
 * broken template must fail there, in a pull request, rather than at a tutor's
 * first click.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TemplateSkill {
  key: string;
  title: string;
  gloss?: string;
  /** Keys of skills that should come first. May cross topics. */
  requires?: string[];
}

export interface TemplateBranch { key: string; title: string; skills: TemplateSkill[] }
export interface TemplateTopic { key: string; title: string; branches: TemplateBranch[] }

export interface PlanTemplate {
  id: string;
  version: number;
  subject: string;
  track: string;
  questionnaires?: string[];
  source?: string;
  /** null until the tutor has read the tree end to end. */
  reviewed: { by: string; date: string } | null;
  topics: TemplateTopic[];
}

const TEMPLATE_DIR = join(process.cwd(), 'templates', 'plans');

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every problem with `value`, in reading order. Empty means valid. */
export function validateTemplate(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['template is not an object'];

  for (const field of ['id', 'subject', 'track'] as const) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
    errors.push('version must be an integer');
  }
  const reviewed = value.reviewed;
  if (reviewed !== null) {
    if (!isObject(reviewed) || typeof reviewed.by !== 'string' || typeof reviewed.date !== 'string') {
      errors.push('reviewed must be null or { by, date }');
    }
  }

  const topics = value.topics;
  if (!Array.isArray(topics) || topics.length === 0) {
    errors.push('topics must be a non-empty array');
    return errors;
  }

  const keys = new Set<string>();
  const skillKeys = new Set<string>();
  const requires = new Map<string, string[]>();

  const noteKey = (key: unknown, where: string): string | null => {
    if (typeof key !== 'string' || !key.trim()) {
      errors.push(`${where}: key must be a non-empty string`);
      return null;
    }
    if (keys.has(key)) errors.push(`duplicate key ${key}`);
    keys.add(key);
    return key;
  };

  topics.forEach((topic, ti) => {
    if (!isObject(topic)) { errors.push(`topic ${ti} is not an object`); return; }
    noteKey(topic.key, `topic ${ti}`);
    if (typeof topic.title !== 'string' || !topic.title.trim()) errors.push(`topic ${ti}: title is required`);
    const branches = topic.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      errors.push(`topic ${String(topic.key)}: branches must be a non-empty array`);
      return;
    }
    branches.forEach((branch, bi) => {
      if (!isObject(branch)) { errors.push(`branch ${bi} is not an object`); return; }
      noteKey(branch.key, `branch ${bi}`);
      if (typeof branch.title !== 'string' || !branch.title.trim()) errors.push(`branch ${bi}: title is required`);
      const skills = branch.skills;
      if (!Array.isArray(skills) || skills.length === 0) {
        errors.push(`branch ${String(branch.key)}: skills must be a non-empty array`);
        return;
      }
      skills.forEach((skill, si) => {
        if (!isObject(skill)) { errors.push(`skill ${si} is not an object`); return; }
        const key = noteKey(skill.key, `skill ${si}`);
        if (typeof skill.title !== 'string' || !skill.title.trim()) errors.push(`skill ${si}: title is required`);
        if (key) {
          skillKeys.add(key);
          const req = skill.requires ?? [];
          if (!Array.isArray(req)) errors.push(`skill ${key}: requires must be an array`);
          else requires.set(key, req.map(String));
        }
      });
    });
  });

  for (const [key, req] of requires) {
    for (const target of req) {
      if (!skillKeys.has(target)) {
        errors.push(`skill ${key}: requires ${target}, which is not a skill in this template`);
      }
    }
  }

  // Depth-first cycle detection over the prerequisite edges.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (key: string, trail: string[]): void => {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'open') {
      errors.push(`prerequisite cycle: ${[...trail, key].join(' → ')}`);
      return;
    }
    state.set(key, 'open');
    for (const next of requires.get(key) ?? []) {
      if (skillKeys.has(next)) walk(next, [...trail, key]);
    }
    state.set(key, 'done');
  };
  for (const key of skillKeys) walk(key, []);

  return errors;
}

let cache: PlanTemplate[] | null = null;

/** Every valid template on disk. Invalid ones are warned about and skipped, so
 *  one broken file cannot take the page down for every other track. */
export function loadTemplates(): PlanTemplate[] {
  if (cache) return cache;
  let files: string[] = [];
  try {
    files = readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.json')).sort();
  } catch {
    console.warn(`WARNING: ${TEMPLATE_DIR} is missing — no learning-plan templates are available`);
    cache = [];
    return cache;
  }

  const out: PlanTemplate[] = [];
  for (const file of files) {
    const path = join(TEMPLATE_DIR, file);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const errors = validateTemplate(parsed);
      if (errors.length) {
        console.warn(`WARNING: ${path} is not a valid plan template: ${errors.join('; ')}`);
        continue;
      }
      out.push(parsed as PlanTemplate);
    } catch (e) {
      console.warn(`WARNING: ${path} could not be read: ${(e as Error).message}`);
    }
  }
  cache = out;
  return cache;
}

export function templateById(id: string): PlanTemplate | null {
  return loadTemplates().find(t => t.id === id) ?? null;
}

export function templatesForSubject(subject: string): PlanTemplate[] {
  const wanted = subject.trim();
  return loadTemplates().filter(t => t.subject === wanted);
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/plan-templates.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/plan-status.ts src/lib/server/plans/templates.ts tests/unit/plan-templates.test.mjs
git commit -m "Add the plan vocabulary and the template validator

One place defines the six statuses, the evidence kinds and the
visibility values, for both the server and the page. The validator
checks the shape a template must have — three levels, unique keys,
prerequisites that resolve to real skills, and no cycles — and is
exported on its own so CI can run it over the shipped files.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The two math templates

**Files:**
- Create: `templates/plans/math-5u.json`
- Create: `templates/plans/math-4u.json`
- Modify: `Dockerfile` (add a COPY line beside the `games` one)
- Modify: `src/lib/server/boot-checks.ts` (add `checkPlanTemplates`)
- Modify: `src/hooks.server.ts` (call it beside `checkRegistry()`)
- Test: `tests/unit/plan-template-content.test.mjs`

**Interfaces:**
- Consumes: `validateTemplate`, `loadTemplates`, `templateById` from Task 2.
- Produces: templates with ids `math-5u` and `math-4u`, both with `subject: "מתמטיקה"`; `checkPlanTemplates(): void` exported from `boot-checks.ts`.

**Content source.** Build the trees from `docs/superpowers/research/2026-09-12-israeli-math-curriculum.md`. Its tables already carry Ministry Hebrew names, track columns and prerequisites. Map them like this — topic key, branch key, and which research rows become the skills:

| Topic (key / title) | Branch (key / title) | Research rows |
|---|---|---|
| `func` / פונקציות וקדם אנליזה | `func.basics` / פונקציה, גרף ותכונות | F1–F6 |
| | `func.root` / פונקציית שורש | F14 |
| | `func.rational` / פונקציה רציונלית | F17, F18 |
| | `func.explog` / מעריכית ולוגריתמית | F28 |
| `calc` / חשבון דיפרנציאלי | `calc.meaning` / הנגזרת ומשמעותה | F7, F9, F11 |
| | `calc.rules` / כללי גזירה | F8, F12, F15, F19 |
| | `calc.investigate` / חקירת פונקציה | F10, F21, F23, F24 |
| | `calc.extrema` / בעיות קיצון | F13, F16, F20 |
| | `calc.second` / נגזרת שנייה וקעירות | F22 — **5-unit template only** |
| | `calc.trig` / חקירת פונקציות טריגונומטריות | F25 — **5-unit only** |
| | `calc.explog` / גזירת מעריכית ולוגריתמית | F29, F30, F32 |
| `integral` / חשבון אינטגרלי | `integral.basics` / פונקציה קדומה ואינטגרל | F26, F27, F31 |
| `geo` / גיאומטריה של המישור | `geo.lines` / קווים מיוחדים ויחסים | G1–G4, G6, G7 |
| | `geo.similar` / חפיפה ודמיון | G5 (5-unit only), G8, G9 |
| | `geo.circle` / מעגל | G10–G14 (G14 5-unit only) |
| | `geo.proof` / מיומנויות הוכחה | G15 |
| `trig` / טריגונומטריה | `trig.right` / משולש ישר זווית | T1, T2 |
| | `trig.general` / משולש כללי | T4, T5 (T5 5-unit only) |
| | `trig.functions` / פונקציות טריגונומטריות | T3, T6 — **5-unit only** |
| `analytic` / גיאומטריה אנליטית | `analytic.line` / נקודות וישרים | A1–A3 |
| | `analytic.circle` / מעגל | A4, A5 |
| | `analytic.more` / מרחקים ומקומות גאומטריים | A6, A7 — **5-unit only** |
| `prob` / הסתברות | `prob.basics` / מרחב מדגם ומאורעות | P1–P5 |
| | `prob.conditional` / תלות והסתברות מותנית | P6–P10 |
| | `prob.binomial` / התפלגות בינומית | P11 — **5-unit only** |

Rules for the mapping:
- Skill `key` is the branch key plus a short ascii slug, e.g. `calc.rules.quotient`.
- Skill `title` is the research row's Hebrew name, trimmed to something a tutor can scan — keep the Ministry wording, drop parenthetical track notes.
- Skill `gloss` is the row's English gloss.
- `requires` uses the research "Prereq" column, translated from row ids (F8, G6…) to the keys you assigned. Drop any prerequisite whose row is not in that template's track; never leave a dangling key.
- Skip rows marked ✗ for the template's track. For the 4-unit file that means F22, F25, G5, G14, T3, T5, T6, A6, A7, P11 are absent.
- Set `"reviewed": null` in both files. Nikol fills it in after reading them.
- Set `"source"` to the research file path, `"version": 1`, `"subject": "מתמטיקה"`, `"track"` to `"5 יח״ל"` / `"4 יח״ל"`, and `"questionnaires"` to `["35571","35572"]` / `["35471","35472"]`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-template-content.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTemplates, templateById, validateTemplate } from '../../src/lib/server/plans/templates.ts';

const skillsOf = (t) => t.topics.flatMap(topic => topic.branches.flatMap(b => b.skills));
const keysOf = (t) => new Set(skillsOf(t).map(s => s.key));

test('both shipped math templates load and validate', () => {
  const ids = loadTemplates().map(t => t.id).sort();
  assert.deepEqual(ids, ['math-4u', 'math-5u']);
  for (const id of ids) assert.deepEqual(validateTemplate(templateById(id)), [], id);
});

test('each template names its subject, track and questionnaires', () => {
  const five = templateById('math-5u');
  assert.equal(five.subject, 'מתמטיקה');
  assert.deepEqual(five.questionnaires, ['35571', '35572']);
  const four = templateById('math-4u');
  assert.equal(four.subject, 'מתמטיקה');
  assert.deepEqual(four.questionnaires, ['35471', '35472']);
});

test('the five-unit tree carries the topics the task asks for', () => {
  const topics = templateById('math-5u').topics.map(t => t.key);
  for (const key of ['func', 'calc', 'geo', 'prob']) {
    assert.ok(topics.includes(key), `missing topic ${key}: ${topics.join(', ')}`);
  }
});

test('second derivative, concavity and inflection are five-unit only', () => {
  // The Ministry curriculum puts F22 outside the 4-unit programme. A tree that
  // shows it to a 4-unit student would have the tutor teaching off-syllabus.
  assert.ok(keysOf(templateById('math-5u')).has('calc.second.inflection'));
  assert.ok(!keysOf(templateById('math-4u')).has('calc.second.inflection'));
});

test('trigonometric calculus and the cosine law are five-unit only', () => {
  const four = keysOf(templateById('math-4u'));
  const five = keysOf(templateById('math-5u'));
  assert.ok(five.has('calc.trig.investigate') && !four.has('calc.trig.investigate'));
  assert.ok(five.has('trig.general.cosine') && !four.has('trig.general.cosine'));
});

test('the function-investigation branch holds the whole standard sequence', () => {
  for (const id of ['math-4u', 'math-5u']) {
    const keys = keysOf(templateById(id));
    for (const k of ['calc.investigate.polynomial', 'calc.extrema.polynomial', 'calc.rules.quotient']) {
      assert.ok(keys.has(k), `${id} is missing ${k}`);
    }
  }
});

test('every prerequisite resolves inside its own template', () => {
  for (const id of ['math-4u', 'math-5u']) {
    const t = templateById(id);
    const keys = keysOf(t);
    for (const skill of skillsOf(t)) {
      for (const req of skill.requires ?? []) {
        assert.ok(keys.has(req), `${id}: ${skill.key} requires ${req}, which is absent from this track`);
      }
    }
  }
});

test('the four-unit tree is smaller than the five-unit one, and neither is trivial', () => {
  const four = skillsOf(templateById('math-4u')).length;
  const five = skillsOf(templateById('math-5u')).length;
  assert.ok(four >= 40, `4u has only ${four} skills`);
  assert.ok(five > four, `5u (${five}) must cover more than 4u (${four})`);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/plan-template-content.test.mjs`
Expected: FAIL — `loadTemplates()` returns `[]`, so the first assertion's array is empty.

- [ ] **Step 3: Write the two templates**

Create `templates/plans/math-5u.json` and `templates/plans/math-4u.json` following the mapping table above. Shape, with one topic shown in full so the rest is unambiguous:

```json
{
  "id": "math-5u",
  "version": 1,
  "subject": "מתמטיקה",
  "track": "5 יח\"ל",
  "questionnaires": ["35571", "35572"],
  "source": "docs/superpowers/research/2026-09-12-israeli-math-curriculum.md",
  "reviewed": null,
  "topics": [
    {
      "key": "calc",
      "title": "חשבון דיפרנציאלי",
      "branches": [
        {
          "key": "calc.meaning",
          "title": "הנגזרת ומשמעותה",
          "skills": [
            { "key": "calc.meaning.rate", "title": "הנגזרת כקצב שינוי והגדרתה בנקודה", "gloss": "derivative as rate of change", "requires": ["func.basics.graph"] },
            { "key": "calc.meaning.tangent", "title": "משוואת משיק בנקודה שעל הגרף", "gloss": "tangent line at a point", "requires": ["calc.rules.power"] },
            { "key": "calc.meaning.graphs", "title": "הקשר בין גרף הפונקציה לגרף הנגזרת", "gloss": "graph of f vs f'", "requires": ["calc.investigate.polynomial"] }
          ]
        },
        {
          "key": "calc.rules",
          "title": "כללי גזירה",
          "skills": [
            { "key": "calc.rules.power", "title": "נגזרת של חזקה, סכום והפרש, כפל בקבוע", "gloss": "basic differentiation rules", "requires": ["calc.meaning.rate"] },
            { "key": "calc.rules.product", "title": "נגזרת של מכפלה והרכבת פונקציות", "gloss": "product and chain rule", "requires": ["calc.rules.power"] },
            { "key": "calc.rules.root", "title": "נגזרת של פונקציית שורש ויישומיה", "gloss": "derivative of root functions", "requires": ["calc.rules.product", "func.root.pre"] },
            { "key": "calc.rules.quotient", "title": "נגזרת של מנת פונקציות", "gloss": "quotient rule", "requires": ["calc.rules.product", "func.rational.pre"] }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Run the content tests**

Run: `node --test tests/unit/plan-template-content.test.mjs`
Expected: PASS, 8 tests. If a prerequisite fails to resolve, fix the template — never weaken the test.

- [ ] **Step 5: Ship the templates in the image and check them at boot**

In `Dockerfile`, directly below the `COPY --chown=node:node games ./games` line:

```dockerfile
# templates/plans/*.json are read at runtime off process.cwd() (see
# src/lib/server/plans/templates.ts), exactly like games/registry.json above.
COPY --chown=node:node templates ./templates
```

In `src/lib/server/boot-checks.ts`, beside `checkRegistry`:

```ts
/** Warns, like checkRegistry: a broken template disables plan creation for that
 *  track and nothing else, so it must not stop the site from booting. CI is the
 *  real gate (tests/unit/plan-template-content.test.mjs). */
export function checkPlanTemplates(): void {
  const templates = loadTemplates();
  if (!templates.length) {
    console.warn(
      'WARNING: no learning-plan templates loaded — /app/plan can show existing plans but cannot create new ones.',
    );
  }
}
```

Add the import at the top of `boot-checks.ts`:

```ts
import { loadTemplates } from './plans/templates.ts';
```

In `src/hooks.server.ts`, inside the existing `if (!dev) { ... }` block, add `checkPlanTemplates();` after `checkRegistry();` and add it to that file's import from `$server/boot-checks.ts`.

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm test && npm run build && npm run check`
Expected: all tests pass, build succeeds, 0 svelte-check errors.

- [ ] **Step 7: Commit**

```bash
git add templates/plans Dockerfile src/lib/server/boot-checks.ts src/hooks.server.ts tests/unit/plan-template-content.test.mjs
git commit -m "Add reviewed skill trees for four- and five-unit math

Both trees come from the Ministry curriculum research: topic, branch and
skill, with prerequisites as the documents order them. The track
difference is real and tested — second derivative, concavity,
inflection, trigonometric calculus and the cosine law are five-unit
only, so a four-unit student's tree cannot send the tutor off-syllabus.

Both ship with reviewed = null until Nikol has read them; the page says
so. The files reach the image the same way games/registry.json does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The derived view (pure)

**Files:**
- Create: `src/lib/server/plans/view.ts`
- Test: `tests/unit/plan-view.test.mjs`

**Interfaces:**
- Consumes: `SkillStatus`, `SATISFIED` from `$lib/plan-status.ts`.
- Produces:
  - `interface NodeRow { id: number; key: string; parent_id: number | null; kind: 'topic'|'branch'|'skill'; title: string; position: number; visibility: Visibility }`
  - `interface EventRow { id: number; node_id: number | null; type: 'created'|'status'|'visibility'|'move'|'goal'; status: SkillStatus | null; visibility: Visibility | null; note: string | null; evidence: Evidence | null; source: string; at: string }`
  - `interface PrereqRow { skill_id: number; requires_id: number }`
  - `interface SkillView { id, key, title, visibility, status, changed, blocked, blockedBy: string[], recommended }`
  - `interface GroupView { id, key, title, visibility, counts: Record<SkillStatus, number>, children }` (topics hold `branches`, branches hold `skills`)
  - `buildTree(nodes: NodeRow[], prereqs: PrereqRow[], events: EventRow[], lastLessonAt: string | null): TopicView[]`
  - `currentStatus(events: EventRow[], nodeId: number): SkillStatus`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-view.test.mjs`:

```js
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/plan-view.test.mjs`
Expected: FAIL — cannot find module `view.ts`.

- [ ] **Step 3: Write the module**

Create `src/lib/server/plans/view.ts`:

```ts
/**
 * Plan rows in, rendered tree out.
 *
 * PURE — no database, no clock, no filesystem. Every rule the page shows
 * (current status, counts, blocked, changed since the last lesson, recommended)
 * is decided here and tested directly, because these are the judgements a tutor
 * acts on and they must not be buried in a Svelte component or an SQL string.
 */
import { SATISFIED, STATUSES, type Evidence, type SkillStatus, type Visibility } from '$lib/plan-status.ts';

export interface NodeRow {
  id: number;
  key: string;
  parent_id: number | null;
  kind: 'topic' | 'branch' | 'skill';
  title: string;
  position: number;
  visibility: Visibility;
}

export interface EventRow {
  id: number;
  node_id: number | null;
  type: 'created' | 'status' | 'visibility' | 'move' | 'goal';
  status: SkillStatus | null;
  visibility: Visibility | null;
  note: string | null;
  evidence: Evidence | null;
  source: string;
  at: string;
}

export interface PrereqRow { skill_id: number; requires_id: number }

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
}

export type Counts = Record<SkillStatus, number>;

export interface BranchView {
  id: number; key: string; title: string; visibility: Visibility;
  counts: Counts; skills: SkillView[];
}

export interface TopicView {
  id: number; key: string; title: string; visibility: Visibility;
  counts: Counts; branches: BranchView[];
}

const zeroCounts = (): Counts =>
  Object.fromEntries(STATUSES.map(s => [s, 0])) as Counts;

/** The latest status event for a node, or not_checked when there is none.
 *  Ordered by event id: two events can share a timestamp, ids cannot. */
export function currentStatus(events: EventRow[], nodeId: number): SkillStatus {
  let best: EventRow | null = null;
  for (const e of events) {
    if (e.type !== 'status' || e.node_id !== nodeId || !e.status) continue;
    if (!best || e.id > best.id) best = e;
  }
  return best?.status ?? 'not_checked';
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
        countInto(counts, skills);
        return {
          id: branch.id, key: branch.key, title: branch.title,
          visibility: branch.visibility, counts: branchCounts, skills,
        };
      });
      return {
        id: topic.id, key: topic.key, title: topic.title,
        visibility: topic.visibility, counts, branches,
      };
    });
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/unit/plan-view.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/plans/view.ts tests/unit/plan-view.test.mjs
git commit -m "Derive the plan tree from its rows

Current status is the latest status event, counts roll up over visible
skills, a skill is blocked while any prerequisite sits below done-with-
help, and anything after the last lesson's start is marked as changed.
All of it is a pure function, so the rules a tutor acts on are tested
directly rather than through a component.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The store

**Files:**
- Create: `src/lib/server/plans/store.ts`
- Modify: `src/lib/server/entities.ts` (widen the delete-refusal message)
- Modify: `src/routes/api/students/[code]/+server.ts:26-29` (same message)
- Test: `tests/unit/plan-store.test.mjs`

**Interfaces:**
- Consumes: `handle()` from `$server/db.ts`; `PlanTemplate` from Task 2; `NodeRow`, `EventRow`, `PrereqRow` from Task 4.
- Produces:
  - `interface PlanRow { id, student_id, enrollment_id, template_id, template_version, goal, exam_date, focus, created_at }`
  - `createPlan(input: { studentId: number; enrollmentId: number; template: PlanTemplate; goal: string; examDate?: string | null; focus?: string | null }): number`
  - `planForEnrollment(enrollmentId: number): PlanRow | null`
  - `planById(id: number): PlanRow | null`
  - `planData(planId: number): { plan: PlanRow; nodes: NodeRow[]; prereqs: PrereqRow[]; events: EventRow[] }`
  - `nodeInPlan(planId: number, nodeId: number): NodeRow | null`
  - `addStatusEvent(planId: number, nodeId: number, status: SkillStatus, opts?: { note?: string | null; evidence?: Evidence | null }): void`
  - `setVisibility(planId: number, nodeId: number, visibility: Visibility): void`
  - `moveNode(planId: number, nodeId: number, direction: 'up' | 'down'): void`
  - `updateGoal(planId: number, goal: string, examDate: string | null, focus: string | null): void`
  - `lastLessonAt(studentId: number, now?: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/plan-store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'plan-store-')), 'results.db');
const E = await import('../../src/lib/server/entities.ts');
const S = await import('../../src/lib/server/plans/store.ts');
const { handle } = await import('../../src/lib/server/db.ts');

const template = {
  id: 'demo', version: 3, subject: 'מתמטיקה', track: '5 יח״ל', reviewed: null,
  topics: [{
    key: 'calc', title: 'חשבון דיפרנציאלי',
    branches: [{
      key: 'calc.rules', title: 'כללי גזירה',
      skills: [
        { key: 'calc.rules.a', title: 'חוקי חזקות', requires: [] },
        { key: 'calc.rules.b', title: 'כלל המנה', requires: ['calc.rules.a'] },
        { key: 'calc.rules.c', title: 'נגזרת שורש', requires: ['calc.rules.b'] },
      ],
    }],
  }],
};

let seq = 0;
/** A fresh student + enrollment for each test, so plans never collide. */
function freshEnrollment() {
  seq += 1;
  const account = E.createAccount({ name: `משפחה ${seq}`, phone: null, credential: 'x' });
  const student = E.createStudent({ code: `kid${seq}`, name: `תלמיד ${seq}`, accountId: account.id, credential: 'x' });
  E.upsertEnrollment({ studentId: student.id, subject: 'מתמטיקה', level: 'כיתה יא', teacherId: null });
  const enrollment = E.enrollmentsForStudent(student.id)[0];
  return { student, enrollment };
}

const create = (enrollment, student) => S.createPlan({
  studentId: student.id, enrollmentId: enrollment.id, template, goal: 'בגרות 5 יח״ל',
});

test('creating a plan copies every node, keeping keys and order', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const { plan, nodes, prereqs, events } = S.planData(planId);

  assert.equal(plan.template_id, 'demo');
  assert.equal(plan.template_version, 3, 'the plan records which version it copied');
  assert.equal(nodes.length, 5, '1 topic + 1 branch + 3 skills');
  assert.deepEqual(
    nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position).map(n => n.key),
    ['calc.rules.a', 'calc.rules.b', 'calc.rules.c'],
  );
  assert.equal(prereqs.length, 2, 'both requires edges survive the copy');
  assert.equal(events.filter(e => e.type === 'created').length, 1);
});

test('a second plan for the same enrollment is refused', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  assert.throws(() => create(enrollment, student), /UNIQUE/i);
});

test('a failed copy leaves no rows behind', () => {
  const { student, enrollment } = freshEnrollment();
  const broken = { ...template, topics: [{ ...template.topics[0], branches: [{
    key: 'calc.rules', title: 'כללי גזירה',
    skills: [{ key: 'calc.rules.a', title: 'א' }, { key: 'calc.rules.a', title: 'כפול' }],
  }] }] };
  assert.throws(() => S.createPlan({
    studentId: student.id, enrollmentId: enrollment.id, template: broken, goal: 'x',
  }));
  assert.equal(S.planForEnrollment(enrollment.id), null, 'the transaction must have rolled back');
});

test('a status event is appended and readable', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const skill = S.planData(planId).nodes.find(n => n.key === 'calc.rules.a');

  S.addStatusEvent(planId, skill.id, 'guided', { note: 'עבדנו על זה בשיעור', evidence: 'lesson' });
  S.addStatusEvent(planId, skill.id, 'independent', { evidence: 'homework' });

  const statusEvents = S.planData(planId).events.filter(e => e.type === 'status');
  assert.equal(statusEvents.length, 2, 'history is kept, not overwritten');
  assert.equal(statusEvents.at(-1).status, 'independent');
  assert.equal(statusEvents[0].note, 'עבדנו על זה בשיעור');
  assert.equal(statusEvents[0].source, 'teacher');
});

test('visibility changes are applied and logged', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const skill = S.planData(planId).nodes.find(n => n.key === 'calc.rules.c');

  S.setVisibility(planId, skill.id, 'hidden');
  const after = S.planData(planId);
  assert.equal(after.nodes.find(n => n.id === skill.id).visibility, 'hidden');
  assert.equal(after.events.filter(e => e.type === 'visibility').length, 1);
});

test('moving swaps a node with its neighbour and logs the move', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const before = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position);

  S.moveNode(planId, before[2].id, 'up');
  const after = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position);
  assert.deepEqual(after.map(n => n.key), ['calc.rules.a', 'calc.rules.c', 'calc.rules.b']);
  assert.equal(S.planData(planId).events.filter(e => e.type === 'move').length, 1);
});

test('moving past the edge changes nothing and logs nothing', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);
  const first = S.planData(planId).nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position)[0];

  S.moveNode(planId, first.id, 'up');
  const after = S.planData(planId);
  assert.deepEqual(
    after.nodes.filter(n => n.kind === 'skill').sort((a, b) => a.position - b.position).map(n => n.key),
    ['calc.rules.a', 'calc.rules.b', 'calc.rules.c'],
  );
  assert.equal(after.events.filter(e => e.type === 'move').length, 0);
});

test('nodeInPlan refuses a node from another plan', () => {
  const one = freshEnrollment();
  const two = freshEnrollment();
  const planA = create(one.enrollment, one.student);
  const planB = create(two.enrollment, two.student);
  const nodeB = S.planData(planB).nodes[0];

  assert.equal(S.nodeInPlan(planA, nodeB.id), null);
  assert.ok(S.nodeInPlan(planB, nodeB.id));
});

test('the goal edit is stored and logged', () => {
  const { student, enrollment } = freshEnrollment();
  const planId = create(enrollment, student);

  S.updateGoal(planId, 'בגרות 5 יח״ל — מועד קיץ', '2027-06-12', 'חקירת פונקציה רציונלית');
  const { plan, events } = S.planData(planId);
  assert.equal(plan.exam_date, '2027-06-12');
  assert.equal(plan.focus, 'חקירת פונקציה רציונלית');
  assert.equal(events.filter(e => e.type === 'goal').length, 1);
});

test('lastLessonAt takes the most recent booking that has already started', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  const db = handle();
  const book = (start) => db.prepare(
    `INSERT INTO bookings_v2 (student_id, enrollment_id, start, end, duration, at, status)
     VALUES (?, ?, ?, ?, 90, '2026-01-01T00:00:00.000Z', 'confirmed')`
  ).run(student.id, enrollment.id, start, start);

  assert.equal(S.lastLessonAt(student.id, '2026-04-01T00:00:00.000Z'), null, 'no bookings yet');

  book('2026-03-01T10:00:00.000Z');
  book('2026-03-20T10:00:00.000Z');
  book('2026-05-01T10:00:00.000Z'); // still in the future
  assert.equal(S.lastLessonAt(student.id, '2026-04-01T00:00:00.000Z'), '2026-03-20T10:00:00.000Z');
});

test('a student holding a plan cannot be deleted', () => {
  const { student, enrollment } = freshEnrollment();
  create(enrollment, student);
  assert.throws(() => E.deleteStudentCascade(student.code), /FOREIGN KEY|constraint/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test tests/unit/plan-store.test.mjs`
Expected: FAIL — cannot find module `store.ts`.

- [ ] **Step 3: Write the store**

Create `src/lib/server/plans/store.ts`:

```ts
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
import { handle } from '$server/db.ts';
import type { Evidence, SkillStatus, Visibility } from '$lib/plan-status.ts';
import type { EventRow, NodeRow, PrereqRow } from './view.ts';
import type { PlanTemplate } from './templates.ts';

export interface PlanRow {
  id: number;
  student_id: number;
  enrollment_id: number;
  template_id: string;
  template_version: number;
  goal: string;
  exam_date: string | null;
  focus: string | null;
  created_at: string;
}

const now = (): string => new Date().toISOString();

function logEvent(
  planId: number,
  e: { nodeId?: number | null; type: EventRow['type']; status?: SkillStatus | null;
       visibility?: Visibility | null; note?: string | null; evidence?: Evidence | null },
): void {
  handle().prepare(
    `INSERT INTO plan_events (plan_id, node_id, type, status, visibility, note, evidence, source, at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'teacher', ?)`
  ).run(planId, e.nodeId ?? null, e.type, e.status ?? null, e.visibility ?? null,
        e.note ?? null, e.evidence ?? null, now());
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
    const planId = Number(db.prepare(`SELECT last_insert_rowid() AS id`).get().id);

    const insertNode = db.prepare(
      `INSERT INTO plan_nodes (plan_id, key, parent_id, kind, title, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const lastId = () => Number(db.prepare(`SELECT last_insert_rowid() AS id`).get().id);
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
      `SELECT id, node_id, type, status, visibility, note, evidence, source, at
       FROM plan_events WHERE plan_id = ? ORDER BY id`
    ).all(planId) as EventRow[],
  };
}

export function nodeInPlan(planId: number, nodeId: number): NodeRow | null {
  return (handle().prepare(
    `SELECT id, key, parent_id, kind, title, position, visibility FROM plan_nodes WHERE plan_id = ? AND id = ?`
  ).get(planId, nodeId) as NodeRow) ?? null;
}

export function addStatusEvent(
  planId: number, nodeId: number, status: SkillStatus,
  opts: { note?: string | null; evidence?: Evidence | null } = {},
): void {
  logEvent(planId, { nodeId, type: 'status', status, note: opts.note, evidence: opts.evidence });
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
    logEvent(planId, { type: 'goal', note: [goal, examDate, focus].filter(Boolean).join(' · ') });
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
```

- [ ] **Step 4: Widen the deletion message**

A plan is learning history, so the foreign key already refuses the delete. Only the message needs to say so. In `src/routes/api/students/[code]/+server.ts`, change the error text to:

```ts
      error: 'לא ניתן למחוק — יש שיעורים, תשלומים או תכנית למידה שמקושרים לתלמיד/ה הזה/ו',
```

Check `src/lib/server/entities.ts:256` (`deleteStudentCascade`) for a comment listing what blocks a delete, and add the plan to that list if one exists.

- [ ] **Step 5: Run the tests**

Run: `node --test tests/unit/plan-store.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/plans/store.ts src/routes/api/students/\[code\]/+server.ts src/lib/server/entities.ts tests/unit/plan-store.test.mjs
git commit -m "Store learning plans, one transaction per write

Creating a plan copies the template in a single transaction, so a bad
template leaves nothing behind. Every later change appends its event
next to its effect: status, visibility, move and goal. Moving at the
edge of the list does nothing and says nothing.

A student who has a plan can no longer be deleted, which the foreign
key already enforced; the message now names the plan alongside lessons
and payments.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The API

**Files:**
- Create: `src/routes/api/plans/+server.ts`
- Create: `src/routes/api/plans/[id]/events/+server.ts`
- Test: `tests/characterization/plan-api.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 2, 4 and 5; `apiAuthDenied` from `$server/auth.ts`; `readJson` from `$server/http.ts`; `getStudentByCode`, `enrollmentsForStudent` from `$server/entities.ts`.
- Produces: the JSON contract in spec §8. Both endpoints answer `{ plan, tree }` where `tree` is `TopicView[]`, or `{ error }` with the status codes below.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/plan-api.test.mjs`:

```js
// The learning plan is tutor-only, and it is the first thing in the app that
// records a judgement about a child. So these pin two things: that only the
// tutor can read or write it, and that every write lands in the history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl, over = {}) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
    ...over,
  }),
}).then(r => r.json());

const post = (url, body, cookie) => fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

/** Books a student, logs in, and creates a plan on their math enrollment.
 *  The endpoint takes the SUBJECT, not an enrollment id: the roster does not
 *  expose enrollment ids, and the student plus the subject already identify
 *  the enrollment uniquely (enrollments has UNIQUE (student_id, subject)). */
async function withPlan(baseUrl) {
  const booked = await book(baseUrl);
  const cookie = await login(baseUrl);
  const created = await post(`${baseUrl}/api/plans`, {
    code: booked.portal.code, subject: 'מתמטיקה',
    templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
  }, cookie);
  return { booked, cookie, created };
}

test('creating a plan returns the copied tree', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { created } = await withPlan(baseUrl);
    assert.equal(created.status, 200);
    const body = await created.json();
    assert.equal(body.plan.template_id, 'math-5u');
    assert.ok(body.tree.length >= 4, 'the five-unit tree has at least four topics');
    const first = body.tree[0];
    assert.ok(first.branches.length > 0);
    assert.ok(first.branches[0].skills.length > 0);
    assert.equal(first.branches[0].skills[0].status, 'not_checked');
  } finally { await stop(); }
});

test('a second plan for the same subject is refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, booked } = await withPlan(baseUrl);
    const again = await post(`${baseUrl}/api/plans`, {
      code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-5u', goal: 'שוב',
    }, cookie);
    assert.equal(again.status, 409);
  } finally { await stop(); }
});

test('an unknown template, an unenrolled subject, and a mismatched tree are refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl, { subject: 'פיזיקה' });
    const cookie = await login(baseUrl);
    const code = booked.portal.code;

    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'פיזיקה', templateId: 'no-such', goal: 'x' }, cookie)).status, 400);
    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'היסטוריה', templateId: 'math-5u', goal: 'x' }, cookie)).status, 400,
      'the student is not enrolled in that subject');
    assert.equal((await post(`${baseUrl}/api/plans`,
      { code, subject: 'פיזיקה', templateId: 'math-5u', goal: 'x' }, cookie)).status, 400,
      'a maths tree may not be attached to a physics enrollment');
  } finally { await stop(); }
});

test('a status event is recorded, and shows up in the tree', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const skill = body.tree[0].branches[0].skills[0];

    const res = await post(`${baseUrl}/api/plans/${body.plan.id}/events`, {
      type: 'status', nodeId: skill.id, status: 'guided', evidence: 'lesson', note: 'התחלנו',
    }, cookie);
    assert.equal(res.status, 200);
    const after = await res.json();
    const updated = after.tree[0].branches[0].skills[0];
    assert.equal(updated.status, 'guided');
  } finally { await stop(); }
});

test('a status may not be set on a topic, and unknown values are refused', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const topic = body.tree[0];
    const skill = topic.branches[0].skills[0];
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;

    assert.equal((await post(url, { type: 'status', nodeId: topic.id, status: 'guided' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'mastered' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided', evidence: 'vibes' }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'nope', nodeId: skill.id }, cookie)).status, 400);
    assert.equal((await post(url, { type: 'status', nodeId: 999999, status: 'guided' }, cookie)).status, 404);
  } finally { await stop(); }
});

test('hiding and moving are applied and returned', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created } = await withPlan(baseUrl);
    const body = await created.json();
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;
    const skills = body.tree[0].branches[0].skills;

    const hidden = await (await post(url, { type: 'visibility', nodeId: skills[0].id, visibility: 'hidden' }, cookie)).json();
    assert.equal(hidden.tree[0].branches[0].skills[0].visibility, 'hidden');

    const moved = await (await post(url, { type: 'move', nodeId: skills[1].id, direction: 'up' }, cookie)).json();
    assert.equal(moved.tree[0].branches[0].skills[0].key, skills[1].key);
  } finally { await stop(); }
});

test('the plan endpoints are tutor-only', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { cookie, created, booked } = await withPlan(baseUrl);
    const body = await created.json();
    const family = await familySession(booked.portal.link);
    const url = `${baseUrl}/api/plans/${body.plan.id}/events`;
    const skill = body.tree[0].branches[0].skills[0];

    for (const who of [undefined, family]) {
      assert.equal((await post(`${baseUrl}/api/plans`, {
        code: booked.portal.code, subject: 'מתמטיקה', templateId: 'math-4u', goal: 'x',
      }, who)).status, 401);
      assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided' }, who)).status, 401);
    }
    // The tutor still works, so the 401s above are authorization, not breakage.
    assert.equal((await post(url, { type: 'status', nodeId: skill.id, status: 'guided' }, cookie)).status, 200);
  } finally { await stop(); }
});

test('no plan data reaches the family', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const { booked, created } = await withPlan(baseUrl);
    await created.json();
    const family = await familySession(booked.portal.link);

    const portal = await (await fetch(`${baseUrl}/api/portal/${booked.portal.code}?kind=parent`, { headers: { Cookie: family } })).text();
    assert.doesNotMatch(portal, /plan|תכנית למידה/i);

    const parentPage = await (await fetch(`${baseUrl}/app/parent`, { headers: { Cookie: family } })).text();
    assert.doesNotMatch(parentPage, /חשבון דיפרנציאלי/, 'a topic title must not leak into the family view');
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/plan-api.test.mjs`
Expected: FAIL — the create call 404s because the route does not exist.

- [ ] **Step 3: Write the create endpoint**

Create `src/routes/api/plans/+server.ts`:

```ts
/**
 * Creates a learning plan: one enrollment's copy of a reviewed template.
 *
 * Tutor-only. The subject check is the important one — a maths tree attached
 * to a physics enrollment would give the tutor a plan she cannot teach from,
 * and nothing downstream would notice.
 */
import { json } from '@sveltejs/kit';
import { apiAuthDenied } from '$server/auth.ts';
import { readJson } from '$server/http.ts';
import { getStudentByCode, enrollmentsForStudent } from '$server/entities.ts';
import { templateById } from '$server/plans/templates.ts';
import { createPlan, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  const denied = apiAuthDenied(event);
  if (denied) return denied;

  const parsed = await readJson(event.request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;

  const student = getStudentByCode(String(body.code ?? ''));
  if (!student) return json({ error: 'לא נמצא תלמיד/ה' }, { status: 404 });

  // The subject identifies the enrollment: enrollments is UNIQUE per
  // (student, subject), and the roster the tutor comes from carries subject
  // names rather than enrollment ids.
  const subject = String(body.subject ?? '').trim();
  const enrollment = enrollmentsForStudent(student.id).find(e => e.subject === subject);
  if (!enrollment) return json({ error: 'התלמיד/ה אינו/ה רשום/ה למקצוע הזה' }, { status: 400 });

  const template = templateById(String(body.templateId ?? ''));
  if (!template) return json({ error: 'תבנית לא מוכרת' }, { status: 400 });
  if (template.subject !== enrollment.subject) {
    return json({ error: 'התבנית שייכת למקצוע אחר' }, { status: 400 });
  }

  const goal = String(body.goal ?? '').trim();
  if (!goal || goal.length > 200) return json({ error: 'צריך מטרה (עד 200 תווים)' }, { status: 400 });

  const examDate = body.examDate ? String(body.examDate) : null;
  if (examDate && !/^\d{4}-\d{2}-\d{2}$/.test(examDate)) {
    return json({ error: 'תאריך מבחן לא תקין' }, { status: 400 });
  }
  const focus = body.focus ? String(body.focus).slice(0, 200) : null;

  let planId: number;
  try {
    planId = createPlan({ studentId: student.id, enrollmentId: enrollment.id, template, goal, examDate, focus });
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) {
      return json({ error: 'כבר קיימת תכנית למקצוע הזה' }, { status: 409 });
    }
    throw err;
  }

  const { plan, nodes, prereqs, events } = planData(planId);
  return json({ plan, tree: buildTree(nodes, prereqs, events, lastLessonAt(student.id)) });
};
```

- [ ] **Step 4: Write the events endpoint**

Create `src/routes/api/plans/[id]/events/+server.ts`:

```ts
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
import { STATUSES, EVIDENCE_LABEL, VISIBILITY_LABEL, type Evidence, type SkillStatus, type Visibility } from '$lib/plan-status.ts';
import {
  planById, planData, nodeInPlan, addStatusEvent, setVisibility, moveNode, updateGoal, lastLessonAt,
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
    if (evidence && !(evidence in EVIDENCE_LABEL)) return json({ error: 'סוג ראיה לא מוכר' }, { status: 400 });

    const note = body.note ? String(body.note) : null;
    if (note && note.length > 1000) return json({ error: 'ההערה ארוכה מדי' }, { status: 400 });

    addStatusEvent(plan.id, node.id, status, { note, evidence });
  } else if (type === 'visibility') {
    const node = requireNode();
    if (!node) return json(NOT_FOUND, { status: 404 });
    const visibility = String(body.visibility ?? '') as Visibility;
    if (!(visibility in VISIBILITY_LABEL)) return json({ error: 'מצב תצוגה לא מוכר' }, { status: 400 });
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
  });
};
```

- [ ] **Step 5: Run the tests**

Run: `npm run build && node --test tests/characterization/plan-api.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test && npm run check`
Expected: everything passes, 0 svelte-check errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/plans tests/characterization/plan-api.test.mjs src/lib/server/entities.ts
git commit -m "Add the tutor-only plan API

Two endpoints: create a plan from a template, and post one event of any
kind. Every write returns the refreshed tree, so the page never guesses
what happened. A template may not be attached to another subject's
enrollment, a status may not be set on a topic, and a node from another
plan is as absent as a plan that does not exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The page

**Files:**
- Create: `src/routes/app/plan/[code]/+page.server.ts`
- Create: `src/routes/app/plan/[code]/+page.svelte`
- Create: `src/lib/components/plan/PlanTree.svelte`
- Create: `src/lib/components/plan/SkillSheet.svelte`
- Modify: `src/routes/app/dashboard/+page.svelte` (a «תכנית» link in the roster row)
- Test: `tests/characterization/plan-page.test.mjs`

**Interfaces:**
- Consumes: `requireAuth`; `getStudentByCode`, `enrollmentsForStudent`; `planForEnrollment`, `planData`, `lastLessonAt`; `buildTree`; `templatesForSubject`; `STATUSES`, `STATUS_LABEL`, `EVIDENCE_LABEL`.
- Produces: the page at `/app/plan/<code>`; no exports other tasks consume.

- [ ] **Step 1: Write the failing test**

Create `tests/characterization/plan-page.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, login, familySession } from './harness.mjs';

const book = (baseUrl) => fetch(`${baseUrl}/api/book`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'יובל כהן', subject: 'מתמטיקה', level: 'כיתה יא',
    phone: '0501234567', email: 'orit@example.com', durationMin: 90,
    start: '2027-03-15T10:00:00+02:00', end: '2027-03-15T11:30:00+02:00',
  }),
}).then(r => r.json());

test('the plan page needs a tutor session', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const anon = await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { redirect: 'manual' });
    assert.equal(anon.status, 302);
    assert.equal(anon.headers.get('location'), '/login');

    const family = await familySession(booked.portal.link);
    const asFamily = await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, {
      headers: { Cookie: family }, redirect: 'manual',
    });
    assert.equal(asFamily.status, 302, 'a family session is not a tutor session');
  } finally { await stop(); }
});

test('with no plan yet, the page offers to create one from a matching template', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { headers: { Cookie: cookie } })).text();

    assert.match(html, /יובל כהן/);
    assert.match(html, /מתמטיקה/, 'the subject chip');
    assert.match(html, /5 יח/, 'the five-unit template is offered');
    assert.match(html, /4 יח/, 'so is the four-unit one');
  } finally { await stop(); }
});

test('an existing plan renders its topics and counts', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    const students = await (await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } })).json();
    const student = students.students.find(s => s.code === booked.portal.code);

    await fetch(`${baseUrl}/api/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        code: booked.portal.code, subject: 'מתמטיקה',
        templateId: 'math-5u', goal: 'בגרות 5 יח״ל',
      }),
    });

    const html = await (await fetch(`${baseUrl}/app/plan/${booked.portal.code}`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /חשבון דיפרנציאלי/, 'a topic from the template');
    assert.match(html, /לא נבדק/, 'the untouched count');
    assert.match(html, /התבנית טרם נסקרה/, 'reviewed is null in the shipped templates');
  } finally { await stop(); }
});

test('an unknown student is a 404, not a blank page', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const cookie = await login(baseUrl);
    const res = await fetch(`${baseUrl}/app/plan/nosuchkid`, { headers: { Cookie: cookie } });
    assert.equal(res.status, 404);
  } finally { await stop(); }
});

test('the dashboard links to the plan page for each student', async () => {
  const { baseUrl, stop } = await startServer();
  try {
    const booked = await book(baseUrl);
    const cookie = await login(baseUrl);
    const html = await (await fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: cookie } })).text();
    assert.match(html, /\/app\/plan\//, 'the roster must offer a way in');
    assert.ok(booked.portal.code.length > 0);
  } finally { await stop(); }
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run build && node --test tests/characterization/plan-page.test.mjs`
Expected: FAIL — `/app/plan/<code>` 404s.

- [ ] **Step 3: Write the page load**

Create `src/routes/app/plan/[code]/+page.server.ts`:

```ts
/**
 * The learning plan, for the tutor alone.
 *
 * Rendered server-side rather than fetched after mount: the tree is the whole
 * point of the page, and a spinner in front of it buys nothing. Everything the
 * page can show is decided here, including which templates could start a plan
 * for a subject that has none.
 */
import { error } from '@sveltejs/kit';
import { requireAuth } from '$server/auth.ts';
import { getStudentByCode, enrollmentsForStudent } from '$server/entities.ts';
import { templatesForSubject, templateById } from '$server/plans/templates.ts';
import { planForEnrollment, planData, lastLessonAt } from '$server/plans/store.ts';
import { buildTree } from '$server/plans/view.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  requireAuth(event);

  const student = getStudentByCode(event.params.code);
  if (!student) error(404, 'לא נמצא');

  const enrollments = enrollmentsForStudent(student.id);
  const wanted = event.url.searchParams.get('subject');
  const current = enrollments.find(e => e.subject === wanted) ?? enrollments[0] ?? null;

  const plan = current ? planForEnrollment(current.id) : null;
  const lesson = lastLessonAt(student.id);

  return {
    student: { code: student.code, name: student.name },
    subjects: enrollments.map(e => ({ id: e.id, subject: e.subject, level: e.level })),
    current: current ? { id: current.id, subject: current.subject } : null,
    plan: plan
      ? {
          row: plan,
          tree: buildTree(...(({ nodes, prereqs, events }) => [nodes, prereqs, events, lesson] as const)(planData(plan.id))),
          templateReviewed: templateById(plan.template_id)?.reviewed ?? null,
        }
      : null,
    templates: current
      ? templatesForSubject(current.subject).map(t => ({ id: t.id, track: t.track, reviewed: t.reviewed }))
      : [],
  };
};
```

- [ ] **Step 4: Write the page and its two components**

Create `src/lib/components/plan/PlanTree.svelte` — topics and branches as disclosure buttons, skill rows with their status pill, the `●` changed marker and the `🔒` blocked marker, emitting `onselect(skill)` when a row is tapped:

```svelte
<script lang="ts">
  import { STATUS_LABEL, type SkillStatus } from '$lib/plan-status.ts';

  interface Skill {
    id: number; key: string; title: string; visibility: string;
    status: SkillStatus; changed: boolean; blocked: boolean; blockedBy: string[]; recommended: boolean;
  }
  interface Branch { id: number; key: string; title: string; visibility: string; counts: Record<string, number>; skills: Skill[] }
  interface Topic { id: number; key: string; title: string; visibility: string; counts: Record<string, number>; branches: Branch[] }

  let { topics, filter, onselect }: {
    topics: Topic[];
    filter: 'all' | 'recommended' | 'needs_review' | 'blocked' | 'changed';
    onselect: (skill: Skill) => void;
  } = $props();

  let open = $state<Record<number, boolean>>({});
  const toggle = (id: number) => { open[id] = !open[id]; };

  function keep(s: Skill): boolean {
    if (s.visibility === 'hidden') return false;
    if (filter === 'recommended') return s.recommended;
    if (filter === 'needs_review') return s.status === 'needs_review';
    if (filter === 'blocked') return s.blocked;
    if (filter === 'changed') return s.changed;
    return true;
  }

  /** "4 עצמאי · 2 בתרגול" — only the statuses that actually occur. */
  function summary(counts: Record<string, number>): string {
    return Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${STATUS_LABEL[status as SkillStatus]}`)
      .join(' · ');
  }
</script>

{#each topics.filter(t => t.visibility !== 'hidden') as topic (topic.id)}
  <section class="topic">
    <button class="row group" aria-expanded={!!open[topic.id]} onclick={() => toggle(topic.id)}>
      <span class="caret">{open[topic.id] ? '▾' : '▸'}</span>
      <span class="title">{topic.title}</span>
      <span class="counts">{summary(topic.counts)}</span>
    </button>

    {#if open[topic.id]}
      {#each topic.branches.filter(b => b.visibility !== 'hidden') as branch (branch.id)}
        {@const visible = branch.skills.filter(keep)}
        {#if visible.length}
          <button class="row group branch" aria-expanded={!!open[branch.id]} onclick={() => toggle(branch.id)}>
            <span class="caret">{open[branch.id] ? '▾' : '▸'}</span>
            <span class="title">{branch.title}</span>
            <span class="counts">{summary(branch.counts)}</span>
          </button>

          {#if open[branch.id]}
            {#each visible as skill (skill.id)}
              <button class="row skill" class:paused={skill.visibility === 'paused'} onclick={() => onselect(skill)}>
                <span class="title">
                  {skill.title}
                  {#if skill.changed}<span class="dot" title="השתנה מאז השיעור האחרון">●</span>{/if}
                  {#if skill.blocked}<span class="lock" title="חסום: {skill.blockedBy.join(', ')}">🔒</span>{/if}
                </span>
                <span class="pill" data-status={skill.status}>{STATUS_LABEL[skill.status]}</span>
              </button>
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}
  </section>
{/each}

<style>
  .row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    min-height: 44px; padding: 8px 10px; background: none; border: none;
    border-bottom: 1px solid var(--border); font-family: inherit;
    font-size: .92rem; color: var(--text-primary); text-align: right; cursor: pointer;
  }
  .group { font-weight: 800; }
  .branch { padding-inline-start: 22px; font-size: .88rem; }
  .skill { padding-inline-start: 40px; font-weight: 500; }
  .skill.paused { opacity: .55; }
  .title { flex: 1; min-width: 0; }
  .counts { font-size: .75rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
  .caret { color: var(--text-muted); }
  .dot { color: var(--accent2-strong); font-size: .7rem; vertical-align: middle; }
  .pill {
    font-size: .75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); color: var(--text-muted); white-space: nowrap;
  }
  .pill[data-status='independent'] { color: var(--accent3-strong); border-color: var(--accent3-strong); }
  .pill[data-status='needs_review'] { color: var(--danger); border-color: var(--danger); }
  .pill[data-status='guided'], .pill[data-status='with_help'] { color: var(--accent); border-color: var(--accent); }
</style>
```

Create `src/lib/components/plan/SkillSheet.svelte` — the six statuses, evidence, note, prerequisites and history, calling `onsave({ status, evidence, note })`, `onvisibility(v)`, `onmove(direction)` and `onclose()`. Follow the same CSS conventions: 44px controls, tokens only, `position: fixed` bottom sheet under 700px and a right-hand panel above it.

Create `src/routes/app/plan/[code]/+page.svelte` — header with the back link and student name, subject chips linking to `?subject=...`, the goal line with an edit toggle, the unreviewed banner, the filter chips, `<PlanTree>`, the hidden-items list, and the create card when `data.plan` is null. Every mutation posts to `/api/plans` or `/api/plans/<id>/events` and replaces local state with the `tree` from the response; a non-ok response shows the error text in a banner and leaves the previous state alone.

- [ ] **Step 5: Link it from the dashboard roster**

In `src/routes/app/dashboard/+page.svelte`, in the roster row's first cell (beside `{rs.name}`), add:

```svelte
                <a class="copy-btn" href="/app/plan/{rs.code}">תכנית</a>
```

- [ ] **Step 6: Run the tests**

Run: `npm run build && node --test tests/characterization/plan-page.test.mjs && npm test && npm run check`
Expected: all pass, 0 svelte-check errors.

- [ ] **Step 7: Check it in a browser**

Boot the built app with a tutor session (reuse the scratchpad `serve.mjs` pattern from earlier sessions: `startServer()` + `login()`, print URL and cookie), then drive Chromium at 320, 390, 430 and 1280px and confirm:
- create card → plan appears;
- expanding a topic and a branch, opening a skill, setting a status, and the counts changing;
- each filter chip narrows the list as described;
- hide then restore from «מוסתרים»;
- no horizontal scroll at any width, every control at least 44px tall.

Record the numbers for the PR. Do not commit the script.

- [ ] **Step 8: Commit**

```bash
git add src/routes/app/plan src/lib/components/plan src/routes/app/dashboard/+page.svelte tests/characterization/plan-page.test.mjs
git commit -m "Add the tutor's learning-plan page

One page per student and subject, reached from the roster: topics and
branches open to their skills, each skill showing its status, whether it
moved since the last lesson, and what still blocks it. Setting a status
takes a note and an evidence kind, and the sheet shows the history
underneath.

Rendered server-side, because the tree is the page. Writes go through
the events endpoint and the view is replaced by what the server returns,
so the screen can never show a status the database does not have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** §4 templates → Tasks 2 and 3. §5 schema → Task 1. §6 derived rules → Task 4. §7 page → Task 7. §8 modules, API, errors, authorization, deletion → Tasks 2, 5, 6. §10 testing → the test step of every task, plus the browser pass in Task 7 Step 7. §9 (deliberately undecided) needs no task. §11 consequences need no task.

**Placeholders.** None: every step carries the code or the exact edit. Task 3's template content is specified as a row-by-row mapping from the research tables rather than 140 skills of inline JSON; the shape is shown in full and the content tests pin the parts that must not drift.

**Type consistency.** `SkillStatus`, `Evidence`, `Visibility` are defined once in Task 2 and imported by Tasks 4, 5, 6 and 7. `NodeRow`, `EventRow`, `PrereqRow` are defined in Task 4 and imported by Task 5. `buildTree(nodes, prereqs, events, lastLessonAt)` keeps that signature in Tasks 4, 6 and 7. `createPlan`, `planData`, `nodeInPlan`, `addStatusEvent`, `setVisibility`, `moveNode`, `updateGoal`, `lastLessonAt` are named identically in Tasks 5, 6 and 7.

**One thing checked while writing this.** `roster()` returns subjects as one concatenated string and exposes no enrollment id. Rather than widen a projection the dashboard already uses, `POST /api/plans` takes the subject and resolves the enrollment server-side, which `enrollments`' UNIQUE (student_id, subject) makes unambiguous. The spec's §8 contract was updated to match.
