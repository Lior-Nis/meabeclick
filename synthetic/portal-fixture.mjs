import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PORTAL_FILE_NAME = 'synthetic-student-gamma.json';
export const PORTAL_FILE_TEXT = `${JSON.stringify({
  name: 'תלמידת בדיקה גמא',
  emoji: '🧪',
  subtitle: 'סביבת בדיקה סינתטית בלבד — אין כאן מידע על אדם אמיתי',
  progress: 72,
  progressNote: 'נתוני התקדמות בדיוניים לבדיקת תצוגה',
  nextLesson: null,
  games: [{ title: 'נוסחאות — בדיקה סינתטית', template: 'quiz', dataId: 'synthetic-linear-formulas' }],
  homework: [],
  lessons: [{
    date: '2026-01-15',
    topic: 'שיעור בדיקה: y = x²',
    slug: 'synthetic-quadratic-formulas',
  }],
}, null, 2)}\n`;

/** @param {string} portalDir */
export function seedSyntheticPortal(portalDir) {
  mkdirSync(portalDir, { recursive: true });
  for (const entry of readdirSync(portalDir)) {
    rmSync(join(portalDir, entry), { recursive: true, force: true });
  }

  const target = join(portalDir, PORTAL_FILE_NAME);
  const temporary = join(portalDir, `.${PORTAL_FILE_NAME}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, PORTAL_FILE_TEXT, { encoding: 'utf8', flag: 'wx', mode: 0o444 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** @param {string} portalDir */
export function verifySyntheticPortal(portalDir) {
  const entries = readdirSync(portalDir).sort();
  if (entries.length !== 1 || entries[0] !== PORTAL_FILE_NAME) {
    throw new Error(`[synthetic] portal: unexpected entries: ${entries.join(',') || '(empty)'}`);
  }
  if (readFileSync(join(portalDir, PORTAL_FILE_NAME), 'utf8') !== PORTAL_FILE_TEXT) {
    throw new Error(`[synthetic] portal: ${PORTAL_FILE_NAME} content changed`);
  }
}
