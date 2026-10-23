const empty = Object.freeze([]);

/**
 * Every table in src/lib/server/storage-inventory.ts. The synthetic database
 * policy is deliberately exhaustive: a migration that adds a table must add
 * an explicit empty/allowlisted decision here before verification can pass.
 */
export const DATA_TABLE_POLICY = Object.freeze({
  accounts: { key: 'id', expectedKeys: [91001] },
  students_v2: { key: 'id', expectedKeys: [92001] },
  teachers: { key: 'id', expectedKeys: [98001, 98002] },
  enrollments: { key: 'id', expectedKeys: [93001] },
  bookings_v2: { key: 'id', expectedKeys: [94001] },
  library_uses: { key: 'id', expectedKeys: empty },
  engine_status: { key: 'id', expectedKeys: empty },
  lesson_engines: { key: 'id', expectedKeys: empty },
  library_items: { key: 'id', expectedKeys: empty },
  pending_bookings: { key: 'id', expectedKeys: empty },
  payments: { key: 'id', expectedKeys: empty },
  homework: { key: 'id', expectedKeys: [95001] },
  results_v2: { key: 'id', expectedKeys: [96001] },
  join_codes: { key: 'code', expectedKeys: empty },
  calendar_failures: { key: 'id', expectedKeys: empty },
  plans: { key: 'id', expectedKeys: empty },
  plan_nodes: { key: 'id', expectedKeys: empty },
  plan_prereqs: { key: 'id', expectedKeys: empty },
  plan_events: { key: 'id', expectedKeys: empty },
  lesson_reminders: { key: 'id', expectedKeys: empty },
  game_skills: { key: 'id', expectedKeys: empty },
  game_filler: { key: 'id', expectedKeys: ['synthetic-linear-formulas'] },
  lesson_reports: { key: 'id', expectedKeys: [97001] },
  lesson_report_notes: { key: 'id', expectedKeys: empty },
  report_prompts: { key: 'id', expectedKeys: empty },
  lesson_requests: { key: 'id', expectedKeys: empty },
  lesson_materials: { key: 'id', expectedKeys: empty },
  drive_items: { key: 'id', expectedKeys: empty },
  lessons: { key: 'id', expectedKeys: [99001] },
  lessons_v2: { key: 'id', expectedKeys: empty },
  students: { key: 'code', expectedKeys: empty },
  bookings: { key: 'id', expectedKeys: empty },
  results: { key: 'id', expectedKeys: empty },
  calendar_failures_v2: { key: 'id', expectedKeys: empty },
  marketing_events: { key: 'id', expectedKeys: empty },
  schema_version: { key: 'version', expectedKeys: Array.from({ length: 31 }, (_, i) => i + 1) },
});

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const comparable = (value) => typeof value === 'bigint' ? Number(value) : value;

/** @param {import('node:sqlite').DatabaseSync} db */
function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map((row) => String(row.name));
}

/**
 * Deletes migration-created tutor defaults, generic catalog rows, and every
 * other application row. schema_version is bookkeeping and is preserved.
 * The caller may disable foreign keys and wrap this with seeding in one
 * transaction; standalone callers get safe foreign-key handling here.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ manageForeignKeys?: boolean }} options
 */
export function purgeApplicationData(db, { manageForeignKeys = true } = {}) {
  if (manageForeignKeys) db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const table of Object.keys(DATA_TABLE_POLICY)) {
      if (table !== 'schema_version') db.exec(`DELETE FROM ${quote(table)}`);
    }
  } finally {
    if (manageForeignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
}

/** @param {unknown[]} actual @param {readonly unknown[]} expected */
function sameKeys(actual, expected) {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/** @param {import('node:sqlite').DatabaseSync} db @param {string} table */
function row(db, table) {
  return db.prepare(`SELECT * FROM ${quote(table)} LIMIT 1`).get();
}

/** @param {boolean} condition @param {string} table @param {string} detail */
function requireRow(condition, table, detail) {
  if (!condition) throw new Error(`[synthetic] ${table}: ${detail}`);
}

/**
 * Exhaustive final-state verification. It rejects unknown/missing tables,
 * any unallowlisted key in every authoritative/live/draining/dead table, and
 * altered content in each deterministic fixture row.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function verifySyntheticDatabase(db) {
  const foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyViolations.length) {
    const details = foreignKeyViolations
      .map((violation) => `${violation.table}:${violation.rowid ?? '-'}`)
      .join(',');
    throw new Error(`[synthetic] foreign key violations: ${details}`);
  }

  const actualTables = tableNames(db);
  const expectedTables = Object.keys(DATA_TABLE_POLICY).sort();
  if (!sameKeys(actualTables, expectedTables)) {
    const missing = expectedTables.filter((name) => !actualTables.includes(name));
    const unexpected = actualTables.filter((name) => !expectedTables.includes(name));
    throw new Error(`[synthetic] table inventory mismatch; missing=${missing.join(',') || '-'} unexpected=${unexpected.join(',') || '-'}`);
  }

  for (const [table, policy] of Object.entries(DATA_TABLE_POLICY)) {
    if (policy.expectedKeys.length === 0) {
      const count = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get()?.n ?? 0);
      if (count !== 0) throw new Error(`[synthetic] ${table}: expected empty table`);
      continue;
    }
    const actual = db.prepare(`SELECT ${quote(policy.key)} AS key FROM ${quote(table)} ORDER BY ${quote(policy.key)}`)
      .all().map((entry) => comparable(entry.key));
    if (!sameKeys(actual, policy.expectedKeys)) {
      throw new Error(`[synthetic] ${table}: unexpected row keys/count`);
    }
  }

  const account = row(db, 'accounts');
  requireRow(account?.id === 91001 && account?.name === 'הורה בדיקה אלפא'
    && account?.phone === '0500000000' && account?.email === 'parent.alpha@example.invalid'
    && account?.credential === 'synthetic-account-link-only' && account?.is_self === 0
    && account?.created_at === '2026-01-15T10:00:00.000Z' && account?.legacy_code === null,
  'accounts', 'fixture identity/content changed');

  const student = row(db, 'students_v2');
  requireRow(student?.id === 92001 && student?.code === 'synthetic-student-gamma'
    && student?.name === 'תלמידת בדיקה גמא' && student?.account_id === 91001
    && student?.emoji === '🧪' && student?.progress === 72
    && student?.progress_note === 'נתוני התקדמות בדיוניים לבדיקת תצוגה'
    && student?.credential === 'synthetic-student-link-only' && student?.created_at === '2026-01-15T10:00:00.000Z'
    && student?.goals === 'לתרגל משוואות ופונקציות — תוכן בדיקה'
    && student?.style === 'הסברים חזותיים — תוכן בדיקה'
    && student?.notes === 'אין כאן מידע על אדם אמיתי',
  'students_v2', 'fixture identity/content changed');

  const tutors = db.prepare('SELECT * FROM teachers ORDER BY id').all();
  const tutorNames = ['מורה בדיקה אלפא', 'מורה בדיקה בטא'];
  requireRow(tutors.length === 2 && tutors.every((tutor, index) =>
    tutor.id === 98001 + index && tutor.name === tutorNames[index] && tutor.phone === null
    && tutor.active === 1 && tutor.meet_url === null && tutor.meet_account === null
    && tutor.setup_hash === null && tutor.setup_expires === null && tutor.calendar_id === null
    && tutor.busy_ics === null && tutor.teaching_hours === null),
  'teachers', 'real/default or externally configured tutor identity detected');

  const enrollment = row(db, 'enrollments');
  requireRow(enrollment?.id === 93001 && enrollment?.student_id === 92001
    && enrollment?.teacher_id === 98001 && enrollment?.subject === 'מתמטיקה'
    && enrollment?.level === 'כיתה ט — בדיקה', 'enrollments', 'fixture linkage/content changed');

  const booking = row(db, 'bookings_v2');
  requireRow(booking?.id === 94001 && booking?.student_id === 92001
    && booking?.enrollment_id === 93001 && booking?.teacher_id === 98001
    && booking?.start === '2026-01-15T10:00:00.000Z' && booking?.end === '2026-01-15T11:30:00.000Z'
    && booking?.duration === 90 && booking?.at === '2026-01-15T10:00:00.000Z'
    && booking?.status === 'confirmed' && booking?.source_utm === null && booking?.heard_from === 'other'
    && booking?.mode === 'online' && booking?.heard_from_detail === 'מקור בדיקה סינתטי',
  'bookings_v2', 'fixture linkage/content changed');

  const lesson = row(db, 'lessons');
  requireRow(lesson?.id === 99001 && lesson?.slug === 'synthetic-quadratic-formulas'
    && lesson?.student === 'תלמידת בדיקה גמא' && lesson?.subject === 'מתמטיקה'
    && lesson?.level === 'כיתה ט — בדיקה' && lesson?.topic === 'פונקציה ריבועית'
    && lesson?.title === 'שיעור בדיקה: y = x²' && lesson?.context === 'כל התוכן בדיוני ונועד לבדיקות UX בלבד'
    && lesson?.at === '2026-01-15T10:00:00.000Z' && lesson?.lesson_at === '2026-01-15T10:00:00.000Z'
    && lesson?.status === 'ready' && lesson?.problem === null && lesson?.slides === null
    && lesson?.homework === '["פתרו: x² = 16","בדקו הצבה בנוסחה y = 2x + 1"]'
    && lesson?.games === '[{"title":"נוסחאות — בדיקה","template":"quiz","dataId":"synthetic-linear-formulas"}]',
  'lessons', 'formula/homework fixture changed');

  const homework = row(db, 'homework');
  requireRow(homework?.id === 95001 && homework?.student_id === 92001
    && homework?.lesson_id === null && homework?.booking_id === 94001
    && homework?.task === 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה'
    && homework?.template === 'quiz' && homework?.data_id === 'synthetic-linear-formulas'
    && homework?.assigned_at === '2026-01-15T10:00:00.000Z' && homework?.due_at === '2026-01-22T10:00:00.000Z'
    && homework?.submitted_at === '2026-01-20T16:00:00.000Z' && homework?.submitted_by === 'student'
    && homework?.graded_at === '2026-01-21T09:00:00.000Z' && homework?.grade === 'ok'
    && homework?.graded_by === 'teacher' && homework?.node_id === null && homework?.held_until === null
    && homework?.answer === 'x = 4 או x = -4 — מפתח תשובות סינתטי',
  'homework', 'deterministic submission coverage changed');

  const result = row(db, 'results_v2');
  requireRow(result?.id === 96001 && result?.student_id === 92001
    && result?.at === '2026-01-20T16:05:00.000Z' && result?.data_id === 'synthetic-linear-formulas'
    && result?.template === 'quiz' && result?.score === 2 && result?.total === 2
    && result?.tries === 2 && result?.stars === 3 && result?.seconds === 74
    && result?.missed === '[]' && result?.hints === null,
  'results_v2', 'deterministic result coverage changed');

  const filler = row(db, 'game_filler');
  let body;
  try { body = JSON.parse(String(filler?.body)); } catch { body = null; }
  requireRow(filler?.id === 'synthetic-linear-formulas'
    && body?.title === 'בדיקה סינתטית — נוסחאות של פונקציה ריבועית'
    && body?.subject === 'מתמטיקה · תוכן בדיקה בלבד' && body?.questions?.length === 2
    && body.questions[0]?.q === 'אם y = x², מה הערך של y כאשר x = 3?'
    && JSON.stringify(body.questions[0]?.options) === '["6","9","12"]' && body.questions[0]?.answer === 1
    && body.questions[0]?.why === 'מציבים x = 3 ומקבלים 3² = 9.'
    && body.questions[1]?.q === 'איזו נוסחה מתארת ישר?'
    && JSON.stringify(body.questions[1]?.options) === '["y = x²","y = 2x + 1","y = 1/x"]'
    && body.questions[1]?.answer === 1 && body.questions[1]?.why === 'לישר יש צורה y = mx + b.',
  'game_filler', 'generic/non-synthetic catalog content detected');

  const report = row(db, 'lesson_reports');
  requireRow(report?.id === 97001 && report?.booking_id === 94001
    && report?.student_id === 92001 && report?.enrollment_id === 93001
    && report?.note === 'דוח שיעור סינתטי: נוסחאות נקראו נכון והתרגול הושלם.'
    && report?.created_at === '2026-01-15T10:00:00.000Z' && report?.updated_at === '2026-01-15T10:00:00.000Z',
  'lesson_reports', 'fixture linkage/content changed');

  return Object.fromEntries(Object.entries(DATA_TABLE_POLICY)
    .filter(([table]) => table !== 'schema_version')
    .map(([table, policy]) => [table, policy.expectedKeys.length]));
}
