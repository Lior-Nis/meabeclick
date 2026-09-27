# Progress that separates coverage from understanding

Todoist `id:6hRhqR5c68wXWXFH`, and the half of `id:6hRhqRvfX7VHgh9q` that
links practice to skills — they are the same body of work approached from
two ends, and doing them separately would mean designing the same link
twice.

Design only. Nothing here is built yet; §6 says what ships first.

## 1. What is already true, and was worth checking before designing

The task reads as though the system currently infers mastery from activity.
It does not. Checked on `origin/main`, 2026-09-21:

| completion condition | already holds? |
|---|---|
| marking "completed" must not mark mastery | **yes** — `addStatusEvent` has exactly one caller, the tutor-only `POST /api/plans/[id]/events`, and it requires an explicit status. Finishing a game writes a `results_v2` row and nothing else. |
| missing data shows "טרם נבדק" | **yes** — `currentStatus()` returns `not_checked` when a skill has no status event, and that is its Hebrew label. |
| the plan updates only on an approved report | **yes** — `fileReport()` is what turns the tutor's per-skill entries into status events. |
| a report change is explainable and restorable | **partly** — `plan_events` is append-only with `note`, `evidence` and `at`, so the history exists. Nothing presents it as a history, and nothing lets her correct an entry as a correction rather than as a new opinion. |

So three of four conditions hold today. That reframes the work: this is not
about stopping bad inference, it is about **starting good suggestion** —
the tutor currently sets every skill by hand with no help from the evidence
the system already collects.

## 2. The missing link, which is the whole blocker

A skill assessment wants evidence. The evidence exists:

- `results_v2` — score, total, tries, stars, seconds, missed, per game play
- `homework` — task, template, data_id, done

**Neither carries a `node_id`.** Nothing connects a game or a homework task
to the skill it practises. Every "suggest a status from evidence" idea dies
here, and so does `6hRhqRvfX7VHgh9q`'s "associate skill and version".

Worse, the link cannot simply be added to the tables: a lesson's games come
from the generator (`plan.games`), and the generator is never told which
skills the lesson targets. `LessonPlan` has no node ids in it. So the chain
is:

```
lesson generation learns which skills it targets
        ↓
games and homework rows carry node_id
        ↓
results become per-skill evidence
        ↓
a draft suggestion can be computed
        ↓
tutor approves  →  plan updates (this part already works)
```

Everything above the third line is new work. That is why this is several
changes, not one.

## 3. The four open decisions, answered

The task lists these as open. Taking them, with reasoning, so the work is
not blocked on a meeting.

### 3.1 The understanding scale

**Recommendation: keep the existing six, add nothing.**
`not_checked → started → guided → with_help → independent`, plus
`needs_review` as the flag that pulls a skill back. It is already in
production, already the CHECK constraint in migration 004, already labelled
in Hebrew, and `SATISFIED = ['with_help', 'independent']` already encodes
"enough to move on". A new scale would be a migration and a retraining of
the one person who uses it, to express nothing she cannot express now.

**Coverage is not a point on that scale.** It is a separate fact: *this was
taught*, regardless of how it went. Adding a `covered` status would corrupt
the scale, because "we covered it and she did not get it" would have to be
recorded as progress. §4 says where coverage goes instead.

### 3.2 What evidence suffices for a system suggestion

**Recommendation: a suggestion needs evidence a human would accept, and
below that threshold the system says nothing rather than guessing.**

| evidence | suggests | why not stronger |
|---|---|---|
| no data | *nothing* — stays `not_checked` | silence is the honest output |
| skill taught in a lesson, no practice | *nothing*, but shows "נלמד, טרם נבדק" | coverage is not assessment (§4) |
| one game play, any score | *nothing* | one play is noise: a lucky quiz, a sibling on the tablet |
| ≥2 plays, ≥80% correct, no hints on the last | `with_help` | repeated success, but a game is a supported context |
| ≥2 plays, ≥80%, and homework on the skill marked done | `independent` | two independent contexts agreeing |
| ≥2 plays, <50% | `needs_review` | the one direction worth flagging on weak evidence |
| plays trending down | `needs_review` | |

`independent` is deliberately hard to reach from activity alone. A game is
not a test, and the tutor's own observation should remain the main route to
it.

**Every suggestion carries its evidence**, as counts and dates, not as a
score out of ten. "3 plays, 85%, last 19/09" is checkable; "confidence 0.7"
is not.

### 3.3 What the family sees

**Recommendation: statuses and skill names, never suggestions, never
internal notes, and no percentage that has no defined meaning.**

A suggestion is a draft opinion the tutor has not accepted. Showing a
family "the system thinks she is independent" while the tutor has not said
so makes the tutor's approval decorative, and makes a disagreement into a
visible contradiction.

The portal already shows per-skill status and a progress figure. That
figure should be defined as *completed skills ÷ visible skills in the
active plan* — a count, not a judgement — or removed. `buildTree` already
computes `completed`/`mastered`; the definition just needs stating where
the family can see it.

### 3.4 Progress-summary policy

**Recommendation: summarise by counting, and let anything uncounted be
visible as uncounted.** "4 of 11 skills, 2 need review, 5 not yet checked"
is a sentence every part of which can be traced to a row. Anything that
blends coverage, activity and assessment into one number reintroduces
exactly the conflation this task exists to remove.

## 4. Where coverage goes

A fifth `plan_events.type`, `covered`, beside `status`/`visibility`/`move`/
`goal`. It records that a skill was taught in a given lesson, carries the
lesson, and never touches `currentStatus()`.

That keeps one append-only log as the single history for a skill — which is
what makes §3.4's summary and the corrections in §5 possible — while
keeping the status scale meaning only what the tutor asserted.

## 5. Corrections

A correction is not a new opinion. It needs to say *what it replaces* and
*why*, so the history reads as a history rather than as a tutor who changed
her mind three times.

**Recommendation:** `plan_events` gains a nullable `corrects` column
pointing at the event being corrected. The log stays append-only — nothing
is ever edited or deleted — and the view shows a corrected event struck
through beneath its replacement, with both dates. "Explainable and
restorable" then follows from the data rather than from a feature.

## 6. What ships first

In dependency order. Each is its own change with its own tests.

1. **`covered` events** (§4) — self-contained, no schema link needed, and
   immediately gives "נלמד, טרם נבדק" instead of a bare "not checked" for a
   skill the tutor did teach.
2. **`corrects` on `plan_events`** (§5) — also self-contained, and makes the
   fourth completion condition true.
3. **The link** (§2) — the generator is told which skills a lesson targets;
   `homework` and `results_v2` carry `node_id`.
   **Shipped 24.9.2026, with two corrections to this line.**

   *One skill, not several.* A lesson targets exactly one, chosen by
   `nextTargetSkill` from the plan: `needs_review` first (the tutor taught
   it and pulled it back), then work in progress, then the next unstarted
   skill — skipping hidden and blocked ones, and returning null rather than
   inventing work. One skill per 45 minutes is honest pedagogically and
   makes the evidence unambiguous, which the §3.2 thresholds need.

   *Not `results_v2.node_id`.* The evidence link for a game lives in a new
   `game_skills` table keyed on **(student_id, data_id)**. I first reasoned
   a result could reach a skill through `results_v2 → (student, data_id) →
   homework → node_id`, and the code says otherwise: `appendToPortal`
   deliberately writes generated homework with `dataId: null`, because
   every task used to be handed the lesson's first game and one quiz play
   ticked four pen-and-paper exercises. Generated homework is *offline*
   work; a lesson's games are published separately and are not homework
   rows. So there are two kinds of practice and two links, which is not the
   same as storing one fact twice.

   The student key is load-bearing: a data id identifies a *game*, and the
   same game goes to many children. Keyed on `data_id` alone, one child's
   play would become evidence about another child's skill.

   *The model is never asked for an id.* It is told the skill's title, in
   the trusted trailer after the prompt fence — a plan title is ours, not a
   stranger's form post, and putting it inside the fence would tell the
   model to ignore the one instruction there that we wrote. The node id
   stays on the server and is what the rows are tagged with, so a
   hallucinated or cross-plan id is impossible by construction rather than
   by validation.

   Re-validated after the prompt change, as docs/quality/ requires: 3 real
   generations (product rule/כיתה יא, חוק אוהם/כיתה ט, משוואות/כיתה ז), all
   `validateLesson`-clean, all titled after the targeted skill, and the
   product-rule examples checked by hand.
4. **The suggestion engine** (§3.2) — pure, evidence-in/draft-out, no
   writes, heavily tested against the thresholds above.
   **Shipped 24.9.2026**, as `plans/suggest.ts` (pure) plus
   `plans/evidence.ts` (the SQL that feeds it), with one rule dropped and
   one added.

   *Dropped: "no hints on the last play".* There is no hints column.
   `results_v2` carries score, total, tries, stars, seconds and missed, and
   `tries` is not a hint count — on a memory board it is how many cards were
   turned, which is the game working as designed. Approximating a hint with
   a number that means something different in every second template would
   make the threshold unfalsifiable, so the clause is gone rather than
   guessed at.

   *Added: a trend needs three plays and a 15-point drop.* "Plays trending
   down" was unquantified. Two points are a line through noise, and a small
   dip inside strong work (100, 100, 90) is a good week — flagging it would
   teach the tutor to ignore the flag, which is how this feature dies.

   *A grade, not a submission, reaches `independent`.* §3.2 says "homework
   on the skill marked done". Since #92 those are two different facts: a
   submission is the student's claim, a grade is the tutor's verdict.
   `independent` is the strongest thing the plan can say, so it rests on the
   verdict.

   The engine returns **null** below every threshold, and that is the most
   load-bearing behaviour in it: a suggestion the tutor has to second-guess
   costs her more than no suggestion, and a wrong one beside a child's name
   is worse than both. A structural test asserts the module cannot reach the
   database or write, so §7's approval gate cannot be routed around by a
   later edit.
5. **The tutor's draft UI** — suggestions shown in the report form with
   their evidence, one click to accept, never applied unasked.
   **Shipped 24.9.2026.** The draft sits under each skill in the report
   form, saying «הצעה» in words and carrying its counts; `acceptDraft` is
   the only route from a draft into the form, and it is a click. Nothing
   preselects and nothing ticks a skill because a draft exists — a tutor
   confirming the system's opinion instead of recording her own is a
   preselected draft with an extra step, and §7 is the whole point.

   Tests pin both halves: that the engine is consulted with real evidence,
   and that no assignment into `statusChoice` can come from anything but the
   accept path. One more pins §3.3 — the portal, the parent page and the
   student page must carry no suggestion at all.

Steps 1 and 2 are worth doing even if 3–5 are deferred: they make the
history honest, which is the part a tutor has to trust before any
suggestion is worth showing her.

## 7. Deliberately not in scope

Any automatic change to a plan. The approval gate in §1 is the feature, not
an obstacle to route around — every step above either feeds the tutor a
draft or records what she decided.
