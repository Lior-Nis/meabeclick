# Lesson Generation: Subscription-Backed Pivot + Notification Fix

Status: approved by Lior, pending implementation
Branch: `fix/lesson-generation-pipeline`
Source: Todoist (MeaBeclick, p1) — "לתקן: המצגת המלאה לא נוצרת/לא נשמרת כמו שצריך בהזמנה אוטומטית"

## Background

The auto-generated lesson pipeline (`server/lesson-queue.mjs` → `server/lesson-prep.mjs`)
fires when a booking is made: it calls Claude to produce a lesson plan (slides,
worked examples, homework, games), validates it structurally, and either
publishes it or holds it in `drafts/` for review.

Investigation found two independent problems, not one:

1. **Silent failure visibility.** `triggerForBooking(body)` is called with no
   `opts` (`server/app.mjs:106`), so `opts.notify` is always `undefined` —
   every outcome (ready / held / failed / skipped) only ever reaches
   `console.log` on the VPS. The tutor has no way to know a lesson needs her
   attention short of manually opening the dashboard. Worse, the "no API
   key" skip path returns before a DB row is even created, so a skipped
   generation leaves *no trace at all* — not even a dashboard entry.

2. **A deliberate pivot in billing model.** The owner wants lesson generation
   to run through the Claude Code CLI, authenticated via a Claude
   subscription (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`), instead
   of the Anthropic Messages API billed per-token via `ANTHROPIC_API_KEY`.
   This is a documented, supported auth path for the CLI's headless mode
   (`claude -p`) — not available on the `@anthropic-ai/claude-agent-sdk`
   package, which only documents API-key auth, so this rules out the SDK for
   this use case. Actual traffic on this business is tiny (order of a
   handful of lessons/month), which is why this pivot is viable despite no
   published rate-limit guidance for subscription-backed automation.
   Cost/rate-limit mitigation beyond that (e.g. routing through OpenRouter
   models via the harness) is explicitly out of scope for this change.

The Anthropic API call itself (`output_config.format: json_schema`, effort,
streaming + `finalMessage()`) was verified against current docs during
investigation and is not broken — it's being replaced by choice, not because
it doesn't work.

## Goals

- Lesson generation runs via headless Claude Code, authenticated by
  subscription, not API key.
- Every generation outcome (ready / held / failed / skipped) reliably
  reaches the tutor by WhatsApp, not just a server log.
- Minimize blast radius: touch only what has to change.

## Non-goals

- Fixing `validateLesson()`'s all-or-nothing behavior (one bad game holds an
  otherwise-good deck). Real gap, deliberately deferred — a separate change
  with its own design questions (partial-publish semantics, a new lesson
  status). The notify fix alone gets the tutor into the loop fast enough to
  hand-publish the good parts if she wants to.
- Managing subscription cost/rate-limit exposure (e.g. an OpenRouter
  fallback). Owner has a mitigation in mind and asked not to design around
  it now.
- Any change to `validateLesson()`, `publish()`, `publishDraftOnly()`,
  `appendToPortal()`, `renderSlides()`, or `scripts/prepare-lesson.mjs` —
  all consume `generateLesson()`'s output through an unchanged contract.

## Design

### 1. Scope: only `generateLesson()` changes

`generateLesson(meta)` in `server/lesson-prep.mjs` keeps its external
contract exactly as today: an async function that returns a `plan` object
matching `LESSON_SCHEMA`, and throws on failure. Every consumer of that
contract — `run()`, `publish()`, `publishDraftOnly()`, `appendToPortal()` in
`lesson-queue.mjs`, and the standalone `scripts/prepare-lesson.mjs` CLI tool
— needs zero changes.

### 2. Invocation mechanism

Inside the rewritten `generateLesson()`:

1. Create a fresh, empty scratch directory: `SITE_ROOT/.lesson-jobs/<slug>/`.
2. Spawn `claude -p` as a child process (`node:child_process`) with:
   - `cwd` set to that scratch directory.
   - `--permission-mode dontAsk --allowedTools Write` — fully unattended,
     and scoped to only writing files, nothing else (no Bash, no arbitrary
     Read/Edit).
3. Write the full prompt to the subprocess's **stdin**, then close it. The
   prompt content is today's `buildSystem()` instructions plus the task
   "ask" (topic/level/student/notUnderstood) plus a plain-language
   description of the one file it must produce: `plan.json`, matching the
   existing `LESSON_SCHEMA` shape (described in prose in the prompt, since
   the CLI path has no equivalent to `output_config.format`). Stdin avoids
   any argv length/escaping concerns from embedding the schema description.
4. Instruct it to write exactly one file, `plan.json`, into that directory,
   then finish.

### 3. Output contract, timeout, failure detection

- **Timeout**: 5 minutes (`setTimeout` + `child.kill()`), matching the
  existing "generation takes minutes" expectation. On timeout: throw.
- **Non-zero exit code**: throw, using captured stderr as the message.
- **Exit 0, but `plan.json` missing or fails `JSON.parse()`**: throw a
  distinct "model didn't produce the expected file" error — a new failure
  mode this path can hit that the old API-based path couldn't, since
  structured outputs guaranteed valid JSON and headless Claude Code does
  not.
- **Exit 0, valid JSON**: return the parsed object.
- The scratch directory is removed in a `finally`, regardless of outcome.

All of these funnel into `run()`'s existing `.catch()` in
`lesson-queue.mjs`, which already calls `finishLesson(slug, {status:
'failed', ...})` — no new status-handling code needed there.

### 4. Auth gate and daily cap

At the top of `triggerForBooking()`, the existing
`if (!process.env.ANTHROPIC_API_KEY)` check becomes a check for
`process.env.CLAUDE_CODE_OAUTH_TOKEN` instead — same skip-and-warn shape.
`MAX_PER_DAY = 20` is unchanged.

**Manual step, not part of this change**: the owner will run
`claude setup-token` interactively on the VPS once and set the resulting
value as `CLAUDE_CODE_OAUTH_TOKEN` in the VPS `.env`. `server/README.md`
gets updated to document this replacing the `ANTHROPIC_API_KEY` line.
`scripts/prepare-lesson.mjs`'s doc comment and error hint (which currently
say "Needs ANTHROPIC_API_KEY" / "הגדירו ANTHROPIC_API_KEY") get the same
mechanical update, since it calls the same `generateLesson()`.

### 5. Notification fix

`notify(opts, text)` in `lesson-queue.mjs` gets a real implementation
reusing the exact WhatsApp pattern already proven in `api/remind.js`
(CallMeBot, same tutor phone number, same `CALLMEBOT_API_KEY` env var) —
no new channel, no new integration.

`server/app.mjs`'s call site (`triggerForBooking(body)`, line 106) is
updated to pass `{ notify }` so the existing `notify(opts, text)` calls
inside `run()` actually reach WhatsApp instead of falling through to
`console.log`.

**All three outcomes notify** — ready, held, and failed — because the
tutor wants advance notice even on success, to review material before
teaching it. This requires no conditional logic: every existing call site
in `run()` already calls `notify()`; only the implementation needs to
stop being a no-op.

**The skipped case** (`CLAUDE_CODE_OAUTH_TOKEN` missing, or daily cap
reached) changes from "return before any DB row exists" to: call
`createLesson()` first (as the non-skipped path does), then immediately
`finishLesson(slug, { status: 'failed', problem: '<reason>' })` and
`notify()` — so a skipped generation is never invisible again.

## Testing

No existing test suite in this repo (no `test/` dir, no test script in
`package.json`). Verification for this change:
- Manual run via `scripts/prepare-lesson.mjs --dry` (fixture path,
  unaffected by this change) to confirm nothing downstream broke.
- Manual run via `scripts/prepare-lesson.mjs` (real path, once
  `CLAUDE_CODE_OAUTH_TOKEN` is set) to confirm a real `plan.json` gets
  produced, validated, and rendered correctly.
- Manual trigger of a real booking on a non-production checkout (or the VPS
  once deployed) to confirm a WhatsApp message actually arrives for a
  `ready` outcome, and that killing/misconfiguring the token produces a
  `failed` row + WhatsApp message instead of silence.
