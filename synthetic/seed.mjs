import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';

const DB_PATH = '/synthetic-data/synthetic.db';
const MARKER = process.env.SYNTHETIC_DATA_MARKER || '/synthetic-data/.meabeclick-synthetic-volume';
const MARKER_BODY = 'meabeclick-synthetic-volume-v1\n';
const AT = '2026-01-15T10:00:00.000Z';

/** @param {string} message */
function refuse(message) {
  throw new Error(`[synthetic] ${message}`);
}

if (process.env.SYNTHETIC_TEST_MODE !== '1') refuse('SYNTHETIC_TEST_MODE must be 1');
if (process.env.DB_PATH !== DB_PATH) refuse(`DB_PATH must be exactly ${DB_PATH}`);
if (!existsSync(MARKER) || readFileSync(MARKER, 'utf8') !== MARKER_BODY) {
  refuse('synthetic volume marker is missing or invalid');
}
if (!existsSync(DB_PATH)) refuse('database does not exist; start the synthetic app so migrations run first');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

const requiredTables = ['accounts', 'students_v2', 'teachers', 'enrollments', 'bookings_v2', 'lessons', 'homework', 'results_v2', 'game_filler'];
const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((row) => row.name));
for (const table of requiredTables) if (!tables.has(table)) refuse(`required migrated table is missing: ${table}`);

const nonSyntheticAccounts = Number(db.prepare(`
  SELECT COUNT(*) AS n FROM accounts
  WHERE name NOT LIKE '%בדיקה%' OR email IS NULL OR email NOT LIKE '%@example.invalid'
`).get()?.n ?? 0);
const nonSyntheticStudents = Number(db.prepare(`
  SELECT COUNT(*) AS n FROM students_v2
  WHERE code NOT LIKE 'synthetic-%' OR name NOT LIKE '%בדיקה%'
`).get()?.n ?? 0);
if (nonSyntheticAccounts || nonSyntheticStudents) {
  refuse('refusing to seed a database containing non-synthetic account or student rows');
}

/** @type {{ id: number, name: string }[]} */
const teachers = db.prepare(`SELECT id, name FROM teachers ORDER BY id`).all()
  .map((row) => ({ id: Number(row.id), name: String(row.name) }));
const allowedTeacherNames = new Set(['ניקול', 'ליאור', 'מורה בדיקה אלפא', 'מורה בדיקה בטא']);
if (teachers.length !== 2 || teachers.some((teacher) => !allowedTeacherNames.has(teacher.name))) {
  refuse('refusing to seed a database containing an unexpected tutor roster');
}

const gameBody = JSON.stringify({
  title: 'בדיקה סינתטית — נוסחאות של פונקציה ריבועית',
  subject: 'מתמטיקה · תוכן בדיקה בלבד',
  questions: [
    { q: 'אם y = x², מה הערך של y כאשר x = 3?', options: ['6', '9', '12'], answer: 1, why: 'מציבים x = 3 ומקבלים 3² = 9.' },
    { q: 'איזו נוסחה מתארת ישר?', options: ['y = x²', 'y = 2x + 1', 'y = 1/x'], answer: 1, why: 'לישר יש צורה y = mx + b.' },
  ],
});

db.exec('BEGIN IMMEDIATE');
try {
  db.prepare(`UPDATE teachers SET name = ?, phone = NULL, active = 1, meet_url = NULL, meet_account = NULL,
    setup_hash = NULL, setup_expires = NULL, calendar_id = NULL, busy_ics = NULL, teaching_hours = NULL WHERE id = ?`)
    .run('מורה בדיקה אלפא', teachers[0].id);
  db.prepare(`UPDATE teachers SET name = ?, phone = NULL, active = 1, meet_url = NULL, meet_account = NULL,
    setup_hash = NULL, setup_expires = NULL, calendar_id = NULL, busy_ics = NULL, teaching_hours = NULL WHERE id = ?`)
    .run('מורה בדיקה בטא', teachers[1].id);

  db.prepare(`INSERT INTO accounts (id, name, phone, credential, is_self, created_at, email, legacy_code)
    VALUES (91001, 'הורה בדיקה אלפא', '0500000000', 'synthetic-account-link-only', 0, ?, 'parent.alpha@example.invalid', NULL)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, phone=excluded.phone, credential=excluded.credential,
      is_self=excluded.is_self, created_at=excluded.created_at, email=excluded.email, legacy_code=NULL`).run(AT);

  db.prepare(`INSERT INTO students_v2
    (id, code, name, emoji, account_id, progress, progress_note, credential, created_at, goals, style, notes)
    VALUES (92001, 'synthetic-student-gamma', 'תלמידת בדיקה גמא', '🧪', 91001, 72,
      'נתוני התקדמות בדיוניים לבדיקת תצוגה', 'synthetic-student-link-only', ?,
      'לתרגל משוואות ופונקציות — תוכן בדיקה', 'הסברים חזותיים — תוכן בדיקה', 'אין כאן מידע על אדם אמיתי')
    ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, emoji=excluded.emoji,
      account_id=excluded.account_id, progress=excluded.progress, progress_note=excluded.progress_note,
      credential=excluded.credential, created_at=excluded.created_at, goals=excluded.goals,
      style=excluded.style, notes=excluded.notes`).run(AT);

  db.prepare(`INSERT INTO enrollments (id, student_id, subject, level, teacher_id)
    VALUES (93001, 92001, 'מתמטיקה', 'כיתה ט — בדיקה', ?)
    ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id, subject=excluded.subject,
      level=excluded.level, teacher_id=excluded.teacher_id`).run(teachers[0].id);

  db.prepare(`INSERT INTO bookings_v2
    (id, student_id, enrollment_id, start, end, duration, at, status, source_utm, heard_from, mode, teacher_id, heard_from_detail)
    VALUES (94001, 92001, 93001, '2026-01-15T10:00:00.000Z', '2026-01-15T11:30:00.000Z', 90, ?,
      'confirmed', NULL, 'other', 'online', ?, 'מקור בדיקה סינתטי')
    ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id, enrollment_id=excluded.enrollment_id,
      start=excluded.start, end=excluded.end, duration=excluded.duration, at=excluded.at, status=excluded.status,
      source_utm=NULL, heard_from=excluded.heard_from, mode=excluded.mode, teacher_id=excluded.teacher_id,
      heard_from_detail=excluded.heard_from_detail`).run(AT, teachers[0].id);

  db.prepare(`INSERT INTO lessons
    (slug, student, subject, level, topic, title, context, at, lesson_at, status, problem, slides, homework, games)
    VALUES ('synthetic-quadratic-formulas', 'תלמידת בדיקה גמא', 'מתמטיקה', 'כיתה ט — בדיקה',
      'פונקציה ריבועית', 'שיעור בדיקה: y = x²', 'כל התוכן בדיוני ונועד לבדיקות UX בלבד', ?, ?,
      'ready', NULL, NULL, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET student=excluded.student, subject=excluded.subject, level=excluded.level,
      topic=excluded.topic, title=excluded.title, context=excluded.context, at=excluded.at,
      lesson_at=excluded.lesson_at, status=excluded.status, problem=NULL, slides=NULL,
      homework=excluded.homework, games=excluded.games`)
    .run(AT, AT,
      JSON.stringify(['פתרו: x² = 16', 'בדקו הצבה בנוסחה y = 2x + 1']),
      JSON.stringify([{ title: 'נוסחאות — בדיקה', template: 'quiz', dataId: 'synthetic-linear-formulas' }]));

  db.prepare(`INSERT INTO homework
    (id, lesson_id, student_id, task, template, data_id, assigned_at, due_at, submitted_at,
      submitted_by, graded_at, grade, graded_by, node_id, booking_id, held_until, answer)
    VALUES (95001, NULL, 92001, 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
      'quiz', 'synthetic-linear-formulas', ?, '2026-01-22T10:00:00.000Z', '2026-01-20T16:00:00.000Z',
      'student', '2026-01-21T09:00:00.000Z', 'ok', 'teacher', NULL, 94001, NULL,
      'x = 4 או x = -4 — מפתח תשובות סינתטי')
    ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id, task=excluded.task, template=excluded.template,
      data_id=excluded.data_id, assigned_at=excluded.assigned_at, due_at=excluded.due_at,
      submitted_at=excluded.submitted_at, submitted_by=excluded.submitted_by, graded_at=excluded.graded_at,
      grade=excluded.grade, graded_by=excluded.graded_by, booking_id=excluded.booking_id,
      held_until=NULL, answer=excluded.answer`).run(AT);

  db.prepare(`INSERT INTO game_filler (id, body) VALUES ('synthetic-linear-formulas', ?)
    ON CONFLICT(id) DO UPDATE SET body=excluded.body`).run(gameBody);

  db.prepare(`INSERT INTO results_v2
    (id, student_id, at, data_id, template, score, total, tries, stars, seconds, missed)
    VALUES (96001, 92001, '2026-01-20T16:05:00.000Z', 'synthetic-linear-formulas', 'quiz', 2, 2, 2, 3, 74, '[]')
    ON CONFLICT(id) DO UPDATE SET student_id=excluded.student_id, at=excluded.at, data_id=excluded.data_id,
      template=excluded.template, score=excluded.score, total=excluded.total, tries=excluded.tries,
      stars=excluded.stars, seconds=excluded.seconds, missed=excluded.missed`).run();

  db.prepare(`INSERT INTO lesson_reports (id, booking_id, student_id, enrollment_id, note, created_at, updated_at)
    VALUES (97001, 94001, 92001, 93001, 'דוח שיעור סינתטי: נוסחאות נקראו נכון והתרגול הושלם.', ?, ?)
    ON CONFLICT(id) DO UPDATE SET booking_id=excluded.booking_id, student_id=excluded.student_id,
      enrollment_id=excluded.enrollment_id, note=excluded.note, created_at=excluded.created_at,
      updated_at=excluded.updated_at`).run(AT, AT);

  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

console.log('[synthetic] deterministic seed applied: 1 account, 1 student, 2 tutors, 1 booking, 1 lesson, 1 homework submission, 1 result');
