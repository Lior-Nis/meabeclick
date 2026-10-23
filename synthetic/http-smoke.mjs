import { createHmac } from 'node:crypto';
import { loopbackUrlIssue } from './runtime-policy.mjs';

const SECRET = 'synthetic-test-secret-not-for-production-7ee72572';
const STUDENT_ID = 92001;
const STUDENT_CODE = 'synthetic-student-gamma';
const requestedBaseUrl = process.argv[2];

const issue = loopbackUrlIssue(requestedBaseUrl, requestedBaseUrl);
if (issue) throw new Error(`[synthetic] HTTP smoke target rejected: ${issue}`);
const baseUrl = new URL(requestedBaseUrl).origin;

const payload = `s.${STUDENT_ID}.${Date.now() + 60_000}`;
const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
const token = `${payload}.${signature}`;

const enter = await fetch(`${baseUrl}/enter?t=${encodeURIComponent(token)}`, { redirect: 'manual' });
if (enter.status !== 303) throw new Error(`[synthetic] /enter smoke returned HTTP ${enter.status}`);
const expectedLocation = `/app/student?s=${STUDENT_CODE}`;
if (enter.headers.get('location') !== expectedLocation) {
  throw new Error(`[synthetic] /enter smoke redirected somewhere unexpected`);
}
const setCookie = enter.headers.get('set-cookie');
const cookie = setCookie?.split(';', 1)[0];
if (!cookie?.startsWith('maab_family=')) throw new Error('[synthetic] /enter did not establish a family session');

const page = await fetch(`${baseUrl}${expectedLocation}`, {
  headers: { cookie },
  redirect: 'manual',
});
if (!page.ok) throw new Error(`[synthetic] student portal page smoke returned HTTP ${page.status}`);

const portal = await fetch(`${baseUrl}/api/portal/${STUDENT_CODE}`, {
  headers: { cookie },
  redirect: 'manual',
});
if (!portal.ok) throw new Error(`[synthetic] student portal API smoke returned HTTP ${portal.status}`);
const body = await portal.json();
const homework = body?.homework?.[0];
const lesson = body?.lessons?.[0];
const game = body?.games?.[0];
if (body?.name !== 'תלמידת בדיקה גמא'
  || lesson?.slidesUrl !== '/lessons/synthetic-quadratic-formulas'
  || game?.dataId !== 'synthetic-linear-formulas'
  || typeof game?.url !== 'string'
  || homework?.id !== 95001
  || homework?.task !== 'פתרו x² = 16 והסבירו את שתי התשובות — משימת בדיקה'
  || homework?.submitted !== true
  || homework?.graded !== true
  || homework?.grade !== 'ok'
  || homework?.gradedBy !== 'teacher'
  || homework?.template !== 'quiz'
  || homework?.dataId !== 'synthetic-linear-formulas') {
  throw new Error('[synthetic] student portal API did not expose the exact synthetic UX fixture');
}

function fixtureUrl(path, label) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`[synthetic] ${label} URL was not a root-relative synthetic path`);
  }
  const resolved = new URL(path, baseUrl);
  if (resolved.origin !== baseUrl || resolved.hash) {
    throw new Error(`[synthetic] ${label} URL escaped the synthetic loopback origin`);
  }
  if (label === 'lesson'
    && (resolved.pathname !== '/lessons/synthetic-quadratic-formulas' || resolved.search)) {
    throw new Error('[synthetic] lesson URL did not identify the exact synthetic material');
  }
  if (label === 'game') {
    const keys = [...resolved.searchParams.keys()].sort();
    if (resolved.pathname !== '/app/play/quiz'
      || JSON.stringify(keys) !== '["d","s","t"]'
      || resolved.searchParams.get('d') !== 'synthetic-linear-formulas'
      || resolved.searchParams.get('s') !== STUDENT_CODE
      || !resolved.searchParams.get('t')) {
      throw new Error('[synthetic] game URL did not identify the exact signed synthetic game');
    }
  }
  return resolved;
}

const slides = await fetch(fixtureUrl(lesson.slidesUrl, 'lesson'), { redirect: 'manual' });
if (!slides.ok) throw new Error(`[synthetic] lesson material smoke returned HTTP ${slides.status}`);
const slidesText = await slides.text();
if (!slidesText.includes('שיעור בדיקה: y = x²')
  || !slidesText.includes('תוכן שקופיות סינתטי בלבד — נוסחת קודקוד.')) {
  throw new Error('[synthetic] lesson material did not contain the expected synthetic slides');
}

const gamePage = await fetch(fixtureUrl(game.url, 'game'), { redirect: 'manual' });
if (!gamePage.ok) throw new Error(`[synthetic] signed game smoke returned HTTP ${gamePage.status}`);
const gameText = await gamePage.text();
if (!gameText.includes('בדיקה סינתטית — נוסחאות של פונקציה ריבועית')
  || !gameText.includes('אם y = x², מה הערך של y כאשר x = 3?')) {
  throw new Error('[synthetic] signed game page did not contain the expected synthetic game');
}

console.log('[synthetic] lesson, game, and completed homework HTTP smoke passed');
