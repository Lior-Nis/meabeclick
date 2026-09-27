# Design — Learning plan: skill tree, teacher view, manual status

Date: 2026-09-12
Todoist: "לאפיין תכנית למידה היררכית לכל תלמיד לפי מטרת מבחן או בגרות, עץ יכולות
ותתי־יכולות, ותצוגה למורה בלבד" (P1)
Research this rests on: [`docs/superpowers/research/2026-09-12-israeli-math-curriculum.md`](../research/2026-09-12-israeli-math-curriculum.md)

## 1. Context

The tutor has no place that answers "what does this student actually know, what
was checked, and what is the next step". What exists today:

- `students_v2.progress` / `progress_note` — a single integer and a free-text
  note per student. Not per subject, not per skill, and not evidence of
  anything.
- `results_v2` — one row per finished game, carrying score, tries and a `missed`
  list. It names a game data file, not a skill.
- `homework.done_manual` — a completion flag. Completion is not mastery.
- `enrollments` — (student, subject, level) where `level` is free text such as
  "כיתה ט".

Three things the source task assumes, which do **not** exist:

1. **An end-of-lesson report.** The task says progress updates come from "דיווח
   השיעור שהמורה ממלאת בעקבות המייל של מאה בקליק". There is no such email, form,
   or table anywhere in the codebase. `/api/remind` sends the tutor one weekly
   WhatsApp about opening booking slots; that is all.
2. **A server-backed student card.** The dashboard's student cards are a
   browser-local CRM (`localStorage: tutor_dashboard_v2`) whose records carry
   local string ids with no link to `students_v2`. A plan cannot hang off them.
3. **Any link from practice to a skill.** Games and homework reference a data
   file id, never a skill.

### 1.1 This task is five specs, not one

The Todoist task overlaps four sibling tasks (plan management, progress from
evidence, next-lesson generation, materials library). Attempting them together
would produce a spec nobody can implement in one pass. The agreed decomposition:

| # | Spec | State |
|---|---|---|
| 1 | Plan model, teacher view, **manual** status | **this document** |
| 2 | End-of-lesson report (new) producing **draft** status changes | later |
| 3 | Game and homework evidence linked to skills | later |
| 4 | Next lesson generated from plan + report | later |
| 5 | Materials library hung on the tree | later |

This spec is designed so specs 2 and 3 add event *sources*, not new tables.

### 1.2 The north-star constraint

PRODUCT.md: "A feature that adds capability but also adds a manual step for
Nikol is a net loss even if the feature itself is good." A skill tree that the
tutor must author per student is exactly that. Hence templates (§4): she reviews
a tree **once per track**, not once per student.

## 2. Scope

**In.** Per-student, per-subject plan created from a reviewed template; a
tutor-only page showing the tree with status, counts, prerequisites, history;
manual status setting with a note and an evidence type; hide, pause and reorder;
two math templates (4 and 5 units).

**Out.** Lesson reports; automatic status from games or homework; lesson
generation reading the plan; a materials library; anything visible to a family
(§11 records how that stays true); percentages (§6); editing the tree's *content*
(adding a skill the template does not have).

## 3. Decisions

| Decision | Chosen | Why |
|---|---|---|
| Tree source | Curated templates per track, copied per student | One review per track, not per student (§1.2) |
| Status scale | The task's six values, on **skills only** | Branches/topics are summaries, not judgements |
| Roll-up | Counts per status | A percentage needs a defined calculation; the task forbids one without |
| Storage | Copy template rows into SQLite, stable keys | A template fix never silently reshapes a live plan; spec 3 can reference a skill row by id |
| Placement | Own page `/app/plan/<code>` from the roster | The student cards are local-only (§1) and a deep tree needs a full phone screen |
| First templates | math 4 units, math 5 units | 3 units has no calculus at all, so it cannot carry the task's priority topics |

Status values, as stored: `not_checked`, `started`, `guided`, `with_help`,
`independent`, `needs_review`. Displayed as לא נבדק, התחלה, בתרגול מודרך, בוצע
עם עזרה, בוצע עצמאית, דורש חזרה.

## 4. Templates

Files: `templates/plans/math-4u.json`, `templates/plans/math-5u.json`. They sit
in the repo beside `games/registry.json`, are read at runtime off `process.cwd()`
the same way, and are copied into the image by their own `COPY` line in the
Dockerfile. They are **config, not content**: they do not live under `DATA_DIR`.

Shape (three fixed levels — topic → branch → skill). Excerpt: one topic of many,
and `calc.rules.quotient` cites a prerequisite key that lives under another
topic, which is the cross-topic case §4 allows:

```json
{
  "id": "math-5u",
  "version": 1,
  "subject": "מתמטיקה",
  "track": "5 יח\"ל",
  "questionnaires": ["35571", "35572"],
  "source": "docs/superpowers/research/2026-09-12-israeli-math-curriculum.md",
  "reviewed": null,
  "topics": [
    {
      "key": "calc",
      "title": "חשבון דיפרנציאלי ואינטגרלי",
      "branches": [
        {
          "key": "calc.rules",
          "title": "כללי גזירה",
          "skills": [
            { "key": "calc.rules.power", "title": "נגזרת של x^k, סכום והפרש, כפל בקבוע", "requires": [] },
            { "key": "calc.rules.quotient", "title": "נגזרת של מנת פונקציות", "requires": ["calc.rules.power", "func.rational.pre"] }
          ]
        }
      ]
    }
  ]
}
```

- **Keys are stable and dotted.** They are what a copied plan keeps, and what a
  future "sync from template" would match on.
- **`requires` may cross topics.** Right-triangle trigonometry requires triangle
  similarity; the research records such edges explicitly.
- **`reviewed`** is `null` until Nikol has read the tree, then
  `{ "by": "ניקול", "date": "YYYY-MM-DD" }`. An unreviewed template still works;
  the page shows «התבנית טרם נסקרה» until it is filled in.
- **`version`** is bumped by hand when content changes. A plan records the
  version it was copied from, so it is always possible to say which tree a
  student's plan came from.

Content comes from the curriculum research, which maps the **new** structure
(questionnaires 35471/35472 and 35571/35572; the old 35481/35581 numbering is
superseded). Track differences are real and must be preserved: second
derivative, concavity and inflection points are 5-unit only; the 4-unit tree
excludes them.

## 5. Schema

One migration, `004_learning_plans`.

```sql
CREATE TABLE plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id       INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id    INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
  template_id      TEXT    NOT NULL,
  template_version INTEGER NOT NULL,
  goal             TEXT    NOT NULL,
  exam_date        TEXT,
  focus            TEXT,
  created_at       TEXT    NOT NULL
);

CREATE TABLE plan_nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  key        TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES plan_nodes(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('topic', 'branch', 'skill')),
  title      TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  visibility TEXT    NOT NULL DEFAULT 'active'
             CHECK (visibility IN ('active', 'paused', 'hidden')),
  UNIQUE (plan_id, key)
);

CREATE TABLE plan_prereqs (
  skill_id    INTEGER NOT NULL REFERENCES plan_nodes(id),
  requires_id INTEGER NOT NULL REFERENCES plan_nodes(id),
  PRIMARY KEY (skill_id, requires_id)
);

CREATE TABLE plan_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal')),
  status     TEXT    CHECK (status IN ('not_checked','started','guided','with_help','independent','needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson','homework','game','test','other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher')),
  at         TEXT    NOT NULL
);
CREATE INDEX plan_events_node ON plan_events (node_id, id);
```

Notes:

- **`plan_events` is the history for everything**, not only status: hiding,
  pausing, reordering and goal edits are events too, because the sibling task
  requires structure changes to carry source and history.
- **`source` is a single-value CHECK today.** Spec 2 adds `'report'`, spec 3 adds
  `'game'` / `'homework'`, each a one-line migration with no other table change.
- **Status lives only on skills.** SQLite cannot express that across tables; the
  store enforces it and a test pins it.
- **No `status` column on `plan_nodes`.** Current status is derived (§6), so the
  event log can never disagree with the displayed value.

## 6. Derived rules

Computed on read, in the pure `plans/view.ts` module:

- **Current status** = the latest `status` event for that skill. No event means
  `not_checked`, so a freshly copied plan needs no seeded events.
- **Roll-up** = counts per status across the skills under a branch or topic.
  `active` and `paused` skills count; `hidden` skills are excluded entirely.
- **Blocked** = a skill has at least one non-hidden prerequisite whose status is
  below `with_help` (that is, `not_checked`, `started`, `guided` or
  `needs_review`). Blocked is a hint. It never prevents setting a status, since
  the tutor in the room outranks the model.
- **Changed since the last lesson** = events whose `at` is later than the start
  of the student's most recent confirmed `bookings_v2` row that has already
  begun. With no such booking, nothing is marked.
- **Recommended now** = not blocked, and status in `needs_review`, `guided` or
  `started`, ordered with `needs_review` first.
- **No percentages.** Adding one requires first defining what it divides by, in
  the presence of hidden and unchecked skills. Deliberately deferred.

## 7. The page

Route `/app/plan/<student code>`, tutor session required, reached from a new
«תכנית» link on each row of the dashboard's portal-access roster (which is
already server-backed, unlike the student cards).

```
← לוח בקרה
יובל כהן
[מתמטיקה] [פיזיקה]                        one chip per enrollment
בגרות 5 יח״ל · מבחן 12.06.2027 · מיקוד: חקירת פונקציה רציונלית   [עריכה]
⚠ התבנית טרם נסקרה                        only while template.reviewed is null
הצג: [הכל] [מומלץ עכשיו] [דורש חזרה] [חסומים] [שונה מאז השיעור]

▾ חקירת פונקציה        4 עצמאי · 2 בתרגול · 1 דורש חזרה · 3 לא נבדק
   ▾ גזירה             2 עצמאי · 1 בתרגול
       חוקי חזקות             בוצע עצמאית
       כלל המנה  ●            בתרגול מודרך
       נגזרת שורש  🔒          לא נבדק
   ▸ נקודות קיצון      …
▸ גיאומטריה            …
מוסתרים (3) ▸
```

- **Disclosure.** Topics and branches are buttons with real expanded/collapsed
  state, not divs.
- **Status is never colour alone** — every pill carries its Hebrew label. Colours
  come from existing tokens that already meet AA (`--accent2-strong`,
  `--accent3-strong`, `--danger`, `--text-muted`).
- **● marks changed since the last lesson; 🔒 marks blocked** and names the
  prerequisite in the sheet.
- **Tapping a skill** opens a bottom sheet (phone) or side panel (desktop): the
  six statuses as ≥44px buttons, an evidence type, an optional note, Save; below
  that, prerequisites with their statuses, then history newest first.
- **Structure menu** per node: pause, hide, move up, move down. Paused nodes stay
  visible and dimmed; hidden nodes collapse into «מוסתרים» and can be restored.
- **No plan yet** for a subject: a create card (template picker filtered by the
  enrollment's subject, goal, optional exam date, optional focus). If no template
  matches the subject — physics today — it says so plainly.
- **Saving is never optimistic.** The server write returns the refreshed view and
  the page re-renders from it; a failure leaves the previous state and shows the
  dashboard's existing error toast.
- **Phone first**, RTL, 320px minimum, no horizontal scroll.

## 8. Server modules, API, errors

Modules, each independently testable:

| Module | Responsibility | Depends on |
|---|---|---|
| `plans/templates.ts` | load + validate + cache template files | filesystem |
| `plans/view.ts` | **pure**: rows → rendered tree + derived rules (§6) | nothing |
| `plans/store.ts` | all SQL; one transaction per write | `db.ts` |
| `routes/app/plan/[code]/` | page load + components | store, view |

Template validation: exactly three levels, unique keys, every `requires`
resolves, no cycles, every node titled. A boot check warns on an invalid
template without blocking boot (matching `checkRegistry`); a unit test runs the
same validation against the shipped files, so CI is the real gate.

API, tutor-only, mirroring the event log:

```
POST /api/plans               { code, subject, templateId, goal, examDate?, focus? }
POST /api/plans/<id>/events   { type: "status",     nodeId, status, evidence?, note? }
                              { type: "visibility", nodeId, visibility }
                              { type: "move",       nodeId, direction: "up" | "down" }
                              { type: "goal",       goal, examDate?, focus? }
```

Both return the refreshed plan view.

| Case | Status |
|---|---|
| Enrollment already has a plan | 409 |
| Unknown template, or template subject ≠ enrollment subject | 400 |
| The student has no enrollment in that subject | 400 |
| Status on a non-skill node; unknown status/evidence/visibility; note > 1000 chars; malformed date | 400 |
| Plan not found, or node not in this plan | 404, identical body |

A move at the first or last sibling is a no-op returning 200.

**Authorization.** `apiAuthDenied` on both endpoints, so an anonymous caller and
a family cookie both get 401; `requireAuth` on the page, so it redirects to
`/login`. No plan field is added to `/api/portal`, `/app/parent` or
`/app/student`, and §10 pins that.

**Student deletion.** A plan is learning history, like lessons and payments, so
`deleteStudentCascade` refuses (409) when a plan exists, and its message widens
to name the plan. Enrollments and join codes keep being deleted as today.

**Concurrency.** Every write appends, so no history is lost. For current status
the last write wins, and the sheet shows the latest event, making the other
tab's change visible rather than silent.

## 9. What this deliberately does not decide

- **Whether any part of the tree is ever shown to a family.** Phase one is
  tutor-only, per the task. A later spec must decide what a parent sees before
  any plan data crosses into family scope.
- **Template sync.** If a template gains a skill after plans were copied,
  existing plans do not change. Stable keys make a future opt-in sync possible;
  designing it now would be speculative.
- **Percentages** (§6).
- **Free-form tree editing.** Nikol can hide, pause and reorder, not invent
  skills. If that turns out to be needed, it is a small follow-up, not a
  redesign: it is one more node kind and one more event type.

## 10. Testing

**Unit.** Template validation against **both shipped files**; track content
regressions (5u has second derivative / concavity / inflection, 4u does not;
both carry the investigation steps and geometry theorem families); every rule in
§6 against a fixture tree, including the boundary cases (no events, hidden
prerequisite, event exactly at the lesson boundary, no past booking); store
behaviour (copy preserves count/keys/order, duplicate key rejected, move swaps
and logs, failed create leaves nothing); migration (tables, foreign keys, CHECK
rejections).

**Characterization**, against the real build: page redirects without a tutor
session; both endpoints 401 for anonymous and for a family cookie; a full tutor
pass (book → create plan → set status → page renders topic and counts → history
holds the event → second create 409); no plan data in the portal payload or the
family pages; deleting a student with a plan is 409.

**Browser**, at 320/390/430/1280: expand topic and branch, open the sheet, set a
status, counts update, filters work, hide and restore, no horizontal scroll,
44px targets. Run and reported in the PR rather than committed, since the repo
has no Playwright dependency.

Everything except the browser pass runs in `npm test`, which CI runs per PR.

## 11. Consequences

- The tutor gets one place per student and subject that answers what is known,
  what was checked and what is next, with every claim carrying a date, a source
  and a note.
- Spec 2 (lesson report) becomes a matter of writing `plan_events` rows with
  `source = 'report'` in a draft state the tutor confirms.
- Spec 3 (evidence) links `results_v2` and `homework` rows to a `plan_nodes.id`
  and writes supporting events; the rule that evidence never sets mastery by
  itself is already expressed by status being tutor-set.
- Spec 4 (next lesson) reads the tree for gaps instead of reading booking free
  text.
- The student cards stay local-only for now. The pending "unify the student card"
  task is unblocked by this work and unaffected by it.
