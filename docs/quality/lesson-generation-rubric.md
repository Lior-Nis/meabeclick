# Lesson generation rubric

Written **before** the runs it grades, and deliberately so. A rubric written
afterwards encodes the failures that happened to appear, dressed up as
foresight; this one can be wrong, and being wrong where the evidence
contradicts it is the point.

Scope: automatically generated **teaching** lessons — slides, worked
examples, homework and games — as produced today by
`src/lib/server/lesson/prep.ts`. Marketing decks are a separate product
with different reviewers and are not graded here.

## How this relates to `validateLesson`

`validateLesson` already gates **shape**: at least 4 slides, at least 2
games, a quiz `answer` index inside its options array, every `sort` item's
category present in the category list, every `labelling` target id present
in the SVG, `twoTruths` rounds with exactly 3 statements and a `lieIndex`
in range.

Every one of those is a structural claim. None of them can tell whether the
maths is right. A quiz whose `answer` points at index 2 passes today even
when option 2 is the wrong answer, because the index is in range.

This rubric grades what structure cannot see. Anything it finds that turns
out to be **mechanically checkable** gets promoted into `validateLesson`,
where it becomes a gate rather than an opinion. Anything that needs a
teacher's judgment stays here and is checked by a person.

## Dimensions

Each dimension is scored **pass / weak / fail** on the whole lesson. Weak
means a tutor could use it after a fix of a minute or two; fail means it
would mislead a child or would be faster to rewrite than to repair.

### 1. Correctness — the highest-stakes dimension
- Every stated fact, definition and rule is true.
- Every worked example reaches the right answer, and every step in it
  follows from the one before.
- Every game answer key is right: the quiz `answer` **is** the correct
  option, the `twoTruths` `lieIndex` **is** the false statement, the
  `errorHunt` `badStep` **is** the faulty step.
- No invented content: no fabricated quotations, formulas, historical
  claims, or citations.

A single wrong answer key is a **fail** for the lesson. A child who is told
their right answer is wrong learns that the system is not to be trusted,
and that is more expensive than an unhelpful lesson.

### 2. Level fit
- Vocabulary, notation and prerequisites match the stated grade.
- The lesson does not assume a topic the curriculum places later.
- Difficulty rises across the lesson rather than starting at the end.

Graded against the stated level, not against some average child. This is the
dimension I expect to be weakest at the extremes (כיתה א–ב and כיתה יא–יב),
which is why the run matrix covers both ends rather than the comfortable
middle.

### 3. Hebrew and RTL
- Natural, fluent Hebrew — not translated-sounding.
- Correct gender agreement, and addressing the student consistently.
- Mixed Hebrew/Latin/number strings (formulas, units, ranges) read in the
  right order and do not break under RTL.
- No English leaking into student-facing text.

### 4. Structure and load
- Each slide holds one idea.
- No slide is a wall of text; nothing depends on content that overflows.
- The slide sequence tells a coherent story: motivation, rule, example,
  practice.

### 5. Games as learning
- The chosen game type actually suits the goal, per the selection rules in
  `games/registry.json` — not merely a valid template.
- Playing it requires the skill being taught, rather than pattern-matching
  the answer's shape or its position.
- Distractors are plausible: wrong options represent real misconceptions,
  not obvious nonsense.

### 6. Homework
- Solvable from what the lesson actually taught.
- Says what the child has to do, unambiguously.
- Matches the lesson's topic rather than the subject in general.

## Scoring

A lesson is **usable** only if Correctness passes. A failure there is not
traded off against the other five.

Otherwise: **A** = all dimensions pass. **B** = at most two weak, none
failed. **C** = three or more weak, none failed. **F** = any dimension
failed, or Correctness not passed.

## Run matrix

12 runs: **8 unique** — מתמטיקה and פיזיקה across כיתה ג–ד, כיתה ז, כיתה ט
and כיתה יא — plus **4 repeats** of briefs already in that set.

The four corners are chosen to be uncomfortable. Two of them sit at the ends
of the range, where I expect level fit to break; the middle is where I
expect it to look fine.

The repeats are not padding. A single output cannot distinguish "the prompt
produces this" from "this run produced this", and a standard built on one
sample per brief would encode luck. Running the same brief twice is the only
way to see variance at all.

פיזיקה at כיתה ג–ד is deliberately included even though physics is not
taught at that age. The booking form offers exactly two subjects and nine
levels with no restriction between them, so a parent can send this
combination today. What generation does with it — refuse, adapt to primary
science, or confidently invent a curriculum — is a real answer this standard
needs, not a trick question.

## Grading procedure

I grade every run against the six dimensions and record the evidence, not
just the verdict — the specific slide, the specific answer key. Every
judgment I am not confident in is **flagged for Nicole** rather than
quietly resolved, along with a random sample, because "is this how I would
teach it" is not a judgment I can make on her behalf.
