/**
 * Lessons and homework.
 *
 * One lessons table holds both halves of a lesson: the generator fills
 * title/context/slides/status, the tutor fills summary, and either may be
 * empty. They describe the same event, and keeping them apart is what
 * produced two sources of truth (the lessons table and portal/<code>.json).
 */
import { randomBytes } from 'node:crypto';
import { handle, inTransaction } from './db.ts';

export type LessonRow = {
  id: number; student_id: number; enrollment_id: number | null;
  teacher_id: number | null; slug: string; topic: string | null;
  title: string | null; context: string | null; summary: string | null;
  status: string; problem: string | null; slides_path: string | null;
  lesson_at: string | null; created_at: string;
};
export type HomeworkGrade = 'ok' | 'partial' | 'redo';
export const HOMEWORK_GRADES: HomeworkGrade[] = ['ok', 'partial', 'redo'];

export type HomeworkRow = {
  id: number; lesson_id: number | null; student_id: number; task: string;
  template: string | null; data_id: string | null;
  assigned_at: string; due_at: string | null;
  submitted_at: string | null; submitted_by: string | null;
  graded_at: string | null; grade: HomeworkGrade | null; graded_by: string | null;
  node_id: number | null;
  /** Which lesson's homework this is, and until when families do not see
   *  it — migration 018. Both NULL on every row older than it. */
  booking_id: number | null;
  held_until: string | null;
  /** The answer key, for the tutor only (migration 022). */
  answer: string | null;
};

// Crockford-ish base32 without vowels, so a token cannot spell a word and
// cannot collide with the /^[a-z0-9-]+$/ path-segment rule by construction.
// This replaces slugify(), whose \p{L} class passed Hebrew straight through
// and produced slugs that threw in assertPathSegment — every generated
// lesson 404'd.
const ALPHABET = '0123456789bcdfghjkmnpqrstvwxyz';

export function newLessonSlug(): string {
  const bytes = randomBytes(10);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

export function createLesson(l: {
  slug: string; studentId: number; enrollmentId?: number | null;
  teacherId?: number | null; topic?: string | null; lessonAt?: string | null;
}): number {
  const info = handle().prepare(`
    INSERT INTO lessons_v2
      (slug, student_id, enrollment_id, teacher_id, topic, status, lesson_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'generating', ?, ?)
  `).run(l.slug, l.studentId, l.enrollmentId ?? null, l.teacherId ?? null,
         l.topic ?? null, l.lessonAt ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

export function finishLesson(slug: string, f: {
  status: string; title?: string | null; context?: string | null;
  summary?: string | null; slidesPath?: string | null; problem?: string | null;
}): void {
  handle().prepare(`
    UPDATE lessons_v2 SET
      status = ?, title = COALESCE(?, title), context = COALESCE(?, context),
      summary = COALESCE(?, summary), slides_path = COALESCE(?, slides_path),
      -- \`problem\` is assigned, NOT COALESCE'd like the fields above it, and that
      -- asymmetry is deliberate: it records why a lesson was held or failed, so a
      -- later successful finish must clear it. COALESCE here would leave a stale
      -- failure message rendered beside a working lesson for good.
      problem = ?
    WHERE slug = ?
  `).run(f.status, f.title ?? null, f.context ?? null, f.summary ?? null,
         f.slidesPath ?? null, f.problem ?? null, slug);
}

/** The columns a caller needs from a generated lesson, whichever table it
 *  is currently stored in. */
export type LessonForStudent = {
  id: number; slug: string; title: string | null; topic: string | null;
  status: string; lesson_at: string | null;
};

/**
 * This student's generated lessons, from the table generation actually
 * writes.
 *
 * This used to read lessons_v2, which no production code has ever written
 * to — generation uses db.ts against the legacy `lessons`. So it answered
 * an empty list for every student, and an empty list reads as "no lessons
 * yet" rather than as a bug. The tutor's student card showed nothing while
 * four finished lessons sat in the database.
 *
 * The legacy table keys a lesson to a student by display NAME, which is not
 * safe to match on: production holds two different students called נוגה on
 * different accounts, so a name join would show one family another's
 * lessons. The booking is the unambiguous link — bookings_v2 carries
 * student_id, and a generated lesson carries the booked time it was
 * generated for.
 *
 * Lessons from before bookings_v2 have no row to join to and are not
 * returned. That is the honest outcome: there is no way to attribute them
 * to a student that is not a guess, and guessing here attributes one
 * child's work to another.
 *
 * See src/lib/server/storage-inventory.ts for why this reads `lessons` and
 * not the table that looks newer.
 */
export function lessonsForStudent(studentId: number): LessonForStudent[] {
  return handle().prepare(`
    SELECT l.id, l.slug, l.title, l.topic, l.status, l.lesson_at
    FROM lessons l
    JOIN bookings_v2 b ON b.start = l.lesson_at
    WHERE b.student_id = ?
    ORDER BY l.lesson_at DESC
  `).all(studentId) as LessonForStudent[];
}

export function addHomework(h: {
  lessonId?: number | null; studentId: number; task: string;
  template?: string | null; dataId?: string | null; dueAt?: string | null;
  /** The plan skill this task practises, when the lesson targeted one.
   *  Null means "not evidence about any skill" — see
   *  lesson/targeting.ts and migration 014. */
  nodeId?: number | null;
  /** Booking-time homework: the lesson it is for, and when it shows up if
   *  no report replaces it first. See migration 018. */
  bookingId?: number | null;
  heldUntil?: string | null;
  /** The answer key — the tutor's, never shown to the family. */
  answer?: string | null;
}): number {
  /* No submission and no grade: a task starts life as neither finished nor
     judged, which is the only honest state for work nobody has done yet. */
  const info = handle().prepare(`
    INSERT INTO homework (lesson_id, student_id, task, template, data_id, assigned_at, due_at, node_id,
                          booking_id, held_until, answer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(h.lessonId ?? null, h.studentId, h.task, h.template ?? null,
         h.dataId ?? null, new Date().toISOString(), h.dueAt ?? null,
         h.nodeId ?? null, h.bookingId ?? null, h.heldUntil ?? null, h.answer ?? null);
  return Number(info.lastInsertRowid);
}

/**
 * Stage one: the student says they finished it.
 *
 * `by` records who pressed it, because the tutor will often do it on the
 * child's behalf — "she told me she did it" — and that is a different
 * statement from the child saying so themselves.
 *
 * Reversible. A child who taps it by accident has to be able to take it
 * back, and a submission is not a judgement, so nothing is lost by undoing
 * one.
 */
export function setHomeworkSubmitted(
  id: number, submitted: boolean, by: 'student' | 'teacher',
): void {
  handle().prepare(
    `UPDATE homework SET submitted_at = ?, submitted_by = ? WHERE id = ?`
  ).run(submitted ? new Date().toISOString() : null, submitted ? by : null, id);
}

/**
 * Stage two: someone judged it.
 *
 * `by` is 'teacher' today and exists so a machine can fill this in later
 * without a schema change — and so the difference stays visible afterwards.
 * A mark the tutor gave and a mark a program produced are not the same
 * claim, and a parent is entitled to tell them apart.
 *
 * Grading also records the submission if nobody did, because a tutor who
 * has looked at the work has established the stronger fact: it exists.
 */
export function gradeHomework(
  id: number, grade: HomeworkGrade | null, by: 'teacher' | 'auto' = 'teacher',
): void {
  const db = handle();
  const at = new Date().toISOString();
  if (grade === null) {
    db.prepare(`UPDATE homework SET graded_at = NULL, grade = NULL, graded_by = NULL WHERE id = ?`).run(id);
    return;
  }
  db.prepare(`
    UPDATE homework
       SET graded_at = ?, grade = ?, graded_by = ?,
           submitted_at = COALESCE(submitted_at, ?),
           submitted_by = COALESCE(submitted_by, ?)
     WHERE id = ?
  `).run(at, grade, by, at, by === 'auto' ? 'student' : 'teacher', id);
}

export function deleteHomework(id: number): void {
  handle().prepare(`DELETE FROM homework WHERE id = ?`).run(id);
}

/**
 * Homework with both stages resolved.
 *
 * A game-backed task needs no button: **playing it IS the submission.** The
 * child did the thing that was asked, and the system watched them do it. It
 * is emphatically NOT a grade — the score is right there in results_v2 and
 * nobody has looked at it, which is exactly what automatic grading would
 * read later.
 *
 * The result must belong to the SAME student: data_id is shared across every
 * child assigned the same game, so matching on data_id alone would let one
 * child's play submit another's homework.
 *
 * Written work has no result to derive from and is submitted by hand, which
 * is what setHomeworkSubmitted exists for.
 */
export function homeworkForStudent(
  studentId: number,
  /** Held rows are the tutor's to see, never a family's (spec D6): every
   *  family-facing caller takes the default. */
  opts: { includeHeld?: boolean; now?: string } = {},
): (HomeworkRow & {
  submitted: boolean; graded: boolean;
  /** The skill it practises, by name: the task's own skill, else its
   *  game's (game_skills). Null when neither is linked, or when the tutor
   *  hid that skill from the plan. */
  skill: string | null;
})[] {
  const rows = handle().prepare(`
    SELECT h.*,
           (h.submitted_at IS NOT NULL OR EXISTS (
              SELECT 1 FROM results_v2 r
              WHERE r.student_id = h.student_id
                AND h.data_id IS NOT NULL
                AND r.data_id = h.data_id
           )) AS submitted_flag,
           (SELECT pn.title FROM plan_nodes pn
             WHERE pn.visibility != 'hidden'
               AND pn.id = COALESCE(h.node_id, (
                 SELECT gs.node_id FROM game_skills gs
                  WHERE gs.student_id = h.student_id AND gs.data_id = h.data_id
               ))
           ) AS skill
    FROM homework h
    WHERE h.student_id = ?
      AND (? OR h.held_until IS NULL OR h.held_until <= ?)
    ORDER BY h.assigned_at DESC
  `).all(studentId, opts.includeHeld ? 1 : 0, opts.now ?? new Date().toISOString()) as (HomeworkRow & { submitted_flag: number; skill: string | null })[];

  return rows.map(({ submitted_flag, ...row }) => ({
    ...row,
    submitted: submitted_flag === 1,
    graded: row.graded_at !== null,
  }));
}

/** What the tutor has to look at: finished by the student, not yet judged. */
export function homeworkAwaitingGrade(studentId: number): HomeworkRow[] {
  return homeworkForStudent(studentId).filter(h => h.submitted && !h.graded);
}

/** A lesson's homework that is still held at `now` — the rows a report
 *  may release or replace. Empty once they have gone out, which is what
 *  makes a late or repeated report a no-op (spec D3, D4). */
export function heldHomeworkForBooking(bookingId: number, now: string = new Date().toISOString()): HomeworkRow[] {
  return handle().prepare(
    `SELECT * FROM homework WHERE booking_id = ? AND held_until IS NOT NULL AND held_until > ? ORDER BY id`
  ).all(bookingId, now) as HomeworkRow[];
}

/** Shows a lesson's held homework now. Returns how many rows went out. */
export function releaseHeld(bookingId: number): number {
  const info = handle().prepare(
    `UPDATE homework SET held_until = NULL WHERE booking_id = ? AND held_until IS NOT NULL`
  ).run(bookingId);
  return Number(info.changes);
}

/**
 * Swaps a lesson's held homework for homework from what was taught.
 *
 * Re-checks "still held" INSIDE the transaction and returns false, writing
 * nothing, when no row is. The caller decided to replace minutes earlier,
 * before a generation run; by now a second filing may have replaced it
 * already, a note-only filing may have released it, or the 24h fallback
 * may have shown it to the family — and a child may have handed it in.
 * Deleting then would drop visible work; inserting would add a second set.
 *
 * One transaction: a failure part way leaves the held rows exactly as they
 * were, so the fallback still delivers them.
 */
export function replaceHeld(
  bookingId: number, studentId: number, tasks: { task: string; nodeId: number | null; answer?: string | null }[],
  now: string = new Date().toISOString(),
): boolean {
  return inTransaction(() => {
    const removed = handle().prepare(
      `DELETE FROM homework WHERE booking_id = ? AND held_until IS NOT NULL AND held_until > ?`
    ).run(bookingId, now);
    if (Number(removed.changes) === 0) return false;
    for (const t of tasks) addHomework({ studentId, task: t.task, nodeId: t.nodeId, bookingId, answer: t.answer ?? null });
    return true;
  });
}

/**
 * A student's lessons that belong to them UNAMBIGUOUSLY — for anything that
 * copies a lesson somewhere per student (the Drive sync).
 *
 * lessonsForStudent joins on bookings_v2.start, the only link a lesson row
 * has to a student, and counts cancelled bookings too: a slot one student
 * cancelled and another re-booked matches both, and a per-student copy
 * would land in the wrong family's folder. Here a lesson needs a live
 * booking of THIS student at its time and no live booking of anyone else.
 */
export function unambiguousLessonsForStudent(studentId: number): LessonForStudent[] {
  return handle().prepare(`
    SELECT l.id, l.slug, l.title, l.topic, l.status, l.lesson_at
    FROM lessons l
    WHERE EXISTS (SELECT 1 FROM bookings_v2 b
                  WHERE b.start = l.lesson_at AND b.student_id = ? AND b.status != 'cancelled')
      AND (SELECT count(DISTINCT b.student_id) FROM bookings_v2 b
           WHERE b.start = l.lesson_at AND b.status != 'cancelled') = 1
    ORDER BY l.lesson_at DESC
  `).all(studentId) as LessonForStudent[];
}
