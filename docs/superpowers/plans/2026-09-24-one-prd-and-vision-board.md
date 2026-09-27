# One PRD and a Vision Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge every colliding vision document into a single `PRODUCT.md`, add a read-only script that measures the vision's targets, label Todoist by pillar, and publish a Hebrew vision board built from all three.

**Architecture:** There are two PRs: PR 1 is docs only, PR 2 adds one self-contained script and its test. The Todoist writes and the board come after them and change no code. The metrics script has no imports from `src/`, so it can be piped into the running container over SSH (`docker exec -i … node -`) without shipping `scripts/` in the image.

**Tech Stack:** Markdown; Node 22 `node:sqlite` (`DatabaseSync`, the same driver as `src/lib/server/db.ts`); `node --test`; the `td` CLI (todoist-cli skill); the Artifact tool.

**Spec:** `docs/superpowers/specs/2026-09-24-one-prd-and-vision-board-design.md`. Read it first. Every vision fact below is copied from it.

## Global Constraints

- One PRD: `PRODUCT.md` at the repo root, in **English**. When sources disagree, `PRODUCT.md` wins. Git is the history; nothing is kept "for history."
- `PRODUCT.md` must keep the `<!-- impeccable:product-schema 1 -->` marker and the exact heading `## Accessibility & Inclusion`, because `tests/unit/tokens-contrast.test.mjs` cites it.
- Never read, list the contents of, or commit `mea-beclick-kb/students/` or `mea-beclick-kb/pricing/`.
- Do not stage the untracked work in progress that already exists in the tree (`src/lib/server/lesson/targeting.ts`, `src/lib/server/migrations/014_homework_skill_link.ts`, `tests/unit/lesson-skill-link.test.mjs`, `tests/unit/plan-target-skill.test.mjs`). It isn't ours. Always `git add` explicit paths, never `-A` or `.`.
- Generation writes the **legacy `lessons`** table (`src/lib/server/db.ts:192`, status `generating | ready | held | failed`). `lessons_v2` is `unadopted` in `src/lib/server/storage-inventory.ts` and **must not be read**.
- Money is integer agorot. `payments.status ∈ owed | paid | void`, and `kind ∈ single | double | triple`.
- Timezone is `Asia/Jerusalem`.
- Merging to `main` deploys. After every merge, check the post-merge GitHub Actions run, not just the PR checks.
- Commit trailer, on every commit:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014gnmLf7wB32DTbu6PPgY49
  ```
- The PR body ends with:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_014gnmLf7wB32DTbu6PPgY49
  ```

---

### Task 1: Rewrite `PRODUCT.md` as the one PRD (PR 1, part 1)

**Files:**
- Modify: `PRODUCT.md` (full rewrite)
- Read (sources, not modified here): `mea-beclick-kb/notes/PRD.md`, `mea-beclick-kb/notes/Business Overview.md`, `mea-beclick-kb/notes/Architecture Overview.md`, `mea-beclick-kb/notes/Decision — Public to Private Repo.md`

**Interfaces:**
- Produces: `PRODUCT.md` with the section headings listed in Step 2. Task 6 (the board) reads it, and Task 2 points the other docs at it.

- [ ] **Step 1: Check each stale claim against the code before rewriting it.** Run these and note the answers:

```bash
cd /home/liornisimov/Projects/mea-beclick
# v2 wired? Expect runtime importers of entities.ts under src/routes and src/lib/server.
grep -rln "entities.ts\|from './entities'\|from '\$lib/server/entities'" src | head
# Engine: Codex or Anthropic?
grep -rn -i "codex\|anthropic" src/lib/server/lesson/spawn.ts src/lib/server/lesson/engine.ts | head
# Magic links shipped? Expect family-auth.ts signing + /enter route.
ls src/routes/enter src/lib/server/family-auth.ts
# Booking collects an email?
grep -n -i "email" src/routes/api/book/+server.ts | head -5
# Accent contrast still failing?
grep -rn -i "fa8231" src static tests | head
# Tutor still hardcoded?
grep -rn "ניקול" src/lib/server/enroll.ts
# Legacy tables still live/draining
sed -n 40,140p src/lib/server/storage-inventory.ts
```

Write what you find into the PRD, not what the old files say. If a check contradicts the spec, the code wins. Record the contradiction in the PR description.

- [ ] **Step 2: Write the new `PRODUCT.md`.** Use exactly these top-level sections, in this order, with the content listed:

```markdown
# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Vision — through Bagrut, June 2027
   Copy spec §2 verbatim in substance: Phase A (now → 2027-03-31) / Phase B trigger
   (all three: both calendars full · prep ≤10 min/lesson · families waiting),
   north stars ranked (1 Nikol's prep time, 2 parent sees progress without asking),
   the targets table with its "measured by" column, the gate (10 clean Codex
   production runs in a row), and decision authority (Lior decides all).
   Add one line: "Measured by `scripts/vision-metrics.mjs` at the monthly check-in."

## Pillars
   One ### per pillar, in order: Lesson autopilot · Progress parents can see ·
   Word of mouth · Ninety minutes by default · Ready for a third tutor ·
   Floor: reliability. Each has 2–3 sentences: what "done for phase A" means,
   plus a link line: `Todoist: label pillar-autopilot` (etc.; floor = `@Infra`).
   Phase A done-criteria:
   - Autopilot: generated plan+slides+homework reach the student page without
     Nikol touching them for ≥80% of lessons (strict); homework comes from what
     was taught; she can edit when she must.
   - Progress: a parent's page shows what was covered and what was understood,
     from reports and practice evidence, without asking.
   - Word of mouth: every booking records where the family heard of us; a parent
     can share progress.
   - Ninety minutes: booking recommends כפול; families average ~90 min/week.
   - Third tutor: no tutor name hardcoded; a third tutor could be added as data.
   - Floor: backups restore, deploys pin a commit, calendar/mail failures reach
     the tutor.

## Non-goals (this horizon)
   The six from spec §2, one bullet each.

## Binding decisions
   Pricing יחיד ₪120 / כפול ₪215 / משולש ₪300, source `src/lib/plans.ts`;
   Codex is the lesson engine, auth is a local file (`codex login`), not a cloud key;
   no PIN / no family password — signed links; payments are recorded by hand,
   automatic collection rejected 2026-08-23; two tutors named and shown by face;
   the repo is private (fold in the Decision note's decision + reason, 2–4 lines);
   student/payment PII never in the repo (point to the 2026-09-18 spec).

## Users
   Carry over the four user paragraphs from the old PRODUCT.md. Tutor line
   becomes: "Tutor: Nikol. Owner: Lior, who also builds the platform and makes
   every product decision."

## Positioning
   Carry over.

## Product Principles
   Carry over 1–5 unchanged in meaning.

## Terminology
   Carry over the קישור אישי / קוד צירוף / חשבון / תלמיד/ה glossary, in the
   present tense (the rebuild has shipped).

## Brand Commitments
   Carry over; drop the "one paid session" figure (it is a dated number — the
   metrics script is the source now) but keep "do not fabricate volume,
   ratings, or customer counts".

## Accessibility & Inclusion
   Carry over; restate the #fa8231 item only if Step 1 found it still present.

## System in brief
   ≤40 lines: one line per subsystem (booking, dashboard, family portal, games,
   lesson generation, learning plans & reports, payments ledger, calendar,
   email + cron); data model (entity model is authoritative; `lessons` is the
   live generation table, `lessons_v2` unadopted; name the draining tables from
   storage-inventory.ts); channels (email + wa.me; CallMeBot reaches only the
   tutor); hosting (one Node process, SvelteKit adapter-node, SQLite under
   DATA_DIR, Docker Compose + Caddy on a VPS, deploy on merge to main).
   Point to `server/README.md` and `src/lib/server/storage-inventory.ts` for detail.

## Source of truth
   Production → origin/main → this file → Todoist (the backlog). Git holds
   the history; there is no history section and no task table here.
```

The indented notes are instructions, not literal text. Write real prose in their place. No "TBD." Keep the whole file under about 350 lines.

- [ ] **Step 3: Check that the contrast test still passes.**

Run: `node --test tests/unit/tokens-contrast.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add PRODUCT.md
git commit -m "Make PRODUCT.md the one PRD, with the vision through Bagrut 2027" -m "<trailer>"
```

---

### Task 2: Delete the colliding notes and repoint (PR 1, part 2)

**Files:**
- Delete: `mea-beclick-kb/notes/PRD.md`, `mea-beclick-kb/notes/Business Overview.md`, `mea-beclick-kb/notes/Architecture Overview.md`, `mea-beclick-kb/notes/Decision — Public to Private Repo.md`, `mea-beclick-kb/_templates/Note Template.md`
- Modify: `mea-beclick-kb/Home.md`, `CLAUDE.md` (Knowledgebase section), `README.md` (the `mea-beclick-kb/` table row)

**Interfaces:**
- Consumes: `PRODUCT.md` from Task 1.

- [ ] **Step 1: Confirm that nothing outside the dated docs still needs these files.**

```bash
grep -rn "PRD.md\|Business Overview\|Architecture Overview\|Public to Private\|Note Template" \
  --exclude-dir=node_modules --exclude-dir=.svelte-kit --exclude-dir=build --exclude-dir=.git . \
  | grep -v -e "^./docs/superpowers/" -e "^./.impeccable/" -e "kb/students" -e "kb/pricing"
```

Expected: hits only in the files this task modifies, plus the notes being deleted. Any other hit gets repointed to `PRODUCT.md` in this task.

- [ ] **Step 2: Delete the notes.**

```bash
git rm "mea-beclick-kb/notes/PRD.md" "mea-beclick-kb/notes/Business Overview.md" \
  "mea-beclick-kb/notes/Architecture Overview.md" \
  "mea-beclick-kb/notes/Decision — Public to Private Repo.md" \
  "mea-beclick-kb/_templates/Note Template.md"
```

- [ ] **Step 3: Rewrite `mea-beclick-kb/Home.md` to this:**

```markdown
# mea-beclick-kb

The product requirements, vision and binding decisions live in one file:
[`PRODUCT.md`](../PRODUCT.md) at the repo root. Git holds the history.

`students/` and `pricing/` hold real student and payment records. They are
untracked, exist only on the tutor's disk, and are never committed — see
`docs/superpowers/specs/2026-09-18-student-records-out-of-the-repo-design.md`.
```

- [ ] **Step 4: Edit the Knowledgebase section of `CLAUDE.md`.** Replace the first paragraph and the `notes/` bullet so that the section reads:

```markdown
## Knowledgebase

Product requirements, the vision, and binding decisions live in one file:
`PRODUCT.md` at the repo root. It overrides any other document that
disagrees; git is the history.

- `mea-beclick-kb/students/`, `mea-beclick-kb/pricing/` — real student and
  payment records (PII — see below). ...
```

Keep the rest of the PII bullet and the Company context section word for word.

- [ ] **Step 5: Edit the `mea-beclick-kb/` row in `README.md`** so its text says (in Hebrew, matching the file): the PRD is `PRODUCT.md`; the vault holds only the local, untracked student and payment folders.

- [ ] **Step 6: Run the full suite.**

Run: `npm test`
Expected: the same pass/fail count as `main`. Run `git stash -u` first only if you need a baseline, and restore it afterwards. The untracked work-in-progress files may add their own failures, and those are not caused by this PR.

- [ ] **Step 7: Commit, push, and open PR 1.**

```bash
git add mea-beclick-kb/Home.md CLAUDE.md README.md
git commit -m "Fold the vault's notes into PRODUCT.md and delete them" -m "<trailer>"
git push -u origin docs/one-prd-vision-board
gh pr create --title "One PRD: fold every vision doc into PRODUCT.md" --body "<summary + stale-claim findings from Task 1 Step 1 + footer>"
```

The PR includes the spec and this plan (already committed on the branch). After Lior merges it, check the post-merge run: `gh run list --branch main --limit 1`, then `gh run watch <id>`.

---

### Task 3: `scripts/vision-metrics.mjs`, test-first (PR 2)

Branch from updated `main`: `git switch main && git pull && git switch -c feat/vision-metrics`.

**Files:**
- Create: `scripts/vision-metrics.mjs`
- Test: `tests/unit/vision-metrics.test.mjs`
- Modify: `server/README.md` (one "how to run" paragraph)

**Interfaces:**
- Produces: `export function measure(db: DatabaseSync, now: Date): Metrics` where

```
Metrics = {
  activeStudents: number,
  autogen: { units: number, strict: number | null, lenient: number | null },  // shares 0..1, null when units = 0
  revenue: { month: 'YYYY-MM', paidAgorot: number, owedAgorot: number },
  gate: { streak: number, target: 10 },
  notes: string[],
}
```

  and a CLI that prints it (`--json` prints the raw object). Task 5 runs the CLI, and Task 6 reads its JSON.

Definitions (from the spec):
- **Active student**: a distinct `bookings_v2.student_id` with `status != 'cancelled'` and `end` in `(now − 30d, now]`.
- **Autogen unit**: a `(lesson_slug, kind)` pair in `lesson_materials` with at least one version whose `published_at` falls in `(now − 30d, now]`. It's **strict** when no version of the pair has `origin = 'edited'`, and **lenient** when the pair's lowest version has `origin = 'generated'`.
- **Revenue**: payments whose `date` falls in the previous calendar month in Asia/Jerusalem, summed separately for `paid` and `owed`. `void` is ignored.
- **Gate streak**: rows of legacy `lessons` with `status IN ('ready','held','failed')`, newest `at` first. Count the leading `ready` rows.
- A note is always printed: "homework has no origin column; its share is not measured separately — a `ready` lesson's homework was generated with it."

- [ ] **Step 1: Write the failing test.**

```js
// tests/unit/vision-metrics.test.mjs
/**
 * The vision's targets (PRODUCT.md, "Vision") measured from tables that
 * already exist. Read-only: the script never writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'vision-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');   // builds legacy tables + runs migrations
handle();
const { measure } = await import('../../scripts/vision-metrics.mjs');

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const db = new DatabaseSync(process.env.DB_PATH);
db.exec(`
  INSERT INTO accounts (id, name, credential, created_at) VALUES (1, 'a', 'x', '${daysAgo(90)}');
  INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
    (1, 's1', 'one', 1, 'x', '${daysAgo(90)}'),
    (2, 's2', 'two', 1, 'x', '${daysAgo(90)}'),
    (3, 's3', 'three', 1, 'x', '${daysAgo(90)}'),
    (4, 's4', 'four', 1, 'x', '${daysAgo(90)}');
`);
const booking = db.prepare(
  `INSERT INTO bookings_v2 (student_id, start, "end", at, status) VALUES (?, ?, ?, ?, ?)`);
booking.run(1, daysAgo(3), daysAgo(3), daysAgo(10), 'confirmed');   // active
booking.run(1, daysAgo(10), daysAgo(10), daysAgo(20), 'confirmed'); // same student, counted once
booking.run(2, daysAgo(40), daysAgo(40), daysAgo(50), 'confirmed'); // too old
booking.run(3, daysAgo(2), daysAgo(2), daysAgo(9), 'cancelled');    // cancelled
booking.run(4, daysAgo(-2), daysAgo(-2), daysAgo(1), 'confirmed');  // future, not yet taught

const mat = db.prepare(`INSERT INTO lesson_materials
  (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, ?, ?, '{}', ?, ?, ?)`);
mat.run('L1', 'plan', 1, 'generated', daysAgo(5), daysAgo(5));   // strict + lenient
mat.run('L1', 'slides', 1, 'generated', null, daysAgo(5));       // lenient only:
mat.run('L1', 'slides', 2, 'edited', daysAgo(4), daysAgo(4));    //   tutor edited it
mat.run('L2', 'plan', 1, 'edited', daysAgo(6), daysAgo(6));      // neither
mat.run('L3', 'plan', 1, 'generated', daysAgo(60), daysAgo(60)); // out of window
mat.run('L4', 'plan', 1, 'generated', null, daysAgo(2));         // never published

const pay = db.prepare(`INSERT INTO payments
  (account_id, student_id, date, kind, amount_agorot, status) VALUES (1, 1, ?, 'double', ?, ?)`);
pay.run('2026-09-03', 21500, 'paid');
pay.run('2026-09-20', 21500, 'owed');
pay.run('2026-09-25', 12000, 'void');
pay.run('2026-10-01', 30000, 'paid'); // current month, excluded
pay.run('2026-08-31', 12000, 'paid'); // two months ago, excluded

const lesson = db.prepare(`INSERT INTO lessons (slug, student, at, status) VALUES (?, 'x', ?, ?)`);
lesson.run('g1', daysAgo(9), 'failed');
lesson.run('g2', daysAgo(8), 'ready');
lesson.run('g3', daysAgo(7), 'held');
lesson.run('g4', daysAgo(6), 'ready');
lesson.run('g5', daysAgo(5), 'ready');
lesson.run('g6', daysAgo(1), 'generating'); // in flight, not a run outcome yet

const m = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);

test('an active student is one taught lesson in the last 30 days, counted once', () => {
  assert.equal(m.activeStudents, 1);
});

test('autogen share: strict excludes anything the tutor edited, lenient only asks where it started', () => {
  assert.equal(m.autogen.units, 3);                    // L1/plan, L1/slides, L2/plan
  assert.equal(m.autogen.strict, 1 / 3);
  assert.equal(m.autogen.lenient, 2 / 3);
});

test('revenue is last calendar month, paid and owed apart, void ignored', () => {
  assert.deepEqual(m.revenue, { month: '2026-09', paidAgorot: 21500, owedAgorot: 21500 });
});

test('the gate streak counts consecutive clean runs from the newest finished one', () => {
  assert.deepEqual(m.gate, { streak: 2, target: 10 });
});

test('it says out loud what it cannot measure', () => {
  assert.ok(m.notes.some((n) => n.includes('homework')));
});

test('an empty window reports null shares, not zero', () => {
  const empty = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), new Date('2030-01-01T00:00:00Z'));
  assert.equal(empty.autogen.units, 0);
  assert.equal(empty.autogen.strict, null);
  assert.equal(empty.activeStudents, 0);
});
```

- [ ] **Step 2: Run it and check that it fails.**

Run: `node --test tests/unit/vision-metrics.test.mjs`
Expected: FAIL with `Cannot find module '.../scripts/vision-metrics.mjs'`. If it instead fails on the fixture inserts (for example a NOT NULL column that migrations 013/014 added), fix the fixture to match the real schema, not the other way around.

- [ ] **Step 3: Write the script.**

```js
#!/usr/bin/env node
/**
 * The vision's targets (PRODUCT.md, "Vision"), measured from tables that
 * already exist. Read-only. Deliberately imports nothing from src/: it has
 * to run inside the production container by being piped to `node -`,
 * and the runtime image ships build/, not scripts/ or src/.
 *
 *   node scripts/vision-metrics.mjs [--json]           # local, DATA_DIR/results.db
 *   ssh mea 'docker exec -i <container> node --input-type=module - --json' < scripts/vision-metrics.mjs
 *
 * Generation outcomes are read from the legacy `lessons` table on purpose:
 * that is the one generation writes. lessons_v2 is unadopted and reading
 * it answers empty (src/lib/server/storage-inventory.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
const GATE_TARGET = 10;

const inWindow = (iso, from, to) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t > from && t <= to;
};

/** 'YYYY-MM' of the calendar month before `now`, in Israel. */
function previousMonth(now) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

export function measure(db, now) {
  const to = now.getTime();
  const from = to - 30 * DAY;

  const taught = db.prepare(`SELECT student_id, "end" FROM bookings_v2 WHERE status != 'cancelled'`).all();
  const activeStudents = new Set(taught.filter((b) => inWindow(b.end, from, to)).map((b) => b.student_id)).size;

  const units = new Map();
  for (const r of db.prepare(`SELECT lesson_slug, kind, version, origin, published_at FROM lesson_materials`).all()) {
    const key = `${r.lesson_slug}\u0000${r.kind}`;
    if (!units.has(key)) units.set(key, []);
    units.get(key).push(r);
  }
  let total = 0, strict = 0, lenient = 0;
  for (const versions of units.values()) {
    if (!versions.some((v) => inWindow(v.published_at, from, to))) continue;
    total += 1;
    if (!versions.some((v) => v.origin === 'edited')) strict += 1;
    const first = versions.reduce((a, b) => (a.version <= b.version ? a : b));
    if (first.origin === 'generated') lenient += 1;
  }

  const month = previousMonth(now);
  let paidAgorot = 0, owedAgorot = 0;
  for (const p of db.prepare(`SELECT date, amount_agorot, status FROM payments`).all()) {
    if (!String(p.date).startsWith(month)) continue;
    if (p.status === 'paid') paidAgorot += p.amount_agorot;
    else if (p.status === 'owed') owedAgorot += p.amount_agorot;
  }

  let streak = 0;
  const runs = db.prepare(
    `SELECT status FROM lessons WHERE status IN ('ready','held','failed') ORDER BY at DESC, id DESC`).all();
  for (const r of runs) { if (r.status !== 'ready') break; streak += 1; }

  return {
    activeStudents,
    autogen: { units: total, strict: total ? strict / total : null, lenient: total ? lenient / total : null },
    revenue: { month, paidAgorot, owedAgorot },
    gate: { streak, target: GATE_TARGET },
    notes: ["homework has no origin column; its share is not measured separately — a `ready` lesson's homework was generated with it."],
  };
}

const pct = (x) => (x === null ? 'n/a (nothing published in 30 days)' : `${Math.round(x * 100)}%`);
const ils = (agorot) => `₪${(agorot / 100).toLocaleString('he-IL')}`;

function main() {
  const path = process.env.DB_PATH || join(process.env.DATA_DIR ?? './data', 'results.db');
  const m = measure(new DatabaseSync(path, { readOnly: true }), new Date());
  if (process.argv.includes('--json')) { console.log(JSON.stringify(m, null, 2)); return; }
  console.log(`active students (30d)     ${m.activeStudents} / 10`);
  console.log(`autogenerated, strict     ${pct(m.autogen.strict)} / 80%   (${m.autogen.units} published units)`);
  console.log(`autogenerated, lenient    ${pct(m.autogen.lenient)}`);
  console.log(`revenue ${m.revenue.month}         paid ${ils(m.revenue.paidAgorot)} · owed ${ils(m.revenue.owedAgorot)} / ₪10,000`);
  console.log(`gate: clean runs in a row ${m.gate.streak} / ${m.gate.target}`);
  for (const n of m.notes) console.log(`note: ${n}`);
}

/* argv[1] is '-' when the script is piped to `node -` over SSH. */
const arg = process.argv[1];
if (!arg || arg === '-' || import.meta.url === pathToFileURL(arg).href) main();
```

- [ ] **Step 4: Run the test and check that it passes.**

Run: `node --test tests/unit/vision-metrics.test.mjs`
Expected: all 6 tests pass. When the test imports the file, `process.argv[1]` is the test runner's path, so `main()` doesn't run.

- [ ] **Step 5: Try the piped mode locally.**

Run: `DB_PATH=/nonexistent-dir/x.db node --input-type=module - < scripts/vision-metrics.mjs; echo exit=$?`
Expected: a non-zero exit with an "unable to open database" error, which proves `main()` runs when the script is piped in. Then run `npm test` and expect the same result as `main` plus the 6 new passing tests.

- [ ] **Step 6: Add the how-to-run paragraph to `server/README.md`**, next to the backup/restore section:

```markdown
### Vision metrics

`scripts/vision-metrics.mjs` prints the PRODUCT.md targets (active students,
autogenerated share, last month's revenue, the 10-run gate). It is read-only
and not shipped in the image; pipe it in:

    ssh mea 'docker exec -i $(docker ps -qf name=app) node --input-type=module -' < scripts/vision-metrics.mjs
```

Before committing, check the container filter with `ssh mea 'docker ps --format "{{.Names}}"'` and put the real name pattern in the paragraph.

- [ ] **Step 7: Commit, push, and open PR 2.**

```bash
git add scripts/vision-metrics.mjs tests/unit/vision-metrics.test.mjs server/README.md
git commit -m "Measure the vision's targets from tables that already exist" -m "<trailer>"
git push -u origin feat/vision-metrics
gh pr create --title "Measure the vision's targets" --body "<summary + footer>"
```

After the merge, check the post-merge run.

---

### Task 4: Todoist writes

Use the `todoist-cli` skill (`td`). Every write here was approved on 2026-09-24. Do nothing beyond this list.

- [ ] **Step 1: Create the labels** `pillar-autopilot`, `pillar-progress`, `pillar-wom`, `pillar-90min`, `pillar-tutor3`.
- [ ] **Step 2: Apply labels** (add to existing labels, don't replace them):
  - `pillar-autopilot`: `6hRhM62pGwM7RMCq`, `6hRhMChmFm4C63Mq`, `6hRhqRXHcGj9m98H`, `6hRhqRvfX7VHgh9q`, `6hRhqV8XX5wr4jqq`, `6hRQQVWxcCgrjRCq`, `6hRw46wfC9FHXCjq`, `6hRhqRH7xq5f7vFH`
  - `pillar-progress`: `6hRhqR5c68wXWXFH`, `6hR9MrFrhHfh4fQH`, `6hR9MvprJ3vj7pVH`, `6hR9Mx2Rpv3j9PqH`
  - `pillar-wom`: `6hW8xwxJ899GP7fq`, `6hRhJv5m433H45QH`, `6hRhMJpgXq8FFG4q`, `6hRhMQwp3gXfF75q`, `6hRhMc3HcpCCC3WH`
  - `Infra`: `6hR336v853Jm493H`, `6hM24r5hGPvwJQmq`
- [ ] **Step 3: Create 4 tasks** in project MeaBeclick:
  - p1, `pillar-autopilot`: "Gate: 10 clean Codex production runs in a row (measured by scripts/vision-metrics.mjs)"
  - p2, `pillar-90min`: "Make כפול the recommended plan in booking"
  - p3, `pillar-tutor3`: "Remove the hardcoded tutor (enroll.ts `tutor: 'ניקול'`, landing page) so a third tutor is data"
  - p3, `Infra`: "Take portal/noga.json (real PII) out of the repo and its history"
- [ ] **Step 4: Close 2 tasks.** First confirm `6hMjCvfjpp2Vm5hq` is done: `git ls-files mea-beclick-kb/students mea-beclick-kb/pricing` returns nothing, and `.gitignore` lists both. Then complete it with a comment citing #68 and the 2026-09-18 spec. Complete `6hMCxvMc3CfrFPRH` (PWA) with the comment "non-goal through June 2027 (PRODUCT.md)." If the PII check fails, don't close that task; report it.
- [ ] **Step 5: Verify.** Run `td` list filtered by each `pillar-*` label and check the counts are 9 / 4 / 5 / 1 / 1.

---

### Task 5: Production baseline

- [ ] **Step 1:** `ssh mea 'docker ps --format "{{.Names}} {{.Image}}"'` to find the app container.
- [ ] **Step 2:** `ssh mea 'docker exec -i <name> node --input-type=module - --json' < scripts/vision-metrics.mjs > /tmp/claude-1000/-home-liornisimov-Projects-mea-beclick/7ab4210a-f30b-4690-9a0f-ff0df0d6d8ae/scratchpad/baseline.json`. Use the version on `main` after PR 2 merges. It's read-only; don't run anything else on the box.
- [ ] **Step 3:** Show Lior the numbers. They're aggregates only: no names and no per-student rows.

---

### Task 6: Publish the vision board

- [ ] **Step 1:** Load the `artifact-design` skill (the Artifact tool requires it) and read the site's tokens for its colors and fonts: `grep -rn -- "--" src/app.css src/lib/components/*.svelte | head -60`, adjusting the paths to wherever the tokens are defined.
- [ ] **Step 2:** Collect the inputs: `PRODUCT.md` at `origin/main` (note the short SHA), the Todoist tasks per `pillar-*` / `Infra` label with their priorities, and `baseline.json`.
- [ ] **Step 3:** Write the page at `/tmp/claude-1000/-home-liornisimov-Projects-mea-beclick/7ab4210a-f30b-4690-9a0f-ff0df0d6d8ae/scratchpad/vision-board.html`: `<html lang="he" dir="rtl">`, title "חזון מאה בקליק". Sections in spec §6 order: header and phase timeline, two north stars, four target cards (target / how measured / baseline, or "נמדד בבדיקה הראשונה" if a value is null), the gate bar (streak/10), five pillar cards with Now / Next / Later from priority (p1 / p2 / p3–p4) and the reliability band beneath, "לא עושים", and the footer "נוצר מ-PRODUCT.md @ <sha> ומ-Todoist ב-<date> — משנים את ה-PRD, לא את הדף". No task text from Todoist that names a student.
- [ ] **Step 4:** Publish with the Artifact tool (`icon: "compass"`, a one-sentence description), and give Lior the link.
- [ ] **Step 5:** Give Lior the one-line correction for `~/Projects/nix/ventures/MeaBeclick.md` ("SvelteKit app, not a static Bootstrap site; pricing ₪120/₪215/₪300 per `src/lib/plans.ts`; vision in the repo's PRODUCT.md"). Don't edit that repo.
