# A prepared library: materials per skill, made once, used at every booking

Decided by Lior, 2026-09-28: "why would I want to generate the next lesson
when the whole subjects graph is laid out and prepared?" — and "yes, do it"
to a trial on one topic. Replaces the "prepare next lesson" button
(Todoist 6hRhqRH7xq5f7vFH) and starts the library task (6hRw46wfC9FHXCjq).

## Today

The plan templates give each grade a tree of topics and skills, but no
skill has any material. Every booking runs Codex for that one student
(~2.5 minutes), and the result is used once.

## The model

- **A library item is a master lesson for one skill of one template**
  (`math-8` / `alg.eq.word`). It is an ordinary lesson: a `lessons` row, a
  slug (`lib-…`), versions in `lesson_materials`, slides and game files. So
  the existing editor, preview and history work on it unchanged.
  `library_items` (migration 023) records which master belongs to which
  skill.
- **Preparing** runs the ordinary generator once per skill, told the
  skill's title as its target, at the template's grade. Validation failures
  hold the item (not ready), exactly like a booking's lesson. Skills are
  prepared one at a time, in the background.
- **At a booking**, when the child's plan targets a skill whose item is
  ready, no Codex runs. The master's *published* plan is copied into this
  booking's lesson through the same `publish()` a generated plan goes
  through. The copy gets its own slides, games and homework (answer key
  included), and it reaches the child's page the same way. The lesson row
  says `source = 'library'`. If there's no ready item, the lesson is
  generated as today.
- **Editing.** Editing the master changes every *future* lesson on that
  skill. Editing a child's copy changes only theirs. A copy is a snapshot
  at booking time.

## The gate

`scripts/vision-metrics.mjs` counts clean runs in `lessons`. Preparing a
master is a real Codex run and counts. A copy runs no Codex and does not
count (`source = 'library'`), and the metrics report copies separately.

## Surfaces

- `/app/library` (tutor): a template's topics and skills; per skill, its
  status and links to view and edit; «הכנת הנושא» per topic, «הכנה מחדש»
  per skill.
- `GET /api/library?template=…` (tutor); `POST /api/library/prepare`
  `{ template, topic | skill }`, accepting the tutor's session or the
  box's cron key, like `/api/drive-sync`.

## The trial

`math-8`, topic `alg` («התחום האלגברי»), six skills. Prepared in
production, reviewed by the tutor in the editor, then used by the next
grade-8 booking whose plan targets one of them.

## Not in the trial

- **The parent's free-text request** can't reshape a prepared lesson
  without Codex. It is still recorded and shown to the tutor, who edits the
  copy.
- **One item per skill.** No variants by level or style yet.
- **Maths only**, like generation (#15).
