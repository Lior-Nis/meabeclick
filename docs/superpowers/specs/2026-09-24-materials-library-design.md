# A materials library keyed on the skill tree

Todoist `id:6hRw46wfC9FHXCjq`. **Design only** — the task says so explicitly
(«המשימה אינה מבקשת עדיין לממש את הספרייה»), and §8 says what would ship
first if it is approved.

## 1. What already exists, checked rather than assumed

The task reads as though materials are scattered and tied only to a lesson.
Half of that is true, and the half that is not changes the design.

| piece | where it is today |
|---|---|
| Slides, lesson plan | `lesson_materials` — versioned, append-only, with `teacher_only` and `published_at` (migration 012) |
| Games | `games/registry.json` templates + a data file per assignment, under `games-data/` |
| Homework | `homework` rows, one per task |
| Tutor notes | `plan_events.note`, and `lesson_reports` |
| The skill tree | `plan_nodes` — topic → branch → skill, per enrolment |
| Skill ↔ practice | `homework.node_id` and `game_skills (student_id, data_id)` (#98) |
| PDFs, worksheets | **nowhere.** No table, no route, no upload path |

Two things follow.

**The linkage the task asks for mostly exists.** «לקשר חומר למזהי תלמיד,
מקצוע, מיומנות ושיעור בלי להסתמך על שם קובץ בלבד» — #98 built exactly that
for the two kinds of practice a lesson produces. The library does not need a
new linking concept; it needs the same one extended to material that is not
generated.

**Versioning also exists, and is already load-bearing.** `lesson_materials`
is append-only with an explicit publish step, and #106 made its two rules
true: a student only ever sees a published version, and generation cannot
overwrite a tutor's edit. The library should adopt that table's model rather
than invent a second one.

The real gap is narrower than the task's framing: **there is nowhere to put
a file a human made.**

## 2. Metadata, and the half that should not be stored

The task lists: subject, topic, branch, sub-skill, grade, level, purpose,
language, version, owner, and draft/approved/published state.

**Store the identifiers. Derive the rest.**

`node_id` already implies subject, topic, branch and skill — the node sits
in a tree that belongs to an enrolment that names the subject. Copying those
onto every material row would create five more places for the same fact to
disagree, and this repo has spent a week fixing exactly that shape
(`progress-facts.ts`, `skill-suggestion.ts`, `brand.ts`, and the
`[object Object]%` a parent saw).

So a material row carries:

| column | why it is not derivable |
|---|---|
| `node_id` | the anchor; everything hierarchical comes from it |
| `kind` | `slides`, `pdf`, `worksheet`, `solution`, `note`, `game`, `homework` |
| `audience` | `student`, `family`, `teacher` — see §5 |
| `version`, `published_at`, `origin` | same shape as `lesson_materials` |
| `owner` | who uploaded it; a human, not a system |
| `title`, `purpose` | free text a tutor writes; nothing else knows it |
| `lesson_slug` | nullable — library material outlives any one lesson |

`grade` and `level` come from the enrolment. `language` is Hebrew; a column
for it would be a column with one value, and the day there are two is the
day to add it.

## 3. Student-agnostic material, which the task's hierarchy hides

The task's path is `תלמיד → מקצוע → נושא → ענף → תת־יכולת → חומרים`, which
puts the student first. That is the right *navigation*, and the wrong
*storage*.

A worksheet on חקירת פונקציה is about the skill, not about Alon. Keying
material to a student would mean re-uploading it for the next child, and the
library's whole point is reuse.

But `plan_nodes` rows are **per-enrolment**: two students studying the same
topic have different node ids for the same skill. Keying material on
`node_id` therefore keys it to one child by accident.

**So material keys on the template node key** — `calc.rules.a` — which is
stable across plans, and `plan_nodes.key` already carries it. The student's
view resolves their node to its key, then asks the library for that key.
One upload, every child who has that skill in their plan.

This is the single most important decision in this document, and it is
invisible in the task's framing.

## 4. Search and filter

Two entry points, both named in the task:

- **From a skill in the tree** — everything for this key, newest first.
- **From the student card** — everything for the keys in that student's
  plan, filtered by status so «what can I send them right now» is one view.

No full-text search in the first version. The corpus is one tutor's
material; a title and a skill filter find things faster than a search box,
and a search box implies an index that has to be kept true.

## 5. Who sees what

Three audiences, and the separation must be structural rather than
remembered:

- **`teacher`** — solutions, internal notes. `lesson_materials` already
  proves the pattern: `teacher_only` is a separate column so that not
  sending it to a student is a property of the SELECT, not of a caller
  remembering to delete a key.
- **`student`** — worksheets, slides, games.
- **`family`** — summaries. Per the progress spec §3.3, never suggestions
  and never internal notes.

Nothing reaches a student without `published_at`, the rule #106 made true
for slides. **A solution is never published**, whatever anyone clicks: an
`audience = 'teacher'` row should be unpublishable by construction, not by
a confirmation dialog.

## 6. Versioning that does not rewrite the past

The task's sharpest requirement: «עדכון חומר לא ישנה בדיעבד את משמעות תשובה
שכבר נמסרה».

`homework` records `data_id` and `node_id` but **not which version of the
material the child answered**. Edit a worksheet after a child submits, and
their answer silently becomes an answer to a different question.

The fix is to pin the version at assignment time — `homework.material_version`
— not to freeze materials. This is the same piece of work as step 4 of
`id:6hRhqRvfX7VHgh9q`, and doing it twice would be doing it twice.

Duplicate protection on retry is the `UNIQUE (booking_id, kind)` pattern
from migration 017: the constraint is the guarantee, not a check the caller
remembers.

## 7. Storage: internal, Drive, or both

The open decision. **Recommendation: metadata internal, bytes in Drive.**

Drive is already the backup target, already owned by the business account,
and a tutor can drop a PDF into a folder without an upload UI existing. What
Drive cannot do is answer "everything for `calc.rules.a`" — so the row lives
here and points at the file.

This is **blocked on the same unanswered question** as
`id:6hRQQVWxcCgrjRCq` and the student records: who owns the Drive folder and
who may read it. That one decision now gates three tasks, which is worth
saying plainly rather than discovering a third time.

## 8. What would ship first

1. `materials` table keyed on node **key**, with audience and the
   `lesson_materials` version model. No upload yet — generated slides get a
   row, so the read path is exercised by real data.
2. The skill-tree view: everything for this key.
3. `homework.material_version`, pinned at assignment (§6) — shared with
   `id:6hRhqRvfX7VHgh9q` step 4.
4. Upload, once §7 is decided.

## 9. The dummy scenario, and why it is not run here

The task asks for a walkthrough for Alon across חקירת פונקציה, geometry and
probability. Not run, deliberately: Alon is a real student, and this
document is design. A walkthrough belongs with the implementation, against a
seeded student, so that "navigating from a topic to its material" is
something observed rather than imagined.
