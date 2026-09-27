#!/usr/bin/env node
/**
 * Put already-generated lessons onto the student pages that never got them.
 *
 *   node scripts/backfill-portal-lessons.mjs            # dry run, prints a plan
 *   node scripts/backfill-portal-lessons.mjs --apply    # writes
 *
 * ## Why this exists
 *
 * appendToPortal() looked students up in the retired `students` table, so
 * every student enrolled after the students_v2 migration got nothing on
 * their page while the lesson generated fine, wrote its slides and game
 * data, and went `status: ready`. That is fixed, but the fix only helps the
 * NEXT lesson. The ones already paid for are still invisible.
 *
 * ## How a lesson is matched to a student
 *
 * Not by name. `lessons.student` is a display name, and production holds
 * two different students both named נוגה (codes `noga` and `kid-b`, different
 * accounts) — matching on it would put one family's lesson on another
 * family's page.
 *
 * The join is `bookings_v2.start = lessons.lesson_at`, which reaches
 * student_id directly. A lesson whose time matches no booking, or matches
 * more than one, is skipped and reported rather than guessed at.
 *
 * ## Safety
 *
 * Dry run by default. Idempotent: a lesson whose slug is already in the
 * portal file is skipped, so running twice cannot double-post. Only ever
 * adds — existing entries are kept, and the old {title,url} game shape is
 * left exactly as it is (see the normalizeGameLike comment in
 * src/routes/api/portal/[code]/+server.ts).
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const dataDir = process.env.DATA_DIR || './data';
const dbPath = process.env.DB_PATH || join(dataDir, 'results.db');
const portalDir = process.env.PORTAL_DIR || join(dataDir, 'portal');

const db = new DatabaseSync(dbPath, { readOnly: true });

/** Ready lessons, with the student the booking says they belong to. */
const rows = db.prepare(`
  SELECT l.id, l.slug, l.title, l.context, l.lesson_at, l.homework, l.games,
         (SELECT count(*) FROM bookings_v2 b WHERE b.start = l.lesson_at) AS matches,
         (SELECT s.code FROM bookings_v2 b JOIN students_v2 s ON s.id = b.student_id
           WHERE b.start = l.lesson_at LIMIT 1) AS code
  FROM lessons l
  WHERE l.status = 'ready'
  ORDER BY l.id
`).all();

const dateOf = (iso) => (iso || '').slice(0, 10);
let planned = 0, skipped = 0;

for (const r of rows) {
  const label = `lesson ${r.id} (${r.slug})`;

  if (r.matches !== 1 || !r.code) {
    console.log(`SKIP  ${label}: ${r.matches} bookings match lesson_at — will not guess`);
    skipped++;
    continue;
  }

  const file = join(portalDir, `${r.code}.json`);
  if (!existsSync(file)) {
    console.log(`SKIP  ${label}: no portal file for ${r.code}`);
    skipped++;
    continue;
  }

  const data = JSON.parse(readFileSync(file, 'utf8'));
  if ((data.lessons ?? []).some(l => l.slug === r.slug)) {
    console.log(`SKIP  ${label}: already on ${r.code}'s page`);
    skipped++;
    continue;
  }

  const games = JSON.parse(r.games || '[]');
  const homework = JSON.parse(r.homework || '[]');
  const when = dateOf(r.lesson_at);

  // Same shapes appendToPortal writes, with the LESSON's date rather than
  // today's — this is a repair, not a new lesson, and dating it now would
  // tell a family they were set homework today.
  data.games = [...games, ...(data.games ?? [])].slice(0, 20);
  data.homework = [
    ...homework.map(h => ({
      task: h.task, assigned: when, due: null, done: false,
      template: games[0]?.template, dataId: games[0]?.dataId,
    })),
    ...(data.homework ?? []),
  ].slice(0, 30);
  data.lessons = [
    { date: when, topic: r.title, summary: r.context, slug: r.slug },
    ...(data.lessons ?? []),
  ].slice(0, 20);
  data.updated = when;

  console.log(`${APPLY ? 'WRITE' : 'PLAN '} ${label} -> ${r.code}: `
    + `${homework.length} homework, ${games.length} games, dated ${when}`);
  if (APPLY) writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  planned++;
}

console.log(`\n${APPLY ? 'wrote' : 'would write'} ${planned}, skipped ${skipped}`);
if (!APPLY && planned) console.log('Re-run with --apply to write.');
