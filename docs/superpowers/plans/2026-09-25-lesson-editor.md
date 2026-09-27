# Lesson editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** A tutor can edit a generated lesson's plan, preview it, save drafts, publish, and restore, without touching HTML.
**Spec:** `docs/superpowers/specs/2026-09-25-lesson-editor-design.md`

## Global Constraints
- The student sees only published `slides` (unchanged route).
- `publish-plan` writes plan + rendered slides together. No other path renders slides from an edit.
- Tutor-only on every verb (`apiAuthDenied`).

## Review Focus
1. Plan JSON with extra or unexpected fields (the client edits a generated plan that has `games`/`homework`): those must be kept, not dropped. The editor changes only title/slides/examples.
2. A bullet or heading containing `<script>`: rendered escaped (`renderSlides` uses `esc`), and the iframe is sandboxed.
3. Two tabs publishing: versions stay monotonic, and the last publish wins.
4. A lesson slug that doesn't exist: 404 on the page and the API.
5. Empty lines in the bullet textarea are dropped, not rendered as empty bullets.

### Task 1: `lesson/editing.ts`: validate, merge and render an edited plan
Produces `normalizeEdit(input: unknown): { ok: true; edit: PlanEdit } | { ok: false; error: string }`, `applyEdit(base: LessonPlan, edit: PlanEdit): LessonPlan` (keeps games/homework/gradeContext from base), and `lessonMeta(slug)` → `{ subject, level, student } | null` from `readLessons()`.
Tests: every D4 refusal, trimming, empty-line drop, games kept (Review Focus 1).

### Task 2: API verbs `preview` and `publish-plan` in `/api/lessons/[slug]/materials`
`save` with `kind: 'plan'` keeps working for drafts, through `normalizeEdit` when the body carries `edit` instead of raw `content`.
Tests (characterization, harness): publish-plan → `/lessons/[slug]` serves the edited heading. A draft leaves it unchanged. Preview writes no version. 401 with no session.

### Task 3: `/app/lessons/[slug]/edit` page + dashboard link
Form per D1/D6/D7/D8, preview iframe `sandbox=""`, buttons «שמירת טיוטה» / «תצוגה מקדימה» / «פרסום», history with restore-into-form. Source-level test plus a browser walk.

### Task 4: Proof and review
Full suite, check, build. Fresh reviewer on the branch. PR, CI gate, merge, deploy watch.
