# Quality standard: automatically generated learning games

Todoist `id:6hRhMChmFm4C63Mq`. Evidence: 12 real Codex generations run on
24.9.2026 — מתמטיקה and פיזיקה across כיתה ג–ד, ז, ט, יא, plus 4 repeated
briefs. Graded against `lesson-generation-rubric.md`, which was written
before the runs.

## 1. What exists, measured rather than assumed

12 templates: `memory`, `matching`, `sequence`, `sort`, `labelling`,
`table`, `quiz`, `error-hunt`, `two-truths`, `speed-drill`, `graph-match`,
`number-line`.

They are static Svelte components, written and tested once. Generation
produces only a **data file** per assignment. This is the single best
decision in the games pipeline and the standard should protect it: a model
that emits data into a tested template cannot emit a broken game, only wrong
content. Nothing here proposes generating game *code*.

It also settles a question the task asks. "Which external tools are allowed"
has already been answered by the architecture: none. The CSP forbids remote
origins and new inline scripts, and games are local components. There is no
tool comparison to run, because there is no integration point to compare
tools at.

## 2. The finding that matters

`games/registry.json` carries a `selection` block of ordered rules mapping
a learning goal to a game type. Its comment said the lesson-prep pipeline
walks these top-down and picks the first match.

**Nothing reads it.** `getRegistry()` is consumed by exactly two places —
the games catalogue page (`/app/games`) and `isKnownTemplate()` for route
validation — and the generation prompt does not embed the rules. The model
chooses game types freely.

The evidence is in the repeats: **3 of the 4 repeated briefs came back with
a different game set.** Same subject, same level, same topic.

| brief | run 1 | run 2 |
|---|---|---|
| מתמטיקה כיתה ג–ד | quiz, sequence, twoTruths | quiz, sequence, twoTruths |
| מתמטיקה כיתה יא | matching, sequence, twoTruths | errorHunt, quiz, sequence |
| פיזיקה כיתה ז | matching, quiz, twoTruths | matching, table, twoTruths |
| פיזיקה כיתה יא | errorHunt, graphMatch, matching | graphMatch, matching, twoTruths |

**This is not currently a quality problem.** Every chosen game suited its
goal on inspection — `errorHunt` for the calculus misconception that a zero
derivative implies an extremum, `matching` for the symbol/unit/formula triad
in Ohm's law, `graphMatch` for velocity–time graphs. Free choice produced
good matches twelve times out of twelve.

It is a **truthfulness** problem, and the same shape as three production
bugs already documented in `src/lib/server/storage-inventory.ts`: a
structure that describes a mechanism nobody implements. The comment is now
corrected to say the block is advisory.

**Decided (Lior, 2026-09-25): wired in.** "Which game teaches this goal" is
the teaching judgement the business sells, so it lives in a file a teacher
can edit. `gameSelectionLines()` in `src/lib/server/lesson/prep.ts` renders
the rules, in order, into the generation prompt, and replaces the prompt's
hand-written paraphrase of the same mapping. The model still decides which
rules match a lesson. The rules are what it is told to decide by.

## 3. Grading results

All 12 lessons: **Correctness passed.** Every worked example checked by hand
reaches the right answer; every quiz key points at the correct option; every
`twoTruths` `lieIndex` marks the false statement.

Spot-checked in detail and verified digit by digit:

- כיתה ג–ד arithmetic: 268+157=425, 453−126=327, 602−278=324, and the
  place-value decompositions behind each.
- כיתה יא calculus: f(x)=2x⁴−3x²+5x−7 → f′=8x³−6x+5, f′(1)=7; full
  investigation of x³−3x² with max (0,0) and min (2,−4); the x³ example
  correctly showing a stationary point that is not an extremum.
- כיתה יא kinematics: v=10 m/s, x=27 m, Δx=24 m with the area cross-check;
  braking t=4 s, 24 m; and a graph question distinguishing displacement
  (8 m) from distance travelled (10 m).

**Level fit passed, including the case designed to break it.** פיזיקה at
כיתה ג–ד is a combination the booking form allows and the curriculum does
not teach. Generation did not invent high-school physics: it reframed the
lesson as מדע וטכנולוגיה — דחיפה, משיכה וחיכוך, which is what the Israeli
curriculum actually does at that age.

**Structure was stable across every run**: 8–10 slides, 3 worked examples, 4
homework tasks, every time. Variance lives in game selection, not in shape.

## 4. What is now enforced

Promoted into `validateLesson`, with tests in
`tests/unit/validate-lesson.test.mjs`:

| Rule | Why |
|---|---|
| Quiz answers not all at one index (≥3 questions) | A key that never moves is the thing the child learns, instead of the material |
| `twoTruths` lie not always at one index | Same failure, same fix |
| No duplicate options within a quiz question | Two identical options mean the correct answer is not unique — a child picking the duplicate is told they are wrong, and they are not |
| No repeated value on either side of a `matching` pair set | Ambiguous matching |
| No repeated card in a `memory` pair set | More than one correct pairing |
| No repeated step in a `sequence` | No single correct order; a correct ordering gets marked wrong |

**None of these fired on the 12-run corpus**, and that is stated rather than
hidden. They guard regressions, not a present defect: each failure is severe
and *silent* — it looks normal in the database, on the page, and in every
other check — and each costs one array comparison. A prompt change made by
someone not thinking about game quality is exactly how one would arrive.

Verified against all 12 real lessons after implementation: **0 rejected.**
A new gate that fails good output is worse than no gate.

Two checks were dropped during development because they were wrong, not
because the lessons were:

- A Latin-script detector flagged `anx` out of `anxⁿ⁻¹`. Maths notation is
  not leaked English.
- A duplicate-pair check read `left`/`right` for **both** `matching` and
  `memory`. `memory` uses `a`/`b`, so it compared empty strings and reported
  every lesson as broken.

Both were caught only because the checks were run against real output before
being encoded. That is the method this standard recommends, not an anecdote.

## 4.1 Help, and why it is measured — 24.9.2026

A game records score, total, tries, stars, seconds and missed. Todoist
`id:6hRhqRvfX7VHgh9q` puts the objection plainly: «ניקוד ומהירות לבדם אינם
הוכחה להבנה». A child who answered everything correctly after revealing
every hint produced a perfect score and demonstrated something quite
different from a child who answered cold.

`results_v2.hints` (migration 015) records help the child **asked for**.
That is a different measurement from the `hint` text `matching` already
showed after a correct match, which is explanatory feedback and says nothing
about what the child needed.

**`NULL` means no help was on offer, not that none was needed.** Most
templates offer none. An earlier draft of the suggestion rule treated null
as "unknown" and blocked `independent` on it — which would have made that
status unreachable for every quiz ever played. A guard that never lets
anything through is not a guard. Only help actually used blocks, and
`independent` additionally requires a graded piece of homework, so it never
rests on this signal alone.

`matching` is the first template to offer help, because it is the one whose
data already carries per-pair hints. Adding it elsewhere is a per-template
job and belongs with whatever else that template needs.

## 5. Process for adding a game type

1. Write the template as a static Svelte component under `src/lib/games/`.
2. Add its data shape to `games/registry.json` under `templates`.
3. Add a structural check to `validateLesson` for anything that would break
   it at play time, and a test for that check.
4. Generate at least two real lessons that select it, and verify the answer
   key by hand. Run-to-run variance is real; one sample proves nothing.
5. Check it on a phone and on a desktop, in Hebrew, with the keyboard only.

## 6. Not covered here

Progress tracking is already built (`src/lib/server/progress.ts`, skills,
`results_v2`), so the task's question about whether it is needed is already
answered in the affirmative by the code.

Automatic grading of played games is a separate task; two-stage homework
(`setHomeworkSubmitted` / `gradeHomework`) already leaves the `graded_by`
seam for it.
