/**
 * The last step of generation, through the whole pipeline.
 *
 * triggerForBooking → codex → publish() → finishLesson() →
 * appendToPortal() → notify(). Everything up to and including
 * finishLesson() succeeded on production while the final step did nothing:
 * appendToPortal() looked the student up in the retired `students` table,
 * found nothing for every student enrolled since the students_v2 migration,
 * returned false — and the caller threw that false away and told the tutor
 * "✅ שיעור חדש מוכן".
 *
 * So four lessons were generated at minutes of billed agent time each, with
 * slides and game data on disk and `status: ready` in the database, and
 * every student's portal file held empty arrays. The page a family opens
 * reads those arrays and nothing else.
 *
 * Two things are pinned here, and the second matters as much as the first:
 * the lesson reaches the portal, AND a lesson that does not reach it says
 * so in the message the tutor reads. A ✅ on a lesson nobody can see is how
 * this stayed hidden.
 *
 * The engine is a stub script, so no agent runs and nothing is billed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = await mkdtemp(join(tmpdir(), 'lesson-e2e-'));
process.env.DATA_DIR = dataDir;
process.env.DB_PATH = join(dataDir, 'results.db');
process.env.PORTAL_DIR = join(dataDir, 'portal');
await mkdir(process.env.PORTAL_DIR, { recursive: true });

const A_PLAN = {
  "title": "שברים",
  "gradeContext": "כיתה ז",
  "slides": [
    {
      "heading": "מה זה שבר",
      "bullets": [
        "חלק מתוך שלם"
      ]
    },
    {
      "heading": "מונה ומכנה",
      "bullets": [
        "המכנה סופר לכמה חלקים חילקנו"
      ]
    },
    {
      "heading": "שברים שווים",
      "bullets": [
        "2/4 שווה 1/2"
      ]
    },
    {
      "heading": "חיבור שברים",
      "bullets": [
        "צריך מכנה משותף"
      ]
    }
  ],
  "examples": [
    {
      "problem": "1/2 + 1/4",
      "steps": [
        "מכנה משותף 4",
        "2/4 + 1/4"
      ],
      "answer": "3/4"
    }
  ],
  "homework": [
    {
      "task": "צמצמו 18/24",
      "why": "גורמים משותפים"
    },
    {
      "task": "חשבו 2/3 + 1/6",
      "why": "מכנה משותף"
    }
  ],
  "games": {
    "memory": {
      "title": "זיכרון שברים",
      "subject": "מתמטיקה",
      "pairs": [
        {
          "a": "1/2",
          "b": "2/4"
        },
        {
          "a": "1/3",
          "b": "2/6"
        },
        {
          "a": "1/4",
          "b": "2/8"
        },
        {
          "a": "2/3",
          "b": "4/6"
        },
        {
          "a": "3/4",
          "b": "6/8"
        },
        {
          "a": "1/5",
          "b": "2/10"
        }
      ]
    },
    "quiz": {
      "title": "בדיקת הבנה",
      "subject": "מתמטיקה",
      "questions": [
        {
          "q": "כמה זה 1/2 + 1/4?",
          "options": [
            "3/4",
            "2/6"
          ],
          "answer": 0
        }
      ]
    }
  }
};

/** Same stub shape lesson-engine.test.mjs uses: honours `-o`, drains stdin. */
const stubDir = await mkdtemp(join(tmpdir(), 'stub-agent-'));
const stub = join(stubDir, 'agent');
await writeFile(stub, `#!/bin/sh
cat > "${stubDir}/prompt.txt"
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift 2 ;; *) shift ;; esac
done
cat > "$out" <<'JSON'
${JSON.stringify(A_PLAN)}
JSON
exit 0
`, { mode: 0o755 });
process.env.CODEX_BIN = stub;
process.env.OPENAI_API_KEY = 'stub-key-so-the-preflight-passes';

const E = await import('../../src/lib/server/entities.ts');
const { triggerForBooking } = await import('../../src/lib/server/lesson/queue.ts');
const HW = await import('../../src/lib/server/lessons.ts');
const R = await import('../../src/lib/server/results.ts');
const DB = await import('../../src/lib/server/db.ts');

const row = (slug) => DB.readLessons().find(l => l.slug === slug);

const account = E.createAccount({ name: 'משפחה', credential: 'fam' });

async function seedStudent(code) {
  const student = E.createStudent({ code, name: 'תלמידה', accountId: account.id, credential: 'p' });
  await writeFile(join(process.env.PORTAL_DIR, `${code}.json`), JSON.stringify({
    name: 'תלמידה', emoji: '🎓', subject: 'מתמטיקה', lessons: [], homework: [], games: [],
  }, null, 2));
  return student.id;
}

/** triggerForBooking deliberately does not await generation — a parent must
 *  not watch a spinner. Wait for the notification instead of sleeping. */
function collector() {
  const messages = [];
  let resolve;
  const first = new Promise(r => { resolve = r; });
  return {
    messages,
    first,
    notify: (text) => { messages.push(text); resolve(text); },
  };
}

const booking = (over = {}) => ({
  name: 'תלמידה', subject: 'מתמטיקה', level: 'כיתה ז', request: 'שברים', ...over,
});

test('a generated lesson lands on the student page the family actually reads', async () => {
  const code = 'reaches';
  const studentId = await seedStudent(code);
  const c = collector();

  const { slug, started } = triggerForBooking(booking(), { notify: c.notify, enrolledCode: code });
  assert.equal(started, true);

  const message = await c.first;
  assert.match(message, /שיעור חדש מוכן/);
  assert.doesNotMatch(message, /⚠️/, 'this run reached the portal, so it must not warn');

  const data = JSON.parse(await readFile(join(process.env.PORTAL_DIR, `${code}.json`), 'utf8'));
  assert.equal(data.lessons.length, 1, 'the portal file is the ONLY source /api/portal serves lessons from');
  assert.equal(data.lessons[0].topic, 'שברים');
  assert.equal(data.lessons[0].slug, slug);
  assert.equal(data.games.length, 2, 'both games the plan asked for');

  /* Homework moved to the homework table, which both the tutor and the
     student read — writing it here left it invisible to her. */
  assert.deepEqual(data.homework ?? [], []);
  assert.equal(HW.homeworkForStudent(studentId).length, 2, 'both tasks the plan set');
  assert.deepEqual(data.games.map(g => g.template).sort(), ['memory', 'quiz']);

  // A clean run, as the p1 gate (scripts/vision-metrics.mjs) counts one.
  assert.equal(row(slug).status, 'ready');
  assert.equal(row(slug).problem, null);
});

test('generated homework is offline work, not a game assignment', async () => {
  const code = 'offline';
  const studentId = await seedStudent(code);
  const c = collector();

  triggerForBooking(booking(), { notify: c.notify, enrolledCode: code });
  await c.first;

  /* Every generated task used to be handed the FIRST game's dataId, whatever
     it said. Verified against real Codex output on 2026-09-22: all four tasks
     were written exercises — "מחיר מעיל 300 ש״ח, הנחה 20% ואז 10%" — and all
     four pointed at the matching game. Finishing the quiz ticked nothing;
     finishing matching would have ticked all four at once.

     No play event can legitimately complete a pen-and-paper exercise, so the
     link is not repaired here, it is removed. The lesson's games are still
     published and still reachable — the student page has its own Games
     section, which is where a game belongs. */
  const rows = HW.homeworkForStudent(studentId);
  assert.equal(rows.length, 2, 'both tasks the plan set');
  for (const row of rows) {
    assert.equal(row.data_id, null, `"${row.task}" must not be completable by playing something`);
    assert.equal(row.template, null);
    assert.equal(row.submitted, false, 'nobody has done it yet');
    assert.equal(row.graded, false, 'and nobody has judged it');
  }
});

test('two tasks can no longer be completed by one unrelated play', async () => {
  const code = 'nocrosstalk';
  const studentId = await seedStudent(code);
  const c = collector();
  triggerForBooking(booking(), { notify: c.notify, enrolledCode: code });
  await c.first;

  // A play of the lesson's own game must not tick written work.
  R.writeResult({ studentId, dataId: 'nocrosstalk-mtmtik-x-memory', template: 'memory', score: 6, total: 6 });
  const rows = HW.homeworkForStudent(studentId);
  assert.deepEqual(rows.map(r => r.submitted), [false, false]);
});

test('a lesson that never reached a portal is not reported as ✅', async () => {
  const c = collector();
  // An enrolledCode that resolves to nobody — a deleted student, or the
  // legacy-table lookup that caused this. The lesson itself is fine.
  const { slug } = triggerForBooking(booking(), { notify: c.notify, enrolledCode: 'nobody-by-that-code' });

  const message = await c.first;
  assert.match(message, /⚠️/, 'a ✅ on a lesson the student cannot see is how this hid for weeks');
  assert.match(message, /לא נוסף לדף האישי/, 'the tutor must be told WHAT is wrong, not just that something is');
  // Still says the lesson is ready, because it is — only its delivery failed.
  assert.match(message, /שברים/);

  /* And the row says so too. The WhatsApp message used to be the only
     record: the row read `ready` with no problem, so the p1 gate counted a
     lesson no child ever saw as a clean run, and the dashboard showed it
     as fine the moment the message scrolled away. */
  assert.equal(row(slug).status, 'ready', 'the material exists and its slides still render');
  assert.match(row(slug).problem ?? '', /לא נוסף לדף האישי/);
});

test('booking-time homework is held for its lesson until a day after it ends', async () => {
  // Spec D1/D2/D5 (homework-from-what-was-taught): generated before the
  // lesson, so the family must not see it before the lesson has happened.
  const code = 'heldhw';
  const studentId = await seedStudent(code);
  const c = collector();
  const end = '2099-03-15T11:30:00+02:00';
  triggerForBooking(booking({ start: '2099-03-15T10:00:00+02:00', end }),
    { notify: c.notify, enrolledCode: code, bookingId: 4242 });
  await c.first;

  assert.deepEqual(HW.homeworkForStudent(studentId), [], 'nothing before the lesson');
  const held = HW.homeworkForStudent(studentId, { includeHeld: true });
  assert.equal(held.length, 2);
  for (const h of held) {
    assert.equal(h.booking_id, 4242);
    assert.equal(h.held_until, new Date(new Date(end).getTime() + 24 * 3600_000).toISOString());
  }
});

test('a booking with no end is not held forever', async () => {
  const { heldUntilFor } = await import('../../src/lib/server/lesson/queue.ts');
  assert.equal(heldUntilFor(undefined), null);
  assert.equal(heldUntilFor('not a date'), null);
});
