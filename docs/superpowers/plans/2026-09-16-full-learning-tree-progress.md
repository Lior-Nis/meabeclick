# Full Learning Tree, Activities, and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the personal learning tree to cover the complete selected curriculum and provide server-backed activity links and progress for every branch.

**Architecture:** Keep the reviewed plan template as the complete curriculum source. Enrich the server page model with descendant progress and activity records derived from lessons, homework, and game results; render those records in the existing progressive tree. Activity assignment remains explicit and server-backed through a new plan activity table, while generated games carry stable plan-node identifiers when available.

**Tech Stack:** SvelteKit, Svelte 5 runes, TypeScript, SQLite migrations, Node test runner.

**Spec:** User-provided Todoist task: הרחבת עץ תכנית הלמידה לכל חומר הבחינה והוספת משחקים ומעקב התקדמות.

## Global Constraints

- Do not infer mastery from lesson presentation alone.
- Do not use display names as identity; use student, plan, node, lesson, and activity IDs.
- Keep the tree closed initially and open only the selected level.
- Preserve Hebrew RTL, keyboard access, mobile layout, and visible status text in addition to color.
- Do not expose teacher-only solutions or another student's activities.

---

### Task 1: Add stable activity assignments and progress projection

**Files:**
- Create: `src/lib/server/migrations/009_plan_activities.ts`
- Modify: `src/lib/server/plans/store.ts`
- Modify: `src/lib/server/plans/view.ts`
- Test: `tests/unit/plan-activities.test.mjs`

- [ ] Define `plan_activities` with plan/node identity, activity kind, title, URL/data ID, source lesson, and created timestamp; add unique `(plan_id,node_id,data_id)`.
- [ ] Add a store query returning activities scoped to one plan and student, plus an idempotent assignment function.
- [ ] Extend tree view types with counts `{total, completed, percent}` and activity summaries per node.
- [ ] Derive completed activity state from `results_v2` for the same student and `data_id`; never mark a skill mastered from this alone.
- [ ] Add unit coverage for empty progress, partial progress, duplicate assignment, and cross-student isolation.

### Task 2: Build a complete server page model

**Files:**
- Modify: `src/routes/app/plan/[code]/+page.server.ts`
- Modify: `src/routes/api/plans/[id]/events/+server.ts`
- Create: `src/routes/api/plans/[id]/activities/+server.ts`
- Test: `tests/unit/plan-page-model.test.mjs`

- [ ] Load every node from the selected plan/template, including future nodes, and attach descendant progress aggregates.
- [ ] Normalize generated lesson games and homework into activity records with stable data IDs and real `/app/play/...` links.
- [ ] Match existing activities to the narrowest node using explicit metadata first, then lesson topic/branch only as a read-only fallback; never create name-only assignments.
- [ ] Add authenticated POST for assigning an existing activity to a node and return fresh plan/tree/activity data.
- [ ] Add authenticated POST for creating a new activity request payload that carries student, subject, topic, branch, skill, level, progress, and exam context to the existing lesson-generation flow; reject missing node identity.
- [ ] Ensure event writes return the enriched tree so progress refreshes without a full page reload.

### Task 3: Replace the limited tree model with progressive full-tree UI

**Files:**
- Modify: `src/lib/components/LearningPlanTree.svelte`
- Modify: `src/routes/app/plan/[code]/+page.svelte`
- Test: `tests/unit/learning-tree.test.mjs`

- [ ] Render subject → all curriculum topics → branches → skills → activities, with only the subject visible initially.
- [ ] Keep sibling navigation visible while opening only the selected path.
- [ ] Show progress bars/percent and completed-vs-total counts on every node; show the next recommended action and needs-review count.
- [ ] Show activity drawer entries with kind, difficulty, completion state, score where available, and links to real games.
- [ ] Replace localStorage-only assignment with the authenticated activity endpoint; retain no fake links.
- [ ] Add “assign existing” and “create new” controls that preserve the selected node context.
- [ ] Add status legend and accessible labels for progress and state.

### Task 4: Validate curriculum coverage, activities, and progress end to end

**Files:**
- Modify: `tests/unit/plan-template-content.test.mjs`
- Create: `tests/unit/learning-tree-e2e.test.mjs`
- Modify: `docs/superpowers/plans/2026-09-16-full-learning-tree-progress.md`

- [ ] Assert the shipped 4-unit and 5-unit templates expose all seven exam topics and non-empty branches/skills.
- [ ] Test selecting a future topic, assigning/creating a game with node context, completing it, and observing updated progress.
- [ ] Test refresh/re-login persistence and activity isolation between two students.
- [ ] Run `npm test`, `npm run check`, and `npm run build`.
- [ ] Record any unsupported generation path as an explicit UI state instead of claiming completion.
