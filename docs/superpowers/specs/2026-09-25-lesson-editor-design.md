# The tutor's lesson editor

PRODUCT.md, Lesson autopilot: *"Nikol can still edit when she has to —
editing is a release valve, not the default path."* Todoist
6hRhqV8XX5wr4jqq. The server half exists (#79: `lesson_materials`,
versions, publish, restore; `/api/lessons/[slug]/materials`). Nothing in
the UI calls it.

## 1. What is true today

- Generation stores two versions per lesson (`recordGenerated`): `plan`, the
  structured `LessonPlan` JSON, and `slides`, the HTML `renderSlides` made
  from it. The student is served the latest **published** `slides`
  (`/lessons/[slug]`), falling back to the file for lessons from before
  migration 012.
- A regeneration never publishes over a tutor's edit (`recordGenerated`).
- The API saves any string as either kind. So a client could publish a
  `plan` that no `slides` reflect, or hand-written HTML.

## 2. Decisions

**D1. What does she edit?** The **plan**, never HTML. That covers the title,
the slides (heading, bullet lines, the on-slide note), and the worked
examples (problem, steps, answer), with slides and examples added, removed
and reordered. HTML editing is not a tutor's job, and any HTML she wrote
would be lost on the next render.

**D2. How do plan and slides stay in step?** One server operation,
`type: 'publish-plan'`. It validates the plan, renders slides from it with
the lesson's own subject/level/student, and appends **both** versions,
published. "Save draft" appends a `plan` version only, unpublished.
Nothing else produces slides from an edit.

**D3. Preview?** `POST /app/lessons/[slug]/preview` renders the unsaved
edit and returns it **as its own document** with the deck's
`documentHeaders()`. It stores nothing. The page submits a hidden form into
`<iframe name="lesson-preview" sandbox="allow-scripts">`, which has no
same-origin access. *(Changed during implementation: a JSON verb shown in
`<iframe srcdoc>` inherited the editor page's CSP. The deck's inline
style and script were blocked, and the preview came out unstyled.)*

**D4. Validation.** An edited plan needs a title and at least one slide.
Every slide needs a heading and at least one bullet. Every example needs a
problem and an answer. Text is trimmed. The generator's stricter rules
(≥4 slides and so on) are not applied: she is the judge of her own lesson.

**D5. Games and homework?** Not in this editor. Game data is immutable
once published (#125): a changed game needs a new data id and a new link,
which is its own feature. Homework already has its own editor on the
dashboard.

*Amended 2026-09-30, for library masters only*
(docs/superpowers/specs/2026-09-28-prepared-library-design.md). A master
is never played by a child, and each booking copied from it writes its own
game files and homework rows from the master's published plan. So on a
master (`lib-…`) the editor also edits the quiz's questions (text,
options, the marked answer, explanation, hint) and the homework (task,
answer key). An edit reaches the bookings copied after it; copies already
made keep what they got. A master's publish runs `validateLesson`, the
check every copy gets at booking, and is refused with its problems instead
of producing held copies. A draft is not checked. A student's own lesson is
unchanged: the server refuses question or homework edits for it.

**D6. Internal notes.** A "notes for me" field is stored in the version's
`teacher_only` column. It is never rendered into slides and never served
to a family. That is step 4 of the task.

**D7. History.** Versions of `plan` are listed newest first with origin
(נוצר / נערך / שוחזר) and published state. Restore loads a version into
the form. It does not publish it, because she may want to look first.

**D7a. What the form starts from, and what an edit applies to.** One rule,
`editBase()`: the newest parseable `plan` version that is published or is
her own work (edited/restored; a draft counts). An unpublished
**regeneration** is skipped and shown as a banner she can load from
history. Starting from it would let one publish send it out over her
edit, which is what `recordGenerated` prevents. *(Added after the final
review.)*

**D8. Lessons with no plan version** (generated before #106) show
«לשיעור הזה אין גרסה שאפשר לערוך — הוא נוצר לפני שמירת הגרסאות» and no
form.

**D9. Where.** `/app/lessons/[slug]/edit`, tutor session required, linked
from each lesson card on the dashboard («✏️ עריכה»).

## 3. Testing

- Store and API: `publish-plan` writes both kinds published, and the served
  slides reflect the edit. A draft save leaves the student's copy
  unchanged. `preview` stores nothing. Validation refuses each D4 case. A
  family session gets 401 on every verb.
- Page: source-level wiring, plus a browser walk: edit → save draft → the
  student still sees the old version → publish → the student sees the
  edit → restore an old version → publish.
