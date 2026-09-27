/**
 * Migration 013 — homework has two stages, not one boolean.
 *
 * "Done" was one column, `done_manual`, and only the tutor could set it —
 * the student page rendered the flag and offered no way to change it. So a
 * child who did the exercises had no way to say so, and the tutor had never
 * marked anything, which meant the homework list only ever grew.
 *
 * The two stages are different claims by different people:
 *
 *   submitted   the student says they finished it
 *   graded      someone looked at it and formed a judgement
 *
 * Collapsing them loses the distinction that matters to both: a child wants
 * credit for having done the work, and a tutor wants to know what is waiting
 * for her. One boolean cannot say "she did it and I have not looked yet",
 * which is the most common state homework is ever in.
 *
 * ## Grading is pluggable on purpose
 *
 * `graded_by` records who judged it — the tutor today, a machine later.
 * Automatic grading needs no schema change, only a new value, and the
 * distinction stays visible afterwards: a parent can tell a mark the tutor
 * gave from one a program did.
 *
 * A game-backed task needs no button at all. Playing it IS the submission,
 * and the score sitting in results_v2 is exactly what automatic grading
 * would read.
 *
 * ## What happens to done_manual
 *
 * It becomes `submitted_at`, not `graded_at`. Under the old model it only
 * ever meant "this is finished"; reading it as a grade would invent a
 * judgement nobody made.
 *
 * ## Why a rebuild
 *
 * Two of the new columns carry CHECK constraints, and the chance is taken to
 * drop the foreign key on `lesson_id`. It pointed at `lessons_v2`, which
 * nothing has ever written (see storage-inventory.ts), so the constraint
 * could only ever be satisfied by NULL — it did not protect the column, it
 * prevented the column from ever being used correctly.
 */
export const sql = `
CREATE TABLE homework_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  /* Plain column, deliberately not a foreign key: the table it used to
     reference is unadopted, so the constraint could only ever hold for
     NULL. */
  lesson_id    INTEGER,
  student_id   INTEGER NOT NULL REFERENCES students_v2(id),
  task         TEXT    NOT NULL,
  template     TEXT,
  data_id      TEXT,
  assigned_at  TEXT    NOT NULL,
  due_at       TEXT,

  /* Stage 1 — the student says they finished. NULL until they do. */
  submitted_at TEXT,
  submitted_by TEXT CHECK (submitted_by IN ('student', 'teacher')),

  /* Stage 2 — someone judged it. NULL until they do. */
  graded_at    TEXT,
  grade        TEXT CHECK (grade IN ('ok', 'partial', 'redo')),
  graded_by    TEXT CHECK (graded_by IN ('teacher', 'auto'))
);

/* done_manual meant "finished", never "judged", so it becomes a submission
   attributed to the tutor — she is who could set it. assigned_at is the only
   honest timestamp available for when. */
INSERT INTO homework_new
  (id, lesson_id, student_id, task, template, data_id, assigned_at, due_at,
   submitted_at, submitted_by)
SELECT id, lesson_id, student_id, task, template, data_id, assigned_at, due_at,
       CASE WHEN done_manual = 1 THEN assigned_at ELSE NULL END,
       CASE WHEN done_manual = 1 THEN 'teacher'   ELSE NULL END
FROM homework;

DROP TABLE homework;
ALTER TABLE homework_new RENAME TO homework;

CREATE INDEX idx_homework_student ON homework(student_id, assigned_at DESC);
/* "What is waiting for me to grade" is the tutor's whole question. */
CREATE INDEX idx_homework_awaiting ON homework(student_id, graded_at, submitted_at);
`;
