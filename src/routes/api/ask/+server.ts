/**
 * A student's question about their own material, answered in Hebrew at their
 * level. The client renders a "ask your tutor on WhatsApp" fallback on any
 * non-200, so every failure path here is safe to be terse.
 *
 * This called the Anthropic Messages API directly until the engine switch.
 * ANTHROPIC_API_KEY was never set in the container, so it had been answering
 * 503 for its entire life — the fallback made a permanently dead feature
 * look like an intermittently busy one. It now runs through the same Codex
 * subscription that generates lessons; see src/lib/server/ask.ts for the
 * latency trade that choice makes and why it was made.
 *
 * The slug must resolve to a real portal file the caller's own family
 * session is allowed to open, which is what keeps this from being an open,
 * uncredentialed proxy to a paid agent. It used to be gated on the portal
 * pin passed in the request body; the pin no longer exists, and a session is
 * a stronger check anyway — it cannot be replayed out of a screenshot or a
 * browser history entry.
 */
import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalDir } from '$server/paths.ts';
import { readJson } from '$server/http.ts';
import { resolveFamilyAccess, studentInScope } from '$server/family.ts';
import { askAgent, type HistoryTurn } from '$server/ask.ts';
import { firstName } from '$lib/names.ts';
import { LessonGenerationError, engineHasCredentials } from '$server/lesson/engine.ts';
import { singleton } from '$server/singleton.ts';
import type { RequestHandler } from './$types';

const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 6;

/**
 * Each question spawns a subprocess, which the Anthropic version did not —
 * an HTTP call costs a socket, an agent run costs a process and a chunk of
 * subscription quota. A bored child holding down Enter should not be able to
 * fork the box, so questions are capped per student per hour. Wrapped in
 * singleton() so Vite HMR re-evaluating this module in dev cannot silently
 * reset the cap, matching the daily cap in lesson/queue.ts.
 */
const MAX_QUESTIONS_PER_HOUR = 30;
const asked = singleton('ask-recent', () => new Map<string, number[]>());

/** Returns false when this student has already used their hour's budget. */
function withinRateLimit(code: string): boolean {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const times = (asked.get(code) ?? []).filter(t => t >= hourAgo);
  if (times.length >= MAX_QUESTIONS_PER_HOUR) {
    asked.set(code, times);
    return false;
  }
  times.push(Date.now());
  asked.set(code, times);
  return true;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const body = parsed as Record<string, unknown>;
  const { slug, question, history } = body ?? {};

  if (!slug || typeof slug !== 'string' || !/^[a-z0-9-]+$/i.test(slug)) {
    return json({ error: 'bad slug' }, { status: 400 });
  }

  if (!question || typeof question !== 'string') return json({ error: 'no question' }, { status: 400 });
  if (question.length > MAX_QUESTION_CHARS) return json({ error: 'question too long' }, { status: 400 });

  /* Identity check: the code alone is guessable and appears in URLs, so it
     never authorizes anything by itself. The caller must hold a session
     that already reaches this student — a parent asking about their own
     child, or the child themselves. */
  const access = locals.family ? resolveFamilyAccess(locals.family) : null;
  if (!access || !studentInScope(access, slug)) {
    return json({ error: 'אין גישה' }, { status: 401 });
  }

  // Checked after authorization, so an anonymous caller cannot learn which
  // student codes exist by watching for a 429 instead of a 401.
  if (!withinRateLimit(slug)) {
    return json({ error: 'too many questions' }, { status: 429 });
  }

  if (!engineHasCredentials()) return json({ error: 'engine not configured' }, { status: 503 });

  let student: Record<string, unknown>;
  try {
    const file = join(portalDir(), `${slug}.json`);
    student = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return json({ error: 'unknown student' }, { status: 404 });
  }

  const lessons = Array.isArray(student.lessons) ? (student.lessons as Record<string, unknown>[]) : [];
  const recentLessons = lessons
    .slice(0, 3)
    .map(l => `- ${l.date} · ${l.topic}: ${l.summary || ''}`)
    .join('\n');

  const turns: HistoryTurn[] = (Array.isArray(history) ? history : [])
    .slice(-MAX_HISTORY_TURNS)
    .filter(
      (m: unknown): m is HistoryTurn =>
        !!m &&
        typeof m === 'object' &&
        ((m as Record<string, unknown>).role === 'user' || (m as Record<string, unknown>).role === 'assistant') &&
        typeof (m as Record<string, unknown>).content === 'string',
    );

  try {
    const answer = await askAgent(
      {
        /* The first name only: the privacy page promises AI tools never get
           the family name, and a helper needs no more to address a child. */
        name: firstName(String(student.name ?? '')), level: student.level,
        subject: student.subject, tutor: student.tutor, recentLessons,
      },
      question,
      turns,
    );
    return json({ answer });
  } catch (err) {
    // The engine's own words go to the log and only to the log — the same
    // rule lesson/queue.ts follows, for the same reason. The student gets a
    // status code, and their client turns it into the WhatsApp fallback.
    const kind = err instanceof LessonGenerationError ? err.kind : 'unclassified';
    console.error(`ask failed [${kind}]`, (err as Error)?.message ?? err);
    if (err instanceof LessonGenerationError && err.detail) {
      console.error(`ask detail [${slug}]:\n${err.detail}`);
    }
    return json({ error: 'upstream error' }, { status: 502 });
  }
};
