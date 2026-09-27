/**
 * The vision's targets (PRODUCT.md, "Vision") measured from tables that
 * already exist. Read-only: the script never writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.DB_PATH = join(await mkdtemp(join(tmpdir(), 'vision-')), 'results.db');
const { handle } = await import('../../src/lib/server/db.ts');   // builds legacy tables + runs migrations
handle();
const { measure } = await import('../../scripts/vision-metrics.mjs');

const NOW = new Date('2026-10-15T12:00:00Z');
const daysAgo = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const db = new DatabaseSync(process.env.DB_PATH);
db.exec(`
  INSERT INTO accounts (id, name, credential, created_at) VALUES (1, 'a', 'x', '${daysAgo(90)}');
  INSERT INTO students_v2 (id, code, name, account_id, credential, created_at) VALUES
    (1, 's1', 'one', 1, 'x', '${daysAgo(90)}'),
    (2, 's2', 'two', 1, 'x', '${daysAgo(90)}'),
    (3, 's3', 'three', 1, 'x', '${daysAgo(90)}'),
    (4, 's4', 'four', 1, 'x', '${daysAgo(90)}');
`);
const booking = db.prepare(
  `INSERT INTO bookings_v2 (student_id, start, "end", at, status) VALUES (?, ?, ?, ?, ?)`);
booking.run(1, daysAgo(3), daysAgo(3), daysAgo(10), 'confirmed');   // active
booking.run(1, daysAgo(10), daysAgo(10), daysAgo(20), 'confirmed'); // same student, counted once
booking.run(2, daysAgo(40), daysAgo(40), daysAgo(50), 'confirmed'); // too old
booking.run(3, daysAgo(2), daysAgo(2), daysAgo(9), 'cancelled');    // cancelled
booking.run(4, daysAgo(-2), daysAgo(-2), daysAgo(1), 'confirmed');  // future, not yet taught

const pay = db.prepare(`INSERT INTO payments
  (account_id, student_id, date, kind, amount_agorot, status) VALUES (1, 1, ?, 'double', ?, ?)`);
pay.run('2026-09-03', 21500, 'paid');
pay.run('2026-09-20', 21500, 'owed');
pay.run('2026-09-25', 12000, 'void');
pay.run('2026-10-01', 30000, 'paid'); // current month, excluded
pay.run('2026-08-31', 12000, 'paid'); // two months ago, excluded

/* Generation writes only the legacy `lessons` table; it never writes
   lesson_materials. A lesson_materials row appears only when the tutor
   edits (origin 'edited') or restores (origin 'restored') a lesson's
   material, keyed by the lesson's slug. These rows serve both the autogen
   share and the gate streak. */
const lesson = db.prepare(`INSERT INTO lessons (slug, student, at, status) VALUES (?, 'x', ?, ?)`);
lesson.run('g0', daysAgo(60), 'ready');     // outside the 30-day window: excluded
lesson.run('g1', daysAgo(9), 'failed');     // neither
lesson.run('g2', daysAgo(8), 'ready');      // lenient only: tutor edited it later
lesson.run('g3', daysAgo(7), 'held');       // lenient only: produced material, held
lesson.run('g4', daysAgo(6), 'ready');      // lenient only: tutor restored a version
lesson.run('g5', daysAgo(5), 'ready');      // strict + lenient: untouched
lesson.run('g6', daysAgo(1), 'generating'); // in flight, not a run outcome yet: excluded

const mat = db.prepare(`INSERT INTO lesson_materials
  (lesson_slug, kind, version, content, origin, published_at, created_at) VALUES (?, ?, ?, '{}', ?, ?, ?)`);
mat.run('g2', 'slides', 1, 'edited', daysAgo(4), daysAgo(4));
mat.run('g4', 'plan', 1, 'restored', daysAgo(3), daysAgo(3));

const m = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);

test('an active student is one taught lesson in the last 30 days, counted once', () => {
  assert.equal(m.activeStudents, 1);
});

test('autogen share: generation runs in 30 days; strict = ready and untouched by the tutor, lenient = produced material', () => {
  assert.equal(m.autogen.units, 5);                    // g1..g5; g0 too old, g6 still generating
  assert.equal(m.autogen.strict, 1 / 5);               // g5
  assert.equal(m.autogen.lenient, 4 / 5);              // g2, g3, g4, g5
});

test('coverage sets generation runs beside lessons taught in the same window', () => {
  // taught: two non-cancelled bookings of student 1 ended in the window;
  // lessons, not distinct students, so both count.
  assert.deepEqual(m.coverage, { runs: 5, taught: 2 });
});

test('revenue is last calendar month, paid and owed apart, void ignored', () => {
  assert.deepEqual(m.revenue, { month: '2026-09', paidAgorot: 21500, owedAgorot: 21500 });
});

test('the gate streak counts consecutive clean runs from the newest finished one', () => {
  // Newest first, skipping g6 (generating): g5 ready, g4 ready, g3 held -> stops.
  // A later tutor restore on g4 does not matter: the gate reads run status only.
  assert.deepEqual(m.gate, { streak: 2, target: 10 });
});

test('a ready run that never reached the student page breaks the streak', () => {
  const w = new DatabaseSync(process.env.DB_PATH);
  w.prepare(`INSERT INTO lessons (slug, student, at, status, problem) VALUES (?, 'x', ?, 'ready', ?)`)
    .run('g7', daysAgo(0.5), 'לא נוסף לדף האישי');
  w.prepare(`INSERT INTO lessons (slug, student, at, status) VALUES (?, 'x', ?, 'ready')`)
    .run('g8', daysAgo(0.25));
  try {
    const later = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), NOW);
    // Newest first: g8 clean, g7 generated but undelivered -> stops at 1.
    assert.deepEqual(later.gate, { streak: 1, target: 10 });
  } finally {
    w.exec(`DELETE FROM lessons WHERE slug IN ('g7','g8')`);
  }
});

test('it says out loud what it cannot measure', () => {
  assert.ok(m.notes.some((n) => n.includes('homework')));
  assert.ok(m.notes.some((n) => n.includes("reached the student's page")));
  assert.ok(m.notes.some((n) => n.includes('lessons booked through the site (bookings_v2)')));
});

test('an empty window reports null shares, not zero', () => {
  const empty = measure(new DatabaseSync(process.env.DB_PATH, { readOnly: true }), new Date('2030-01-01T00:00:00Z'));
  assert.equal(empty.autogen.units, 0);
  assert.equal(empty.autogen.strict, null);
  assert.equal(empty.activeStudents, 0);
  assert.deepEqual(empty.coverage, { runs: 0, taught: 0 });
});
