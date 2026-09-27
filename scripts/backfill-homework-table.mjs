#!/usr/bin/env node
/**
 * Move homework out of portal files and into the homework table.
 *
 *   node scripts/backfill-homework-table.mjs            # dry run
 *   node scripts/backfill-homework-table.mjs --apply    # writes
 *
 * ## Why
 *
 * Homework lived in two places and worked in neither: generated tasks were
 * written into the student's portal file, where the tutor could not see or
 * mark them, and tasks she typed went into the homework table, where the
 * student never saw them.
 *
 * The table is now the single source, and /api/portal reads it. It falls
 * back to the file only while the table holds nothing for a student —
 * which is what this script removes the need for. Run it, check the counts,
 * then the fallback can go.
 *
 * ## Safety
 *
 * Dry run by default. Idempotent: a task already in the table for that
 * student, with the same text, is skipped, so running twice cannot
 * duplicate. Only ever inserts — nothing in the portal files is edited or
 * deleted, so this is reversible by ignoring the rows it made.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const APPLY = process.argv.includes('--apply');
const dataDir = process.env.DATA_DIR || './data';
const dbPath = process.env.DB_PATH || join(dataDir, 'results.db');
const portalDir = process.env.PORTAL_DIR || join(dataDir, 'portal');

const db = new DatabaseSync(dbPath);
const studentByCode = db.prepare('SELECT id, code FROM students_v2 WHERE code = ?');
const existing = db.prepare('SELECT task FROM homework WHERE student_id = ?');
const insert = db.prepare(`
  INSERT INTO homework (lesson_id, student_id, task, template, data_id, assigned_at, due_at, submitted_at, submitted_by)
  VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let inserted = 0, skipped = 0, files = 0;

for (const file of readdirSync(portalDir).filter(f => f.endsWith('.json'))) {
  const code = file.replace(/\.json$/, '');
  const student = studentByCode.get(code);
  if (!student) {
    console.log(`SKIP  ${code}: no student with that code`);
    continue;
  }

  let data;
  try { data = JSON.parse(readFileSync(join(portalDir, file), 'utf8')); }
  catch { console.log(`SKIP  ${code}: unreadable portal file`); continue; }

  const tasks = Array.isArray(data.homework) ? data.homework : [];
  if (!tasks.length) continue;
  files++;

  const have = new Set(existing.all(student.id).map(r => r.task));

  for (const h of tasks) {
    const task = String(h?.task ?? '').trim();
    if (!task) { skipped++; continue; }
    if (have.has(task)) {
      console.log(`SKIP  ${code}: "${task.slice(0, 30)}…" already in the table`);
      skipped++;
      continue;
    }

    console.log(`${APPLY ? 'WRITE' : 'PLAN '} ${code}: "${task.slice(0, 40)}…"`);
    if (APPLY) {
      insert.run(
        student.id, task,
        h.template ?? null, h.dataId ?? null,
        // Keep the original dates: this is a move, not a new assignment.
        (h.assigned ? `${h.assigned}T00:00:00.000Z` : new Date().toISOString()),
        h.due ?? null,
        // A portal file's `done` meant "finished", never "judged" — so it
        // migrates to a submission, attributed to the tutor, who was the
        // only person who could set it. See migration 013.
        h.done ? (h.assigned ? `${h.assigned}T00:00:00.000Z` : new Date().toISOString()) : null,
        h.done ? 'teacher' : null,
      );
      have.add(task);
    }
    inserted++;
  }
}

console.log(`\n${APPLY ? 'inserted' : 'would insert'} ${inserted} from ${files} portal file(s), skipped ${skipped}`);
if (!APPLY && inserted) console.log('Re-run with --apply to write.');
