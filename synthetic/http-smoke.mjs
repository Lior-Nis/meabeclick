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

const page = await fetch(`${baseUrl}${expectedLocation}`, { headers: { cookie } });
if (!page.ok) throw new Error(`[synthetic] student portal page smoke returned HTTP ${page.status}`);

const portal = await fetch(`${baseUrl}/api/portal/${STUDENT_CODE}`, { headers: { cookie } });
if (!portal.ok) throw new Error(`[synthetic] student portal API smoke returned HTTP ${portal.status}`);
const body = await portal.json();
if (body?.name !== 'תלמידת בדיקה גמא'
  || body?.lessons?.[0]?.slidesUrl !== '/lessons/synthetic-quadratic-formulas'
  || body?.games?.[0]?.dataId !== 'synthetic-linear-formulas'
  || body?.homework?.[0]?.id !== 95001) {
  throw new Error('[synthetic] student portal API did not expose the exact synthetic UX fixture');
}

console.log('[synthetic] magic-link and student portal HTTP smoke passed');
