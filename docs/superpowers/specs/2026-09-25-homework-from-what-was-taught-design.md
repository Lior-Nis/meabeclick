# Homework from what was actually taught

PRODUCT.md, Lesson autopilot, done for phase A: *"Homework is generated
from what was actually taught in that lesson, not from the plan in the
abstract."* Todoist 6hRhqRvfX7VHgh9q, step 1 («להפיק הצעות רק מהחומר
שנלמד בפועל»).

## 1. What is true today

- Homework is generated **at booking time**, with the slides and games,
  by one Codex run (`lesson/queue.ts` → `appendToPortal` → `addHomework`).
  Its skill link is the plan's *target* skill (`targeting.ts`): what the
  plan says comes next, not what happened.
- The rows are visible to the family **immediately**. A lesson booked a
  week ahead shows a week of homework for a lesson that has not happened.
- The lesson report (`reports/store.ts` `fileReport`) is the only record of
  what was taught. Each entry writes a `status` event and a `covered`
  event. Nothing downstream of a report produces homework.
- The report is chased: the tutor is prompted 30 minutes after the lesson
  ends and chased for 3 days (`SETTLE_MS`, `CHASE_MS`).

## 2. Decisions

Each was put as a question and answered with the recommended option
(standing instruction for this backlog: decide, don't ask).

**D1. Keep generating homework at booking time?** Yes, but **hold** it.
It is the fallback that keeps autopilot at ≥80% when no report arrives,
and it costs nothing extra: it comes out of the run that already happens.

**D2. When does held homework become visible?** When a report releases
or replaces it (§3), or automatically **24 hours after the lesson ends**,
whichever comes first. 24 hours is inside the report chase window, so a
tutor who reports the same evening always gets the taught version, and a
tutor who never reports still gets homework to the child the next day.

**D3. What does a report do?**
- **Entries (skills covered):** generate homework from those skills, the
  report note, and the enrollment's subject and level. The lesson's own
  title is not used: nothing links a booking to its `lessons` row. On success, the lesson's held rows
  are **deleted** and the new rows are inserted, visible now, each
  linked to the skill it practises. On failure, the held rows are
  **released** as they are, and the tutor is told in WhatsApp.
- **Note only:** release the held rows now. A note alone is not enough to
  write exercises from, and the lesson did happen.
- **Re-filing** (a correction) does nothing to homework once it has been
  released or replaced. Rewriting tasks a child may already be doing is
  worse than a stale task. The tutor can delete a task from the dashboard.

**D4. Already released when the report arrives (report after 24h)?** Then
generate nothing. The child has had the planned homework for a day, and
adding a second set would double the load. The report still records
coverage as it does today.

**D5. Which homework rows belong to a lesson?** New column
`homework.booking_id`, written at booking-time generation. The booking id
is in scope in `/api/book` where generation is triggered and is passed
through `TriggerOpts`. `lessons.lesson_at = bookings_v2.start` joins are
not used: two students can share a start time.

**D6. Who sees held rows?** Families never. `homeworkForStudent` excludes
held rows by default. That covers the portal, the portal's homework route
and the progress count. The tutor's activity route passes
`{ includeHeld: true }` and gets `heldUntil`, so she can see what will go
out and when.

**D7. What model call?** A second, small Codex run (`homework.ts`, same
`spawnAgent`, the same fenced-prompt helper as `ask.ts`), returning
`{ homework: [{ task, why, skillKey }] }`, 1–2 tasks per covered skill,
at most 5. Skill titles are ours and go in the trusted trailer. The
report note is typed by the tutor into a form and is sanitized and fenced
like any other free text. `skillKey` must be one of the covered skills,
and any other value is dropped rather than linked to the wrong skill.

**D8. Does this count toward the p1 gate?** No. The gate measures lesson
generation runs in the `lessons` table. A homework run is logged, and its
failure is visible to the tutor (WhatsApp + released fallback). Folding it
into the gate would change what the gate measures while it is being run.

## 3. Flow

```
/api/book ── triggerForBooking(booking, { bookingId }) ── run()
   └─ appendToPortal → addHomework({ bookingId, heldUntil: end + 24h })

POST /api/reports ── fileReport() (unchanged, one transaction)
   └─ afterReport(bookingId)       ← new, not awaited
        held rows for bookingId?  no  → nothing (D4)
        entries?                  no  → release (D3)
        generate from covered skills + note
           ok   → replace held rows (one transaction)
           fail → release held rows, WhatsApp the tutor
```

Release = `UPDATE homework SET held_until = NULL WHERE booking_id = ? AND held_until IS NOT NULL`.
Visible = `held_until IS NULL OR held_until <= now`.

## 4. Schema

Migration 018 (`homework_held`): `ALTER TABLE homework ADD COLUMN
booking_id INTEGER`, `ADD COLUMN held_until TEXT`. Existing rows get NULL
for both, which means visible and not tied to a booking. That is exactly
their current behaviour. `storage-inventory.ts` needs no change: the
table's status stays live.

## 5. Testing

- `lessons.ts`: held rows are hidden from the default read and shown
  with `includeHeld`, and become visible at `held_until` without any job.
- `homework.ts` (stub agent): the prompt carries the covered skills, and
  the fenced note; a `skillKey` outside the covered set is dropped; at
  most 5 tasks.
- `afterReport`: replace on success; release on failure, with a tutor
  message; release on note-only; nothing when already released.
- `lesson-reaches-student`: booking-time homework is written held, with
  the booking id.
- Characterization: book → the portal shows no homework → file a report
  with entries → the portal shows the taught homework.

## 6. Not in scope

- Games from what was taught. Games stay with the lesson, and their
  results already tie to a skill via `game_skills`.
- Preparing material the student has not been taught yet (the task's
  «כהכנה בלבד» option). That is a tutor action with no UI yet.
- Changing the PRODUCT.md metric note. It still reads right: homework
  generated after the lesson is generated for that lesson.
