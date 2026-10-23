const AT = '2026-01-15T10:00:00.000Z';

const slidesHtml = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>שיעור בדיקה סינתטי</title></head><body><main><h1>שיעור בדיקה: y = x²</h1><p>תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.</p></main></body></html>';

const gameBody = JSON.stringify({
  title: 'בדיקה סינתטית — נוסחאות של פונקציה ריבועית',
  subject: 'מתמטיקה · תוכן בדיקה בלבד',
  questions: [
    { q: 'אם y = x², מה הערך של y כאשר x = 3?', options: ['6', '9', '12'], answer: 1, why: 'מציבים x = 3 ומקבלים 3² = 9.' },
    { q: 'איזו נוסחה מתארת ישר?', options: ['y = x²', 'y = 2x + 1', 'y = 1/x'], answer: 1, why: 'לישר יש צורה y = mx + b.' },
  ],
});

/** @param {import('node:sqlite').DatabaseSync} db */
export function seedSyntheticRows(db) {
  db.prepare(`INSERT INTO teachers
    (id, name, phone, active, meet_url, meet_account, setup_hash, setup_expires, calendar_id, busy_ics, teaching_hours)
    VALUES (?, ?, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`)
    .run(98001, 'מורה בדיקה אלפא');
  db.prepare(`INSERT INTO teachers
    (id, name, phone, active, meet_url, meet_account, setup_hash, setup_expires, calendar_id, busy_ics, teaching_hours)
    VALUES (?, ?, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`)
    .run(98002, 'מורה בדיקה בטא');

  db.prepare(`INSERT INTO accounts (id, name, phone, credential, is_self, created_at, email, legacy_code)
    VALUES (91001, 'הורה בדיקה אלפא', '0500000000', 'synthetic-account-link-only', 0, ?, 'parent.alpha@example.invalid', NULL)`).run(AT);

  db.prepare(`INSERT INTO students_v2
    (id, code, name, emoji, account_id, progress, progress_note, credential, created_at, goals, style, notes)
    VALUES (92001, 'synthetic-student-gamma', 'תלמידת בדיקה גמא', '🧪', 91001, 72,
      'נתוני התקדמות בדיוניים לבדיקת תצוגה', 'synthetic-student-link-only', ?,
      'לתרגל משוואות ופונקציות — תוכן בדיקה', 'הסברים חזותיים — תוכן בדיקה', 'אין כאן מידע על אדם אמיתי')`).run(AT);

  db.prepare(`INSERT INTO enrollments (id, student_id, subject, level, teacher_id)
    VALUES (93001, 92001, 'מתמטיקה', 'כיתה ט — בדיקה', 98001)`).run();

  db.prepare(`INSERT INTO bookings_v2
    (id, student_id, enrollment_id, start, end, duration, at, status, source_utm, heard_from, mode, teacher_id, heard_from_detail)
    VALUES (94001, 92001, 93001, '2026-01-15T10:00:00.000Z', '2026-01-15T11:30:00.000Z', 90, ?,
      'confirmed', NULL, 'other', 'online', 98001, 'מקור בדיקה סינתטי')`).run(AT);

  db.prepare(`INSERT INTO lessons
    (id, slug, student, subject, level, topic, title, context, at, lesson_at, status, problem, slides, homework, games)
    VALUES (99001, 'synthetic-quadratic-formulas', 'תלמידת בדיקה גמא', 'מתמטיקה', 'כיתה ט — בדיקה',
      'פונקציה ריבועית', 'שיעור בדיקה: y = x²', 'כל התוכן בדיוני ונועד לבדיקות UX בלבד', ?, ?,
      'ready', NULL, NULL, ?, ?)`).run(AT, AT,
    JSON.stringify(['פתרו: x² = 16', 'בדקו הצבה בנוסחה y = 2x + 1']),
    JSON.stringify([{ title: 'נוסחאות — בדיקה', template: 'quiz', dataId: 'synthetic-linear-formulas' }]));

  db.prepare(`INSERT INTO lesson_materials
    (id, lesson_slug, kind, version, content, teacher_only, origin, published_at, created_at)
    VALUES (98501, 'synthetic-quadratic-formulas', 'slides', 1, ?, NULL, 'generated', ?, ?)`)
    .run(slidesHtml, AT, AT);

  db.prepare(`INSERT INTO homework
    (id, lesson_id, student_id, task, template, data_id, assigned_at, due_at, submitted_at,
      submitted_by, graded_at, grade, graded_by, node_id, booking_id, held_until, answer)
    VALUES (95001, NULL, 92001, 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה',
      'quiz', 'synthetic-linear-formulas', ?, '2026-01-22T10:00:00.000Z', '2026-01-20T16:00:00.000Z',
      'student', '2026-01-21T09:00:00.000Z', 'ok', 'teacher', NULL, 94001, NULL,
      'x = 4 או x = -4 — מפתח תשובות סינתטי')`).run(AT);

  db.prepare(`INSERT INTO game_filler (id, body) VALUES ('synthetic-linear-formulas', ?)`).run(gameBody);

  db.prepare(`INSERT INTO results_v2
    (id, student_id, at, data_id, template, score, total, tries, stars, seconds, missed)
    VALUES (96001, 92001, '2026-01-20T16:05:00.000Z', 'synthetic-linear-formulas', 'quiz', 2, 2, 2, 3, 74, '[]')`).run();

  db.prepare(`INSERT INTO lesson_reports (id, booking_id, student_id, enrollment_id, note, created_at, updated_at)
    VALUES (97001, 94001, 92001, 93001, 'דוח שיעור סינתטי: נוסחאות נקראו נכון והתרגול הושלם.', ?, ?)`).run(AT, AT);
}
