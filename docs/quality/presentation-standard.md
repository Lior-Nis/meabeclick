# Quality standard: automatically generated teaching decks

Todoist `id:6hRhM62pGwM7RMCq`. Evidence: the same 12 generations described
in `game-standard.md`, graded against `lesson-generation-rubric.md`.

**Scope: teaching decks only.** The task allows covering marketing decks
too; they are deliberately excluded. A lesson slide and a marketing slide
disagree on nearly every criterion — audience, density, whether a worked
example belongs on it at all — and one standard stretched across both would
be vague enough to pass anything. Marketing decks want their own task, with
a marketing example to test the standard against.

## 1. What a deck is here

`renderSlides()` in `src/lib/server/lesson/prep.ts` emits one self-contained
RTL HTML file: `lang="he" dir="rtl"`, the site palette as CSS variables,
Heebo from Google Fonts, arrow-key navigation, one `<section class="slide">`
per slide plus one per worked example, each numbered `i / total`.

Two consequences the standard depends on:

- **Layout is not generated.** The model produces headings, bullets and
  examples; the template produces the deck. A model cannot emit an
  overlapping, clipped or off-brand slide, because it never controls
  position, colour or type. Several checks the task asks for — overlap,
  clipping, contrast, brand consistency — are therefore properties of one
  tested template, not of each generation.
- **Export and editing do not exist.** A deck is HTML and is regenerated,
  not edited. That is out of scope here by decision, and belongs with the
  Drive task (`id:6hRQQVWxcCgrjRCq`, "sync edits back"), which is blocked on
  the folder-ownership call. Solving it once there beats half-solving it
  twice.

## 2. Required inputs

Already enforced by the CLI and the booking flow: **subject**, **level**,
and a free-text **request** naming the topic. `--topic` is refused if
missing. Audience is implied by level, and length is fixed by the structural
gate rather than requested.

## 3. Checks, and where each one lives

| Check | Enforced by |
|---|---|
| At least 4 slides, at least 1 worked example, at least 2 homework tasks | `validateLesson` |
| RTL, Hebrew typography, colour contrast, no overlap or clipping | `renderSlides` template, tested once |
| Slide numbering consistent with total | `renderSlides` |
| All text escaped — no markup injection from model output | `esc()` in `renderSlides` |
| Factual correctness, level fit, Hebrew fluency, one idea per slide | **Human review against the rubric.** Not mechanisable |

## 4. Measured, across 103 generated slides

- Bullets per slide: **min 3, max 5, mean 4.5**.
- Longest bullet: **86 characters**. Bullets over 120: **0**.
- Slides per deck: 8–10, stable across every run including repeats.

Text load is therefore not a current problem, and no bullet-count gate is
added. A limit set above the observed maximum would never fire; one set at
the maximum would fail good decks the first time a lesson needed a sixth
bullet. The measurement is recorded here so a future regression has a
baseline to be compared against — that is what this row of numbers is for.

## 4.1 Brand agreement, made enforceable — 24.9.2026

Todoist `id:6hRhqRXHcGj9m98H` worries that «כל יצירה חדשה עלולה להמציא שפה
חזותית אחרת» — that a new generation invents a different visual language
because the site's colours and the material guidance drift apart.

Measured: they had not drifted. All eight of the deck's colours already
equalled their site tokens, and both use Heebo. But the deck's palette was a
hand-copy inside `renderSlides` under different names (`--brand` for
`--accent`, `--cta` for `--accent2`, `--mint` for `--accent3`), and nothing
held them together.

A deck is a stand-alone HTML file and cannot import `tokens.css`, so the
values must be written into the document — the copy is unavoidable, the
*drift* is not. `src/lib/brand.ts` is now the one place the deck reads
from, and `tests/unit/brand-tokens.test.mjs` compares it against
`tokens.css` directly. Deliberately not a snapshot of the deck's CSS: a
snapshot passes by being updated. This fails whichever side you change
alone.

That is the third hand-copied shape fixed this week, after
`$lib/progress-facts.ts` and `$lib/skill-suggestion.ts`. A duplicate that
agrees at the moment it is written is still a duplicate.

## 4.2 The teaching sequence, as it already stands

The task asks for: explanation → worked example in steps → comprehension
question → supported practice → independent practice → summary.

Most of that is what the pipeline already produces, under other names:

| the sequence | where it lives |
|---|---|
| explanation | `plan.slides` — measured at 8–10 per deck, 3–5 bullets each |
| worked example in steps | `plan.examples` — `problem`, `steps[]`, `answer`, rendered as its own slide |
| comprehension question | the `quiz` / `two-truths` game data |
| **supported** practice | the games — a game is a supported context, options on screen. This is exactly the distinction `plans/suggest.ts` encodes when it refuses to call a game alone `independent` |
| **independent** practice | `plan.homework` — offline work, written with `dataId: null` on purpose |
| summary | the closing slide. Every one of the 12 graded runs produced one («מה למדנו?», «זוכרים לפני שמסיימים») without being asked |

So the sequence is not missing; it was never named. Naming it matters
because the supported/independent split is already load-bearing in the
evidence model, and a future change that makes homework game-backed would
quietly collapse two different kinds of evidence into one.

What is genuinely absent is any *enforcement* that a deck follows the
order — `validateLesson` counts slides, examples and homework but says
nothing about sequence. Left unenforced deliberately: the 12-run corpus
never violated it, and a gate against a failure that has not occurred, in a
place where the model is already reliable, is cost without benefit. The
counts above are the baseline a regression would be measured against.

## 5. Tool comparison

The task asks for 2–3 tools compared on one brief. **Not run, deliberately.**

A tool comparison answers "what should generate the deck". That is already
answered: a tested in-repo template renders HTML from structured model
output, which is why §1 can delete four of the task's checks outright. Every
alternative — Slides, Gamma, Beautiful.ai, PowerPoint via a library — moves
layout back into generated output, reintroduces those failure modes,
requires a subscription the task forbids buying, and breaks the CSP.

The comparison worth running is a different one, and it is the editing
question in §1: it belongs to the Drive task, not here.

## 6. Grading result

All 12 decks: correctness, level fit, Hebrew/RTL, structure and homework
**passed**. Detail and the digit-by-digit verification are in
`game-standard.md` §3, since both standards were graded from one corpus.

## 7. Decisions (Lior, 2026-09-25)

These were teaching judgements, flagged rather than resolved. Lior decided
them:

1. **Deck length varies by plan:** about 8 slides for 45 minutes, 11 for 90,
   14 for 135. Carried as `slides` on each plan in `src/lib/plans.ts` and
   asked for by `slideTarget()` in `src/lib/server/lesson/prep.ts`.
2. **Worked examples stay as slides,** after the teaching slides. No change.
3. **No summary-for-parents slide.** Deliberate: the parent page is where
   that belongs.
4. A random sample to read end-to-end: `m-gd-1` (כיתה ג–ד arithmetic),
   `p-ya-1` (כיתה יא kinematics). Both graded A by me.
