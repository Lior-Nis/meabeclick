#!/usr/bin/env node
/**
 * Unlink homework that was pointed at a game it has nothing to do with.
 *
 *   node scripts/repair-homework-game-links.mjs            # dry run
 *   node scripts/repair-homework-game-links.mjs --apply    # writes
 *
 * ## What went wrong
 *
 * appendToPortal() gave every generated task the FIRST game of its lesson,
 * whatever the task said. So a written exercise — "פתרי: e^{4x}=11." — was
 * recorded as completable by finishing a matching game, and four such tasks
 * all pointed at the same one. Finishing a different game of the same lesson
 * ticked nothing; finishing that one would have ticked all four at once.
 *
 * ## Why this is not a blanket null
 *
 * The LEGACY generator got it right. Its homework items WERE games — "משחק
 * זיכרון — נוסחאות אינטגרלים", "ציד טעויות — נגזרות" — one task per game,
 * each with its own id. Nulling those would throw away a correct link and
 * a real completion record.
 *
 * The discriminator is siblings: one game cannot complete four different
 * written tasks, so a data_id shared by more than one of a student's
 * homework rows is the broken pattern. A 1:1 link is left exactly as it is.
 *
 * done_manual is never touched. If the tutor marked something done, she
 * meant it, and that is not this script's business.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const dataDir = process.env.DATA_DIR || './data';
const dbPath = process.env.DB_PATH || join(dataDir, 'results.db');
const db = new DatabaseSync(dbPath);

/** data_ids that more than one of the same student's rows point at. */
const shared = db.prepare(`
  SELECT student_id, data_id, count(*) AS n
  FROM homework
  WHERE data_id IS NOT NULL
  GROUP BY student_id, data_id
  HAVING n > 1
`).all();

const clear = db.prepare(
  `UPDATE homework SET data_id = NULL, template = NULL WHERE student_id = ? AND data_id = ?`
);

let rows = 0;
for (const g of shared) {
  const tasks = db.prepare(
    'SELECT task FROM homework WHERE student_id = ? AND data_id = ?'
  ).all(g.student_id, g.data_id);

  console.log(`${APPLY ? 'CLEAR' : 'PLAN '} student ${g.student_id}: ${g.n} tasks share ${g.data_id}`);
  for (const t of tasks) console.log(`         · ${t.task.slice(0, 56)}`);

  if (APPLY) clear.run(g.student_id, g.data_id);
  rows += g.n;
}

const kept = db.prepare(`
  SELECT count(*) AS c FROM homework WHERE data_id IS NOT NULL
`).get().c - (APPLY ? 0 : rows);
console.log(`\n${APPLY ? 'cleared' : 'would clear'} ${rows} row(s); ${kept} genuine 1:1 game link(s) left alone`);
if (!APPLY && rows) console.log('Re-run with --apply to write.');
