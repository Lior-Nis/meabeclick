# Homework from what was taught — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold booking-time homework until the lesson has happened, and replace it with homework generated from the skills the tutor's report says were taught.

**Architecture:** Two new `homework` columns (`booking_id`, `held_until`) make "held" a read-time filter, so no job has to run for the 24h fallback. A small Codex run (`lesson/homework.ts`) turns covered skills and the report note into tasks. `reports/after.ts` decides replace, release or nothing, and runs un-awaited after `fileReport`.

**Tech Stack:** SvelteKit 2, node:sqlite, `node --test`, Codex via `spawnAgent`.

**Spec:** `docs/superpowers/specs/2026-09-25-homework-from-what-was-taught-design.md`

## Global Constraints

- Fallback release: **24 hours after the lesson ends** (`HOLD_MS = 24 * 60 * 60 * 1000`).
- Generated tasks: at most **5**. A `skillKey` outside the covered set is dropped, never guessed.
- Families never see held rows. The tutor sees them with `heldUntil`.
- Homework generation does not touch the `lessons` table (it is not a gate run).
- Tutor note is fenced with `newFence()` and sanitized with `sanitizeField(note, 2000)`. Skill titles go in the trusted trailer.
- Hebrew user-facing copy. WhatsApp via the existing `notify` injection.

## Review Focus

1. A booking with no `end` (older callers): `held_until` must be NULL (visible), never "held forever". → Task 2 test.
2. A report filed twice: the second filing must not generate a second set. → Task 4 test ("already replaced").
3. A report filed after the 24h fallback: nothing generated (D4). → Task 4 test.
4. Agent returns tasks for a skill that was not covered: dropped. → Task 3 test.
5. Replace runs in one transaction. A throw mid-insert must leave the held rows. → Task 1 test.

---

### Task 1: Held homework in the store

**Files:**
- Create: `src/lib/server/migrations/018_homework_held.ts`
- Modify: `src/lib/server/migrations/list.ts`, `src/lib/server/lessons.ts`
- Test: `tests/unit/homework-held.test.mjs`

**Interfaces — Produces:**
- `addHomework({..., bookingId?: number|null, heldUntil?: string|null}): number`
- `homeworkForStudent(studentId, opts?: { includeHeld?: boolean; now?: string })`: rows gain `booking_id`, `held_until`
- `heldHomeworkForBooking(bookingId: number, now?: string): HomeworkRow[]` (still held at `now`)
- `releaseHeld(bookingId: number): number` (rows released)
- `replaceHeld(bookingId: number, studentId: number, tasks: {task: string; nodeId: number|null}[]): void` (one transaction: delete held rows for the booking, insert tasks visible now with `booking_id`)

- [ ] Step 1: test: a held row is absent from the default read and present with `includeHeld`. At `now >= held_until` it is visible by default. `releaseHeld` makes it visible. `replaceHeld` deletes held rows and inserts new ones. `replaceHeld` with a task whose `nodeId` violates the FK throws and leaves the held rows.
- [ ] Step 2: run, and confirm it fails (unknown column / missing export).
- [ ] Step 3: migration `ALTER TABLE homework ADD COLUMN booking_id INTEGER; ALTER TABLE homework ADD COLUMN held_until TEXT;`, register `{ version: 18, name: '018_homework_held', sql: sql018 }`. In `lessons.ts`: extend the INSERT, add `AND (? OR h.held_until IS NULL OR h.held_until <= ?)` to `homeworkForStudent`, and add the three functions (`replaceHeld` wrapped in `inTransaction` from db.ts).
- [ ] Step 4: run the test, then the full suite, and confirm they pass.
- [ ] Step 5: commit.

### Task 2: Booking-time homework is written held

**Files:** Modify `src/lib/server/lesson/queue.ts`, `src/routes/api/book/+server.ts`. Test `tests/unit/lesson-reaches-student.test.mjs`.

**Interfaces — Consumes:** `addHomework({ bookingId, heldUntil })`. **Produces:** `TriggerOpts.bookingId?: number|null`, exported `heldUntilFor(end?: string): string|null` (end + HOLD_MS, null when end is missing or invalid).

- [ ] Step 1: test: a booking with `end` and `bookingId` produces rows with that `booking_id` and `held_until = end + 24h`, and the family read shows none. `heldUntilFor(undefined) === null`.
- [ ] Step 2: run, and confirm it fails.
- [ ] Step 3: thread `bookingId` through `TriggerOpts` → `run()` → `appendToPortal(code, plan, published, target, hold)` where `hold = { bookingId, heldUntil }`. In `/api/book`, pass `bookingId` into `triggerForBooking`'s opts.
- [ ] Step 4: run, and confirm it passes. Update the existing assertions that read homework through `homeworkForStudent` to use `{ includeHeld: true }` where the row is legitimately held.
- [ ] Step 5: commit.

### Task 3: Generate homework from covered skills

**Files:** Create `src/lib/server/lesson/homework.ts`. Test `tests/unit/homework-taught.test.mjs`.

**Interfaces — Produces:**
```ts
export interface TaughtSkill { key: string; title: string; nodeId: number }
export interface TaughtContext { subject: string; level: string; skills: TaughtSkill[]; note: string | null }
export function buildHomeworkPrompt(ctx: TaughtContext): string
export function parseTaughtHomework(raw: string, skills: TaughtSkill[]): { task: string; nodeId: number }[]
export async function generateTaughtHomework(ctx: TaughtContext): Promise<{ task: string; nodeId: number }[]>
```
`parseTaughtHomework`: strips fences (`stripFence` from ask.ts), `JSON.parse`, expects `{ homework: [{ task, why, skillKey }] }`, drops entries whose `skillKey` is not a covered key or whose task is empty, joins `task` + ` — ` + `why` when `why` is non-empty, and caps the result at 5. It throws `LessonGenerationError('bad-output')` when nothing usable is left.

`generateTaughtHomework`: `spawnAgent(engineBin(), ['exec','-C',dir,'--skip-git-repo-check','--ephemeral','--ignore-user-config','--dangerously-bypass-approvals-and-sandbox','-c','model_reasoning_effort="medium"','-o',outPath,'-'], prompt, dir, { label: 'codex', timeoutMs: 5*60*1000 })`, then reads `outPath`, and cleans up the temp dir in `finally`.

- [ ] Step 1: tests: prompt lists every skill title and key after the fence, and the note inside it. The prompt says 1–2 tasks per skill and at most 5. `parseTaughtHomework` drops a foreign key, caps at 5, and throws on an empty result. `generateTaughtHomework` with a stub agent (pattern from `tests/unit/lesson-engine.test.mjs` `stubAgent`) returns linked tasks.
- [ ] Step 2: run, and confirm it fails.
- [ ] Step 3: implement.
- [ ] Step 4: run, and confirm it passes.
- [ ] Step 5: commit.

### Task 4: What a filed report does to homework

**Files:** Create `src/lib/server/reports/after.ts`. Modify `src/routes/api/reports/+server.ts`. Test `tests/unit/report-homework.test.mjs`.

**Interfaces — Produces:**
```ts
export type AfterReportOutcome = 'none' | 'released' | 'replaced' | 'released-after-failure';
export async function afterReport(
  input: { bookingId: number; note: string | null; nodeIds: number[] },
  deps?: { generate?: typeof generateTaughtHomework; notify?: (t: string) => Promise<void> | void; now?: string },
): Promise<AfterReportOutcome>
```
Logic: `held = heldHomeworkForBooking(bookingId, now)`. If it's empty, return `'none'` (covers D4 and a re-filing after a replace). If there are no `nodeIds`, `releaseHeld` and return `'released'`. Otherwise build `TaughtContext` from the booking's enrollment (subject, level) and the nodes (`nodeInPlan`), then try `generate` → `replaceHeld` → `'replaced'`. On a catch: `releaseHeld`, `notify('⚠️ לא הצלחנו להכין שיעורי בית ממה שנלמד — נשלחו שיעורי הבית שהוכנו מראש')`, and return `'released-after-failure'`.

The route calls `afterReport({ bookingId, note, nodeIds: entries.map(e => e.nodeId) }, { notify: sendWhatsApp }).catch(err => console.error(...))` after a successful `fileReport`, **not awaited**.

- [ ] Step 1: tests for each of the four outcomes, using an injected `generate`. The second call after a replace returns `'none'`. A report after `held_until` returns `'none'` and leaves the rows alone.
- [ ] Step 2: run, and confirm it fails.
- [ ] Step 3: implement, and wire the route.
- [ ] Step 4: run, and confirm it passes. Then the full suite.
- [ ] Step 5: commit.

### Task 5: The tutor sees what is held

**Files:** Modify `src/routes/api/students/[code]/activity/+server.ts` and the dashboard homework list in `src/routes/app/dashboard/+page.svelte`. Test `tests/unit/homework-held-tutor.test.mjs` (source-level, plus a store-level read).

- [ ] Step 1: test: the activity route calls `homeworkForStudent(student.id, { includeHeld: true })` and maps `heldUntil`. The dashboard renders `ממתין לשיעור` for a held row.
- [ ] Step 2 to Step 5: implement, check in a browser on the built server, and commit.

### Task 6: Proof

- [ ] One real Codex run of `generateTaughtHomework` with two covered skills and a note. Record the output in the PR.
- [ ] Full suite, `check:ci`, build. Then PR, merge, and watch the deploy.
