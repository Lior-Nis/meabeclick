# Design — The end-of-lesson report

Date: 2026-09-13
Todoist: "לעדכן התקדמות ותכנית למידה מתוך דיווח מורה וראיות תרגול" (P2), and the
report half of "לאפיין תכנית למידה היררכית" (P1)
Builds on: [`2026-09-12-learning-plan-design.md`](2026-09-12-learning-plan-design.md) — spec 2 of the 5-spec decomposition recorded there (§1.1)

## 1. Context

Spec 1 shipped the learning plan: a per-student skill tree the tutor marks by
hand, with every change appended to `plan_events` and current status derived
from that log. It left the tree moving only when she opens the plan page and
edits it. This spec is what makes the tree move as a by-product of teaching.

What exists to build on:

- `plans`, `plan_nodes`, `plan_prereqs`, `plan_events` (migration 004), the pure
  `plans/view.ts`, `plans/store.ts`, and the tutor-only plan API and page.
- `bookings_v2` — `student_id`, `enrollment_id`, `start`, `"end"`, `status`
  (`'confirmed'` by default). A lesson's identity is its booking.
- `email.ts` — `sendBookingEmail`, `sendFamilyBookingEmail`,
  `sendPortalLinkEmail`, all through Gmail, with the tutor's own mailbox at
  `BOOKING_EMAIL_TO` (default `mea.beclick@gmail.com`).
- A 30-day tutor session (`maab_session`), password-only sign-in.

### 1.1 Three things that do not exist, and one that is broken

1. **No end-of-lesson report of any kind.** The Todoist task speaks of "דיווח
   השיעור שהמורה ממלאת בעקבות המייל של מאה בקליק" as though both the report and
   the email existed. Neither does.
2. **No scheduler.** The only timer on the box is
   `meabeclick-backup.timer`. There is no cron, no worker, no queue.
3. **`/api/remind` is dead code.** It sends the Saturday booking-window reminder
   over WhatsApp and nothing has called it since the Vercel cron was deleted —
   `server/README.md` says so in as many words and leaves wiring it up as an
   open question.
4. **Sign-in always lands on the dashboard.** `src/routes/login/+page.svelte`
   sets `location.href = '/app/dashboard'` unconditionally, so a lapsed session
   swallows whatever page the tutor was trying to reach.

### 1.2 The north-star constraint, again

PRODUCT.md: a feature that adds a manual step for Nikol is a net loss. A report
IS a manual step, so its whole design is about being smaller than what it
replaces: it must take a handful of taps, arrive where she already is, and move
the plan so she never edits the tree by hand afterwards.

## 2. Scope

**In.** A report per lesson: which skills were covered and at what status, plus
an optional note. A dashboard queue of lessons awaiting one. An email per
finished lesson. The scheduling mechanism both need, and the revival of
`/api/remind` on it. The login return path.

**Out.** Anything a machine concludes (that is spec 3: evidence from games and
homework, which arrives as drafts for approval). Next-lesson generation
(spec 4). The materials library (spec 5). Anything shown to a family — a report
is tutor-only, like the plan it writes to.

## 3. Decisions

| Decision | Chosen | Why |
|---|---|---|
| How she is prompted | Dashboard queue **and** an email per lesson | The queue works the moment it deploys and needs no infrastructure; the email reaches her without opening the dashboard |
| What the form asks | Skill picks from her own plan, plus an optional note | Deterministic, no generation cost, three or four taps for a normal lesson |
| How the email's link authenticates | A plain link; her 30-day session carries her, or one password screen returns her to the same form | No credential travels in an email, and the common case is frictionless |
| Whether her picks are drafts | No — written directly, `source = 'report'` | Drafts are for machine conclusions. Her judgement is the authority the plan records |
| What a correction does | Appends | The plan's whole design is an append-only log; a correction is what she thinks now, not a rewrite of what she thought then |

## 4. Schema

Migration 005 does three things.

**A report per lesson:**

```sql
CREATE TABLE lesson_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER NOT NULL UNIQUE REFERENCES bookings_v2(id),
  student_id    INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(id),
  note          TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
```

`booking_id` is UNIQUE: a lesson is reported once, and a correction updates that
row rather than adding another. The note's history lives in `plan_events`, not
in versions of this row.

**A record of what has been emailed:**

```sql
CREATE TABLE report_prompts (
  booking_id INTEGER PRIMARY KEY REFERENCES bookings_v2(id),
  sent_at    TEXT    NOT NULL
);
```

Separate from `lesson_reports` because the queue is defined by the *absence* of
a report (§5); a prompt must not create one. A row here means "she has been
emailed about this lesson", and its absence means she has not.

**A third event source, and a link back to the lesson.**
`plan_events.source` is CHECKed to `'teacher'` alone, and SQLite cannot alter a
CHECK in place, so the table is rebuilt with `CHECK (source IN ('teacher',
'report'))` — and since it is being rebuilt anyway, the rebuild is also where
`report_id INTEGER REFERENCES lesson_reports(id)` arrives, rather than a
separate `ALTER TABLE` afterwards. That column is what lets the log say which
lesson moved a skill.

The rebuild follows migration 003's precedent and is safe for the same stated
reason 003 gave: nothing references `plan_events`, so dropping and recreating it
orphans no child rows. **003's warning applies here too** — that procedure is
not a template for rebuilding a table that IS referenced. The migration carries
that reasoning, its INSERT lists columns explicitly rather than `SELECT *`, and
a test proves existing events survive with their values intact.

## 5. The queue

A lesson is **awaiting a report** when all of these hold:

- its booking is `status = 'confirmed'`;
- its `"end"` is in the past;
- no `lesson_reports` row names it.

That is one query over existing tables and one new one. The queue holds no
state of its own, so it cannot drift: filing a report removes the lesson from
it, and cancelling a booking removes it too.

The dashboard renders it as a banner near the top, newest first, in the same
place the calendar-failure banner already lives:

```
⚠ 2 שיעורים מחכים לדיווח
   יובל כהן · מתמטיקה · אתמול 17:00      [דיווח]
   נועה לוי · מתמטיקה · אתמול 18:30      [דיווח]
```

Lessons older than 14 days drop off the banner (they stay reportable by URL) —
a queue that only grows is one she learns to ignore.

## 6. The form

Route `/app/report/<booking id>`, tutor session required.

```
← לוח בקרה
דיווח שיעור · יובל כהן · מתמטיקה
שלישי 12.06 · 17:00–18:30

מה עברתם?
  ☑ כלל המנה            [בתרגול מודרך ▾]
  ☑ נגזרת שורש          [בוצע עם עזרה ▾]
  ☐ נקודות קיצון
  ☐ חוקי חזקות
  + חפשו יכולת אחרת בתכנית

הערה (רשות)
[ נתקעה בשברים, כדאי לחזור על זה בשיעור הבא        ]

[            שליחת הדיווח            ]
```

- **What is offered first**: the skills the plan flags `recommended`, then those
  in progress (`guided`, `with_help`, `started`, `needs_review`), in that order.
  Everything else in the plan is behind the search line. This reuses
  `buildTree`'s existing flags rather than recomputing anything.
- **Nothing is pre-ticked.** Ticking is her act.
- **A ticked skill's status starts empty** and submit stays disabled until every
  ticked skill has one, so a hurried submit cannot record "no change" as though
  it were a judgement.
- **A note-only report is valid.** Some lessons produce no skill-level claim,
  and recording that the lesson happened is still worth having.
- **Corrections**: if the lesson already has a report, the form opens showing
  what was filed and the button reads «תיקון הדיווח». Filing again appends new
  events; nothing is deleted or rewritten.
- **No plan for that subject yet**: the form says so and offers to create one
  from a matching template, rather than rendering an empty list.
- **After submitting**, she lands on that student's plan page with the
  "שונה מאז השיעור" filter active, so the first thing she sees is what her
  report moved.

Phone-first, RTL, 320px, 44px controls, tokens only — the same bar as the plan
page.

## 7. The email

One per finished lesson, to `BOOKING_EMAIL_TO` (her own mailbox, the same one
booking notifications already reach):

```
נושא: שיעור עם יובל הסתיים — דיווח קצר?

יובל כהן · מתמטיקה · שלישי 12.06, 17:00–18:30
מומלץ לתרגול עכשיו: כלל המנה, נגזרת שורש

[ לדיווח השיעור ]   → https://meabeclick.com/app/report/<id>

אם כבר דיווחת, אפשר להתעלם מההודעה.
```

Naming the two recommended skills means the email is useful even unopened. The
link is plain: her session carries her in, or she signs in once and is returned
to that form (§9).

## 8. Scheduling

A `systemd --user` timer, built exactly like the existing backup timer and
documented beside it:

```
server/meabeclick-report-prompt.service   # curl -sS -X POST -H "X-Cron-Key: $CRON_KEY" http://127.0.0.1:3000/api/reports/prompt
server/meabeclick-report-prompt.timer     # hourly
server/meabeclick-remind.service          # the same, against /api/remind
server/meabeclick-remind.timer            # Saturdays
```

`CRON_KEY` is a new environment variable (`.env.example`, `docker-compose.yml`,
and the README's variable table). The endpoints compare it in constant time and
answer 401 otherwise; they are reachable from the internet, so a session check
is not available to them and a secret is.

Reviving `/api/remind` here is deliberate: it is two files and closes an open
question `server/README.md` has been carrying, and it proves the timer
mechanism on a second, simpler consumer.

**Prompt selection.** A lesson is emailed when it is awaiting a report (§5), its
end is more than 30 minutes ago (so an overrunning lesson is not chased), less
than 3 days ago, and it has no `report_prompts` row. The row is written after a
successful send, so a failed send retries next hour and an aged-out lesson stops
being chased. A second run inside the same hour sends nothing.

## 9. API, authorization, errors

```
POST /api/reports         tutor-only
  { bookingId, note?, entries: [{ nodeId, status }] }
  → { report, plan, tree, events }

POST /api/reports/prompt  secret-only
  → { considered, emailed, skipped }
```

Filing writes the `lesson_reports` row and every event in one transaction: a
lesson can never be marked reported without its events, or the reverse.

| Case | Status |
|---|---|
| Booking not found, or a node outside this booking's plan | 404, identical body |
| Booking has not ended yet | 400 |
| Booking is cancelled | 400 |
| Unknown status, note over 2000 chars, malformed entry | 400 |
| A ticked entry with no status | 400 |
| `/api/reports/prompt` without the key, or with a wrong one | 401 |

**Authorization.** `apiAuthDenied` on `/api/reports`, `requireAuth` on the page,
so anonymous callers and family sessions get 401 and 302 respectively. Nothing
from a report appears in `/api/portal`, `/app/parent` or `/app/student`.

**The login return path.** `requireAuth` redirects to `/login?next=<path>` for
page routes, and the login page sends the browser to that path on success,
accepting only same-origin absolute paths beginning with a single `/` — an
open-redirect here would be a phishing hop from the tutor's own inbox.

## 10. What this does not decide

- **Anything a machine concludes.** Game results and homework remain unlinked to
  skills until spec 3, and when they arrive they are drafts she approves, with
  their own `source` values.
- **What a family ever sees of a report.** Nothing, in this spec.
- **Whether the report should ask about homework set for next time.** It is the
  obvious next field, and it belongs with spec 4 (next-lesson generation), which
  is what would consume it.
- **A second delivery channel.** WhatsApp is how she is reminded on Saturdays,
  but the report prompt is email-only until email proves insufficient.

## 11. Testing

**Unit.** The queue query (a past confirmed booking with no report appears;
future, cancelled and already-reported ones do not; the 14-day cutoff). Prompt
selection (the 30-minute and 3-day windows, the already-prompted exclusion).
The filing transaction (report row and events together; a failure leaves
neither; a correction appends rather than replaces). Migration 005 (the three
changes apply; existing `plan_events` rows survive the rebuild with their
values intact; `source = 'report'` is accepted and an unknown source still
rejected).

**Characterization.** The page guard; `/api/reports` tutor-only for anonymous
and family callers; an entry naming a node in another student's plan refused; a
future booking refused; a note-only report accepted; a correction appending; the
prompt endpoint answering 401 without the key, sending once with it, and
sending nothing on an immediate second call; a reported lesson leaving the
queue; no report data on any family route; `/login?next=` returning to the
requested page and refusing an off-site target.

**Deploy config.** A unit test pins the new service and timer files the way
`tests/unit/deploy-config.test.mjs` already pins the deployment shape: the units
exist, reference the right endpoints, and carry the key header.

**Browser.** The form at 320/390/430/1280: tick, set statuses, submit, land on
the filtered plan page; the queue banner and its links; a correction.

## 12. Consequences

- The plan updates as a by-product of teaching, which is what makes spec 1 worth
  having.
- The box gains a scheduling mechanism it has never had, with two consumers on
  day one, and `server/README.md`'s open question closes.
- `plan_events` gains its second source and its first link to the lesson that
  caused a change, which is the shape spec 3's evidence and spec 4's generation
  both need.
- A lesson now has a record of what happened in it, which is the input
  next-lesson generation has been missing.
