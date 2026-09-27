# Lesson Generation Subscription Pivot + Notify Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap `generateLesson()` from an Anthropic API call to a headless, subscription-authenticated Claude Code invocation, and make every lesson-generation outcome (ready/held/failed) actually reach the tutor over WhatsApp instead of only logging to the VPS console.

**Architecture:** `generateLesson()` in `server/lesson-prep.mjs` spawns `claude -p` as a child process with a scratch working directory, feeds it the existing Hebrew system prompt plus the lesson schema (as prose, since there's no `output_config.format` in headless mode) over stdin, and reads back the `plan.json` file it's instructed to write. Its external contract (`async generateLesson(meta) → plan`, throws on failure) is unchanged, so `validateLesson()`, `publish()`, `publishDraftOnly()`, `appendToPortal()`, and `scripts/prepare-lesson.mjs` need zero code changes. Separately, `server/lesson-queue.mjs` gets a `sendWhatsApp()` export (same CallMeBot pattern as `api/remind.js`), wired in from `server/app.mjs` as `opts.notify`, and the two silent-failure paths (the pre-generation skip, and the `run()` rejection) are updated to actually call it.

**Tech Stack:** Node.js (ESM, `.mjs`), Express, `node:child_process`, `node:fs/promises`, the `claude` CLI (headless mode), CallMeBot HTTP API (`fetch`).

**Spec:** `docs/superpowers/specs/2026-08-23-lesson-generation-subscription-pivot-design.md`

## Global Constraints

- Keep `generateLesson(meta)`'s signature and return contract (a `plan` object matching `LESSON_SCHEMA`, or throw) byte-for-byte compatible with today — this is what lets every downstream consumer stay untouched.
- No new test framework. This repo has no `test/` dir and no `test` script in `package.json` — verification is manual, using real commands, per task.
- No changes to `validateLesson()`, `publish()`, `publishDraftOnly()`, `appendToPortal()`, `renderSlides()`, `TEMPLATE_FILES`, `toTemplateShape()`, or `scripts/prepare-lesson.mjs`'s CLI argument handling — only its env-var doc/check gets touched (Task 2).
- Auth env var is `CLAUDE_CODE_OAUTH_TOKEN` everywhere it replaces `ANTHROPIC_API_KEY`. Don't invent a different name.
- `MAX_PER_DAY = 20` in `lesson-queue.mjs` stays as-is.
- Don't touch `validateLesson()`'s all-or-nothing behavior or add any OpenRouter/fallback billing logic — both are explicit non-goals in the spec.

---

## Task 1: Rewrite `generateLesson()` to use headless Claude Code

**Files:**
- Modify: `server/lesson-prep.mjs:1-17` (imports + top doc comment), `server/lesson-prep.mjs:282-317` (the `generateLesson` function body — everything from `export async function generateLesson` through its closing brace)

**Interfaces:**
- Consumes: `LESSON_SCHEMA` (already defined in this file, unchanged), `buildSystem({subject, level})` (already defined in this file, unchanged, returns the Hebrew instruction string)
- Produces: `generateLesson({subject, topic, level, notUnderstood, student}) → Promise<plan>` where `plan` matches `LESSON_SCHEMA` — same name, same params, same return shape, same throw-on-failure behavior as before. `server/lesson-queue.mjs` and `scripts/prepare-lesson.mjs` both import this by name and must keep working unmodified.

- [ ] **Step 1: Smoke-test the subprocess plumbing manually, before touching any code**

Run this from the repo root (this machine already has working Claude Code credentials — no `CLAUDE_CODE_OAUTH_TOKEN` setup needed for this smoke test):

```bash
mkdir -p /tmp/claude-smoke-test && cd /tmp/claude-smoke-test
echo 'Write a file named smoke.json in the current directory containing exactly {"ok":true} — no other files, no other output.' | claude -p --permission-mode dontAsk --allowedTools Write
cat smoke.json
echo "exit code: $?"
cd - 
```

Expected: `smoke.json` exists and contains `{"ok":true}` (or close to it), the command exits without hanging. If `--permission-mode dontAsk` or `--allowedTools Write` are rejected as unknown flags, run `claude -p --help` and note the actual current flag names/spelling before Step 3 — don't guess past a real error.

- [ ] **Step 2: Confirm current behavior still uses the Anthropic API (baseline)**

```bash
grep -n "Anthropic\|client.messages.stream" server/lesson-prep.mjs
```

Expected: shows the `import Anthropic from '@anthropic-ai/sdk'` line and the `client.messages.stream(...)` call inside `generateLesson`. This is what Step 3 replaces.

- [ ] **Step 3: Replace the imports and top doc comment**

Replace lines 1-17 of `server/lesson-prep.mjs`:

```js
/**
 * Lesson preparation — generates a whole lesson from a topic.
 *
 * Produces a slide deck, worked examples, homework, and playable games in one
 * pass, then writes them where the site already looks for them.
 *
 * NotebookLM is deliberately not involved: it needs a browser session and
 * minutes of polling, so it can never run unattended. Claude generates the
 * material directly from the topic.
 *
 * Nothing is published automatically — output lands in a draft folder for the
 * tutor to review. It goes out under her name.
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
```

with:

```js
/**
 * Lesson preparation — generates a whole lesson from a topic.
 *
 * Produces a slide deck, worked examples, homework, and playable games in one
 * pass, then writes them where the site already looks for them.
 *
 * NotebookLM is deliberately not involved: it needs a browser session and
 * minutes of polling, so it can never run unattended. Claude generates the
 * material directly from the topic.
 *
 * Generation runs through headless Claude Code (`claude -p`), authenticated
 * by a Claude subscription via CLAUDE_CODE_OAUTH_TOKEN (`claude setup-token`)
 * rather than a metered Anthropic API key — deliberate, to use the existing
 * subscription instead of separate API billing.
 *
 * Nothing is published automatically — output lands in a draft folder for the
 * tutor to review. It goes out under her name.
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;
```

- [ ] **Step 4: Replace the `generateLesson` function body**

Find and replace the entire function (currently lines 282-317, from the doc comment starting `/** Generates the lesson...` through the closing `}` of `generateLesson`):

```js
/**
 * Generates the lesson. Streams because a full lesson runs long and a
 * non-streaming request at this size risks an HTTP timeout.
 */
export async function generateLesson({ subject, topic, level, notUnderstood, student }) {
  const client = new Anthropic();

  const ask = [
    `נושא השיעור: ${topic}`,
    student ? `תלמיד/ה: ${student}` : '',
    notUnderstood ? `מה לא הובן בשיעור הקודם: ${notUnderstood}` : '',
    '',
    notUnderstood
      ? 'התמקד/י במיוחד במה שלא הובן — זה הלב של השיעור.'
      : 'בנה/י שיעור שלם על הנושא.',
  ].filter(Boolean).join('\n');

  const stream = client.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 32000,
    output_config: {
      effort: 'high',                                   // teaching material — correctness over speed
      format: { type: 'json_schema', schema: LESSON_SCHEMA },
    },
    system: buildSystem({ subject, level }),
    messages: [{ role: 'user', content: ask }],
  });

  const msg = await stream.finalMessage();

  if (msg.stop_reason === 'refusal') throw new Error('refused');
  if (msg.stop_reason === 'max_tokens') throw new Error('truncated — raise max_tokens');

  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return JSON.parse(text);
}
```

with:

```js
/**
 * Generates the lesson via headless Claude Code rather than a direct
 * Anthropic API call — draws on the Claude subscription (CLAUDE_CODE_OAUTH_TOKEN)
 * instead of metered API billing. Claude Code is told to write exactly one
 * file, plan.json, into a scratch working directory that this function owns
 * and always cleans up.
 */
export async function generateLesson({ subject, topic, level, notUnderstood, student }) {
  const jobId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const jobDir = join(SITE_ROOT, '.lesson-jobs', jobId);
  await mkdir(jobDir, { recursive: true });

  try {
    const prompt = buildPrompt({ subject, topic, level, notUnderstood, student });
    await runClaudeCode(prompt, jobDir);

    let raw;
    try {
      raw = await readFile(join(jobDir, 'plan.json'), 'utf8');
    } catch {
      throw new Error('claude code did not write plan.json');
    }

    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('plan.json was not valid JSON');
    }
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Builds the full prompt: the existing Hebrew teaching instructions, the
 *  specific ask, and — since headless mode has no output_config.format
 *  equivalent — the required plan.json shape given as prose instructions. */
function buildPrompt({ subject, topic, level, notUnderstood, student }) {
  const ask = [
    `נושא השיעור: ${topic}`,
    student ? `תלמיד/ה: ${student}` : '',
    notUnderstood ? `מה לא הובן בשיעור הקודם: ${notUnderstood}` : '',
    '',
    notUnderstood
      ? 'התמקד/י במיוחד במה שלא הובן — זה הלב של השיעור.'
      : 'בנה/י שיעור שלם על הנושא.',
  ].filter(Boolean).join('\n');

  return [
    buildSystem({ subject, level }),
    '',
    ask,
    '',
    'כתוב/כתבי את התוצאה כקובץ JSON יחיד בשם plan.json בתיקיית העבודה הנוכחית.',
    'מבנה ה-JSON חייב להתאים בדיוק לסכימה הבאה (כל שדה שמופיע תחת required הוא חובה):',
    JSON.stringify(LESSON_SCHEMA, null, 2),
    '',
    'אל תכתוב שום קובץ אחר חוץ מ-plan.json. אל תדפיסי את ה-JSON כטקסט בפלט — רק כתבי אותו לקובץ.',
  ].join('\n');
}

/** Spawns headless Claude Code with the prompt on stdin. Resolves on exit
 *  code 0, rejects otherwise (non-zero exit, spawn failure, or timeout). */
function runClaudeCode(prompt, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['-p', '--permission-mode', 'dontAsk', '--allowedTools', 'Write'],
      { cwd, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });

    const timer = setTimeout(() => child.kill('SIGTERM'), CLAUDE_TIMEOUT_MS);

    child.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`failed to start claude: ${err.message}`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 500)}`));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
```

- [ ] **Step 5: Verify the file has no leftover references to the old approach**

```bash
grep -n "Anthropic\|output_config\|stop_reason\|finalMessage" server/lesson-prep.mjs
```

Expected: no matches.

- [ ] **Step 6: Verify the file is syntactically valid**

```bash
node --check server/lesson-prep.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 7: Manual end-to-end check with a real lesson prompt**

This requires `CLAUDE_CODE_OAUTH_TOKEN` in the environment (or being logged into Claude Code locally, as this dev machine already is). Run:

```bash
node -e "
import('./server/lesson-prep.mjs').then(async ({ generateLesson, validateLesson }) => {
  const plan = await generateLesson({ subject: 'מתמטיקה', topic: 'שברים', level: 'כיתה ו', student: 'בדיקה' });
  console.log('title:', plan.title);
  console.log('slides:', plan.slides?.length, 'examples:', plan.examples?.length);
  console.log('problems:', validateLesson(plan));
});
"
```

Expected: prints a real Hebrew lesson title, non-zero slide/example counts, and an empty or short `problems` array. If `CLAUDE_CODE_OAUTH_TOKEN` isn't set anywhere in this environment, run the Step 1 smoke test again to confirm the plumbing works and note in the task's completion report that full behavioral verification is deferred until the token is configured (Lior is doing this on the VPS himself).

- [ ] **Step 8: Commit**

```bash
git add server/lesson-prep.mjs
git commit -m "Swap lesson generation from the Anthropic API to headless Claude Code

Uses CLAUDE_CODE_OAUTH_TOKEN (a Claude subscription) instead of a
metered ANTHROPIC_API_KEY. generateLesson()'s contract — async, returns
a plan matching LESSON_SCHEMA, throws on failure — is unchanged, so
validateLesson/publish/appendToPortal and scripts/prepare-lesson.mjs
need no changes."
```

---

## Task 2: Update `scripts/prepare-lesson.mjs`'s env-var reference and check

**Files:**
- Modify: `scripts/prepare-lesson.mjs:9` (doc comment), `scripts/prepare-lesson.mjs:40-45` (the error-handling block around the `generateLesson` call)

**Interfaces:**
- Consumes: `generateLesson` from Task 1 (same import, same call shape — no change needed to the import line itself)
- Produces: nothing new consumed elsewhere; this is a leaf doc/UX fix

- [ ] **Step 1: Confirm current stale reference**

```bash
grep -n "ANTHROPIC_API_KEY\|api key|authentication" scripts/prepare-lesson.mjs
```

Expected:
```
9: * Needs ANTHROPIC_API_KEY. Writes to drafts/<slug>/ for review — nothing is
43:  if (/api key|authentication/i.test(err.message)) {
44:    console.error('  הגדירו ANTHROPIC_API_KEY לפני ההרצה.');
```

- [ ] **Step 2: Update the doc comment**

In `scripts/prepare-lesson.mjs`, replace:

```js
 * Needs ANTHROPIC_API_KEY. Writes to drafts/<slug>/ for review — nothing is
```

with:

```js
 * Needs CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token` once to get one) —
 * generation runs through headless Claude Code, not the Anthropic API.
 * Writes to drafts/<slug>/ for review — nothing is
```

- [ ] **Step 3: Replace the stale error-message pattern-match with an upfront check**

The old code guessed at failure cause by pattern-matching the error message text (`/api key|authentication/i`), which won't match the new failure modes (`"failed to start claude"`, `"claude exited ..."`, `"claude code did not write plan.json"`). Replace the reliance on message-sniffing with an explicit upfront check instead.

Find this block (currently around line 38-45):

```js
const plan = args.dry ? fixture(meta) : await generateLesson(meta).catch(err => {
  console.error(`\n✗ ${err.message}`);
  if (/api key|authentication/i.test(err.message)) {
    console.error('  הגדירו ANTHROPIC_API_KEY לפני ההרצה.');
  }
  process.exit(1);
});
```

Replace with:

```js
if (!args.dry && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  console.error('חסר CLAUDE_CODE_OAUTH_TOKEN — הריצו claude setup-token או השתמשו בדגל --dry\n');
  process.exit(1);
}

const plan = args.dry ? fixture(meta) : await generateLesson(meta).catch(err => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 4: Verify syntax**

```bash
node --check scripts/prepare-lesson.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 5: Manual check — dry run still works**

```bash
node scripts/prepare-lesson.mjs --dry --topic "שברים" --level "כיתה ו" --student נוגה
```

Expected: runs to completion using the fixture path (unaffected by this change), same as before this task.

- [ ] **Step 6: Manual check — missing token now fails fast with a clear message**

```bash
env -u CLAUDE_CODE_OAUTH_TOKEN node scripts/prepare-lesson.mjs --topic "שברים" --level "כיתה ו" --student נוגה
```

Expected: exits immediately with the Hebrew "missing CLAUDE_CODE_OAUTH_TOKEN" message, no attempt to spawn `claude`.

- [ ] **Step 7: Commit**

```bash
git add scripts/prepare-lesson.mjs
git commit -m "Point prepare-lesson.mjs at CLAUDE_CODE_OAUTH_TOKEN instead of ANTHROPIC_API_KEY

Also fail fast with an explicit env-var check instead of guessing the
failure cause from the error message text, since the new subprocess
based generateLesson() has different failure modes."
```

---

## Task 3: Update `server/README.md` deployment docs

**Files:**
- Modify: `server/README.md:36-42` (the `.env` block)

**Interfaces:**
- Consumes: nothing (pure documentation)
- Produces: nothing (pure documentation)

- [ ] **Step 1: Confirm current block**

```bash
sed -n '36,42p' server/README.md
```

Expected:
```
```
PORT=8080
DB_PATH=/home/claw/maabeclick-web/data/results.db
ADMIN_PASSWORD=<your dashboard password>
SESSION_SECRET=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<key>
```
```

- [ ] **Step 2: Replace the `.env` block and add the one-time setup note**

Replace:

```
PORT=8080
DB_PATH=/home/claw/maabeclick-web/data/results.db
ADMIN_PASSWORD=<your dashboard password>
SESSION_SECRET=<openssl rand -hex 32>
ANTHROPIC_API_KEY=<key>
```

with:

```
PORT=8080
DB_PATH=/home/claw/maabeclick-web/data/results.db
ADMIN_PASSWORD=<your dashboard password>
SESSION_SECRET=<openssl rand -hex 32>
CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`>
```

`CLAUDE_CODE_OAUTH_TOKEN` is a Claude subscription token, not a metered
API key — lesson generation runs through headless Claude Code
(`claude -p`) instead of the Anthropic API. Get one by running, once,
interactively, on the VPS itself (after `claude login`):

```bash
claude setup-token
```

- [ ] **Step 3: Commit**

```bash
git add server/README.md
git commit -m "Document CLAUDE_CODE_OAUTH_TOKEN setup in server/README.md

Replaces the ANTHROPIC_API_KEY env var doc — lesson generation now
runs through headless Claude Code authenticated by subscription."
```

---

## Task 4: Wire real notifications through `lesson-queue.mjs`

**Files:**
- Modify: `server/lesson-queue.mjs` (add `sendWhatsApp` export near the top-level exports; rewrite `triggerForBooking`'s two skip branches; add a `notify()` call to the `run(...).catch(...)` failure handler)
- Modify: `server/app.mjs:28` (import) and `server/app.mjs:106` (the `triggerForBooking` call site)

**Interfaces:**
- Consumes: existing `notify(opts, text)` helper already in `lesson-queue.mjs` (unchanged — it already does `if (typeof opts.notify === 'function') await opts.notify(text)`), existing `createLesson`/`finishLesson` from `server/db.mjs` (unchanged)
- Produces: `sendWhatsApp(text: string): Promise<void>` exported from `server/lesson-queue.mjs` — new, used by `server/app.mjs`. `triggerForBooking(booking, opts)`'s external shape is unchanged (still returns `{skipped: ...}` or `{slug, started: true}`).

- [ ] **Step 1: Confirm the current CallMeBot pattern to copy from `api/remind.js`**

```bash
sed -n '1,25p' api/remind.js
```

Expected: shows `CALLMEBOT_PHONE`/`CALLMEBOT_API_KEY` env vars, `DEFAULT_PHONE = '972546969891'`, and the `https://api.callmebot.com/whatsapp.php?phone=...&text=...&apikey=...` URL pattern via `fetch`.

- [ ] **Step 2: Add `sendWhatsApp()` to `lesson-queue.mjs`**

Add this near the bottom of `server/lesson-queue.mjs`, alongside the existing `notify()` helper (after the `notify` function, before the `today`/`slugify` helpers):

```js
const DEFAULT_PHONE = '972546969891';

/** Sends a WhatsApp message to the tutor via CallMeBot — same mechanism
 *  already used by api/remind.js. Reused here as the real notify()
 *  implementation instead of the silent console.log fallback. */
export async function sendWhatsApp(text) {
  const phone  = process.env.CALLMEBOT_PHONE || DEFAULT_PHONE;
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) {
    console.warn('lesson-queue: CALLMEBOT_API_KEY not set, cannot WhatsApp:', text.replace(/\n/g, ' | '));
    return;
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  const r = await fetch(url);
  const body = await r.text();
  if (!r.ok || body.includes('ERROR')) {
    console.error('lesson-queue: CallMeBot error:', body);
  }
}
```

- [ ] **Step 3: Verify syntax**

```bash
node --check server/lesson-queue.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 4: Wire `sendWhatsApp` into `server/app.mjs`'s call site**

In `server/app.mjs:28`, replace:

```js
import { triggerForBooking, setSiteRoot } from './lesson-queue.mjs';
```

with:

```js
import { triggerForBooking, setSiteRoot, sendWhatsApp } from './lesson-queue.mjs';
```

In `server/app.mjs:106`, replace:

```js
        try { triggerForBooking(body); } catch (e) { console.error('trigger', e); }
```

with:

```js
        try { triggerForBooking(body, { notify: sendWhatsApp }); } catch (e) { console.error('trigger', e); }
```

- [ ] **Step 5: Verify syntax**

```bash
node --check server/app.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 6: Manual check — confirm `sendWhatsApp` actually reaches CallMeBot**

Requires `CALLMEBOT_API_KEY` to be set (already required for the existing `/api/remind` cron to work, so likely already configured wherever this runs):

```bash
CALLMEBOT_API_KEY=<key> node -e "
import('./server/lesson-queue.mjs').then(({ sendWhatsApp }) =>
  sendWhatsApp('🧪 בדיקת אינטגרציה — אפשר להתעלם').then(() => console.log('sent'))
);
"
```

Expected: a WhatsApp message arrives on the tutor's phone, and `sent` prints. If `CALLMEBOT_API_KEY` isn't available in this environment, skip this manual check and note it as deferred (same reasoning as Task 1 Step 7).

- [ ] **Step 7: Commit this half**

```bash
git add server/lesson-queue.mjs server/app.mjs
git commit -m "Wire real WhatsApp notifications into the booking trigger

sendWhatsApp() reuses the existing CallMeBot pattern from
api/remind.js. server/app.mjs now passes it as opts.notify so the
already-existing notify() calls inside run() (ready/held) actually
reach the tutor instead of only logging to the VPS console."
```

- [ ] **Step 8: Confirm the two remaining silent-failure paths**

```bash
sed -n '27,56p' server/lesson-queue.mjs
```

Expected: shows the `triggerForBooking` function — the `if (!process.env.ANTHROPIC_API_KEY)` skip branch, the `MAX_PER_DAY` skip branch, and the `run(slug, booking, opts).catch(err => {...})` block that currently has no `notify()` call.

- [ ] **Step 9: Rewrite `triggerForBooking`'s skip branches and failure handler**

Replace the full `triggerForBooking` function body:

```js
export function triggerForBooking(booking, opts = {}) {
  const slug = `${slugify(booking.name)}-${slugify(booking.subject)}-${Date.now().toString(36)}`;

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('lesson-queue: no ANTHROPIC_API_KEY, skipping generation');
    return { skipped: 'no api key' };
  }

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  while (recent.length && recent[0] < dayAgo) recent.shift();
  if (recent.length >= MAX_PER_DAY) {
    console.warn('lesson-queue: daily cap reached, skipping');
    return { skipped: 'daily cap' };
  }
  recent.push(Date.now());

  createLesson({
    slug, student: booking.name, subject: booking.subject,
    level: booking.level, topic: booking.topic || booking.subject,
    lessonAt: booking.start,
  });

  // Intentionally not awaited.
  run(slug, booking, opts).catch(err => {
    console.error('lesson-queue failed', slug, err);
    finishLesson(slug, { status: 'failed', problem: String(err.message).slice(0, 300) });
  });

  return { slug, started: true };
}
```

with:

```js
export function triggerForBooking(booking, opts = {}) {
  const slug = `${slugify(booking.name)}-${slugify(booking.subject)}-${Date.now().toString(36)}`;

  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return skip(slug, booking, opts, 'no auth token', 'אין הרשאת Claude Code (CLAUDE_CODE_OAUTH_TOKEN חסר) — השיעור לא נוצר');
  }

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  while (recent.length && recent[0] < dayAgo) recent.shift();
  if (recent.length >= MAX_PER_DAY) {
    return skip(slug, booking, opts, 'daily cap', 'הגעת למכסה היומית ליצירת שיעורים — השיעור לא נוצר אוטומטית');
  }
  recent.push(Date.now());

  createLesson({
    slug, student: booking.name, subject: booking.subject,
    level: booking.level, topic: booking.topic || booking.subject,
    lessonAt: booking.start,
  });

  // Intentionally not awaited.
  run(slug, booking, opts).catch(err => {
    console.error('lesson-queue failed', slug, err);
    const problem = String(err.message).slice(0, 300);
    finishLesson(slug, { status: 'failed', problem });
    notify(opts, `⚠️ שגיאה ביצירת שיעור — ${problem}`).catch(() => {});
  });

  return { slug, started: true };
}

/** A booking that never got a lesson attempt — still gets a DB row and a
 *  WhatsApp ping, so it's never silently invisible on the dashboard. */
function skip(slug, booking, opts, reasonKey, message) {
  console.warn(`lesson-queue: ${reasonKey}, skipping`, slug);
  createLesson({
    slug, student: booking.name, subject: booking.subject,
    level: booking.level, topic: booking.topic || booking.subject,
    lessonAt: booking.start,
  });
  finishLesson(slug, { status: 'failed', problem: message });
  notify(opts, `⚠️ ${message}`).catch(() => {});
  return { skipped: reasonKey };
}
```

- [ ] **Step 10: Verify syntax**

```bash
node --check server/lesson-queue.mjs
```

Expected: no output, exit code 0.

- [ ] **Step 11: Manual check — skip path now creates a visible, notified row**

```bash
CALLMEBOT_API_KEY=<key> env -u CLAUDE_CODE_OAUTH_TOKEN node -e "
import('./server/lesson-queue.mjs').then(({ triggerForBooking, setSiteRoot, sendWhatsApp }) => {
  setSiteRoot(process.cwd());
  const result = triggerForBooking(
    { name: 'בדיקה', subject: 'מתמטיקה', level: 'כיתה ו', start: new Date().toISOString() },
    { notify: sendWhatsApp },
  );
  console.log(result);
});
"
```

Expected: `{ skipped: 'no auth token' }`, a WhatsApp message arrives, and the DB (check via `sqlite3` on the configured `DB_PATH`, or the `/api/lessons` endpoint once the server is running) shows a `failed` row for that slug with a Hebrew `problem` message. If `CALLMEBOT_API_KEY`/DB access aren't available in this environment, verify at minimum that `result` is `{ skipped: 'no auth token' }` and that no exception is thrown.

- [ ] **Step 12: Commit**

```bash
git add server/lesson-queue.mjs
git commit -m "Make the pre-generation skip path visible instead of silent

Missing CLAUDE_CODE_OAUTH_TOKEN or hitting the daily cap now creates a
'failed' lesson row (with a Hebrew reason) and sends a WhatsApp
notification, instead of returning before any DB row exists. Also adds
a notify() call to the run() rejection handler, so a mid-generation
failure (subprocess crash, timeout, bad plan.json) reaches the tutor
the same way ready/held already do."
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** Section 1 (scope) → Task 1 untouched-consumers claim, verified by not editing those files. Section 2 (invocation) → Task 1 Steps 3-4. Section 3 (output contract/timeout) → Task 1 Step 4 (`runClaudeCode`, `CLAUDE_TIMEOUT_MS`). Section 4 (auth gate/cap) → Task 4 Step 9 (`CLAUDE_CODE_OAUTH_TOKEN` check, `MAX_PER_DAY` untouched) + Task 3 (VPS doc). Section 5 (notify, all three outcomes, skip visibility) → Task 4 in full.
- **No placeholders:** every step above has literal before/after code or a literal runnable command — none deferred to "add appropriate handling."
- **Type/name consistency check:** `generateLesson`, `sendWhatsApp`, `notify`, `skip`, `triggerForBooking`, `createLesson`, `finishLesson` are spelled identically everywhere they're used across Tasks 1 and 4.
