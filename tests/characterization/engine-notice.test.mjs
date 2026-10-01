// tests/characterization/engine-notice.test.mjs
//
// While the lesson engine is down, the tutor's dashboard says so — why,
// until when, and which coming lessons have nothing prepared — instead of
// leaving her to find out from a booking that failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { startServer, login } from './harness.mjs';

const QUOTA = 'נגמרה המכסה ליצירת שיעורים אוטומטית — השיעור לא נוצר. אפשר לנסות שוב מאוחר יותר';

test('the dashboard tells the tutor the engine is down, until when, and what it affects', async () => {
  const { baseUrl, dbPath, stop } = await startServer();
  try {
    const tutor = await login(baseUrl);
    const dashboard = () => fetch(`${baseUrl}/app/dashboard`, { headers: { Cookie: tutor } }).then(r => r.text());
    assert.doesNotMatch(await dashboard(), /יצירת שיעורים אוטומטית לא זמינה/, 'nothing while it is up');

    const db = new DatabaseSync(dbPath, { timeout: 5000 });
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    db.prepare(`INSERT INTO lessons (slug, student, at, lesson_at, status, problem) VALUES ('en-1', 'נוגה ישראלי', ?, ?, 'failed', ?)`)
      .run(new Date().toISOString(), soon, QUOTA);
    db.prepare(`INSERT INTO engine_status (engine, kind, until, at) VALUES ('codex', 'engine-quota', '2026-10-12T19:26:00.000Z', ?)`)
      .run(new Date().toISOString());

    const html = await dashboard();
    assert.match(html, /יצירת שיעורים אוטומטית לא זמינה/);
    assert.match(html, /12\/10\/2026 בשעה 22:26/, 'until, in Israel time, worded so the date and time keep their order');
    assert.match(html, /נוגה ישראלי/);
    assert.match(html, /href="\/app\/library"/, 'and where lessons can still come from');
  } finally { await stop(); }
});
