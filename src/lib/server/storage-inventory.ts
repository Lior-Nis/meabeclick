/**
 * Every table this app has, and what it is FOR right now.
 *
 * ## Why a list exists at all
 *
 * The move to the entity model (`*_v2`) was done table by table and never
 * finished, so "which table is the real one" became a per-table fact that
 * lived only in people's heads. Three separate production bugs in two days
 * came from reading the wrong half of a pair, each one silent:
 *
 *   #81  appendToPortal looked students up in `students` (3 rows) instead of
 *        `students_v2` (7), so every lesson generated since the migration
 *        reached nobody's page.
 *   #86  generated homework went to the portal file while typed homework
 *        went to the `homework` table, so neither side saw the other's.
 *   —    /api/students/<code>/activity reads lessons from `lessons_v2`,
 *        which has never been written to outside tests, so the tutor's card
 *        lists zero lessons however many exist.
 *
 * None of those failed loudly. Each returned an empty result, which looks
 * exactly like "there is nothing here".
 *
 * This list is the antidote: one place that states the status of every
 * table, checked by a test against the migrations, so adding a table forces
 * a decision and retiring one cannot be half-done in silence.
 */

/**
 * The statuses, chosen around the failure they exist to prevent.
 *
 * Every one of the bugs above was a READ of a table nothing writes. That
 * returns an empty list, which is indistinguishable from "there is nothing
 * here" — so it is the read, not the write, that has to be policed.
 */
export type TableStatus =
  /** Written and read today. */
  | 'live'
  /** Superseded. Still READ so old rows stay visible, never written again.
   *  Carries the condition under which the read can stop. */
  | 'draining'
  /** Schema and code exist, nothing in production writes it yet. Reading it
   *  is FORBIDDEN: it answers empty, and empty looks like no data. */
  | 'unadopted'
  /** Referenced by nothing at all. Neither read nor written. */
  | 'dead';

export interface TableFact {
  status: TableStatus;
  /** What it holds, and for 'draining'/'dead', what has to be true to move
   *  on from it. One sentence — this is a map, not documentation. */
  note: string;
}

export const STORAGE: Record<string, TableFact> = {
  // ── The entity model, which is where new work belongs ──────────────
  accounts:      { status: 'live', note: 'The billing/login family.' },
  students_v2:   { status: 'live', note: 'The student. Keyed by id; `code` is the URL slug.' },
  teachers:      { status: 'live', note: 'Who teaches. One row in practice.' },
  enrollments:   { status: 'live', note: 'A student in a subject. UNIQUE per (student, subject).' },
  bookings_v2:   { status: 'live', note: 'A booked hour, keyed on student_id.' },
  pending_bookings: { status: 'live', note: 'A booking with a known family\'s email, held until that family confirms it (migration 021).' },
  payments:      { status: 'live', note: 'Charges in integer agorot. Manual marking, no auto-billing.' },
  homework:      { status: 'live', note: 'One store for both sides since #86; `done` derives from results_v2.' },
  results_v2:    { status: 'live', note: 'A game play, keyed on student_id.' },
  join_codes:    { status: 'live', note: 'A child\'s own way in, minted by the parent.' },
  calendar_failures: {
    status: 'live',
    note: 'Calendar writes that failed, surfaced on the dashboard. Written by '
        + 'db.ts flagCalendarFailure() from /api/book and read by '
        + '/api/calendar-failures. calendar_failures_v2 was meant to replace it '
        + 'and never did, so this is the one live table.',
  },

  // ── Learning plans ────────────────────────────────────────────────
  plans:              { status: 'live', note: 'One plan per enrollment, from a template.' },
  plan_nodes:         { status: 'live', note: 'Topics, branches and skills.' },
  plan_prereqs:       { status: 'live', note: 'Which skill needs which.' },
  plan_events:        { status: 'live', note: 'Append-only history: status, coverage, corrections (#85).' },
  lesson_reminders:   { status: 'live', note: 'One row per reminder attempted; UNIQUE (booking, kind) IS the idempotency guarantee.' },
  game_skills:        { status: 'live', note: 'Which skill a published game practises, per (student, data_id) — the link results_v2 needs to become evidence.' },
  lesson_reports:     { status: 'live', note: 'The tutor\'s end-of-lesson report.' },
  lesson_report_notes:{ status: 'live', note: 'Free text attached to a report.' },
  report_prompts:     { status: 'live', note: 'Which lessons have already been chased. INSERT OR IGNORE.' },
  lesson_requests:    { status: 'live', note: 'What a parent asked for with a booking.' },
  lesson_materials:   { status: 'live', note: 'Versioned teaching material, drafts vs published (#88).' },
  drive_items:        { status: 'live', note: 'Which Drive file is which, and what it last held — ids and sync bookkeeping only (migration 019).' },

  // ── Generation ────────────────────────────────────────────────────
  lessons: {
    status: 'live',
    note: 'The generated lesson. Keyed on student NAME, which is why two '
        + 'students called נוגה are a real hazard here — see lessons_v2.',
  },
  lessons_v2: {
    status: 'unadopted',
    note: 'The shape lessons SHOULD have — student_id, enrollment_id — and '
        + 'homework.lesson_id already points at it. Nothing in production '
        + 'has ever written a row: its createLesson/finishLesson are called '
        + 'only from tests, while generation uses db.ts against `lessons`. '
        + 'Adopting it is Todoist id:6hXqpJ2w7qfJ7P9q. Until then it must '
        + 'not be READ: an endpoint that did returned an empty lesson list '
        + 'for every student, which reads as "no lessons yet".',
  },

  // ── Draining: read so old rows stay visible; no new writer may appear.
  //    db.ts's own legacy writers are the one exception, and each entry
  //    below says whether it still has one. ─────────────────────────────
  students: {
    status: 'draining',
    note: 'Pre-entity students. Read only through db.ts\'s legacy helpers. '
        + 'Done when nothing imports those.',
  },
  bookings: {
    status: 'draining',
    note: 'Pre-entity bookings, unioned into the overlap check so an old '
        + 'hour still blocks its slot. Measured 2026-09-22: zero rows with '
        + 'start in the future, so the union\'s legacy half can go.',
  },
  results: {
    status: 'draining',
    note: 'Plays that could not be attributed to a student id. It still receives '
        + 'new rows: /api/game-result calls db.ts writeResult() whenever '
        + 'resolveStudent() finds no student, so this drains only once every play '
        + 'can be attributed. Migration 008 MOVED rows rather than copying, so the '
        + 'union with results_v2 cannot double-count.',
  },

  // ── Dead ──────────────────────────────────────────────────────────
  calendar_failures_v2: {
    status: 'dead',
    note: 'Created by migration 001 and referenced by no code at all — not '
        + 'read, not written, not in a test. The live table is '
        + 'calendar_failures.',
  },

  // ── Marketing funnel (migration 016) ─────────────────────────────
  marketing_events: {
    status: 'live',
    note: 'A visit, click or booking step. Anonymous until a booking links visitor_id '
        + 'to it; no name/phone/email/IP/message column exists to write one in regardless. '
        + 'Raw events are deleted after 365 days.',
  },

  // ── Bookkeeping ───────────────────────────────────────────────────
  schema_version: { status: 'live', note: 'Which migrations have run.' },
};
