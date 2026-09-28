/**
 * Fires lesson generation the moment a lesson is booked.
 *
 * Deliberately does NOT block the booking response. Generation takes minutes;
 * a parent must never sit watching a spinner while an agent writes a slide
 * deck. The booking returns immediately and this runs behind it.
 *
 * This is the one job that genuinely needs the VPS — it would exceed a
 * serverless function's limit.
 */

import { israelDay, israelToday } from '../../dates.ts';
import { PLANS } from '../../plans.ts';
import { TUTOR_PHONE } from '../../contact.ts';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  generateLesson, renderSlides, validateLesson, TEMPLATE_FILES, toTemplateShape,
  type LessonPlan,
} from './prep.ts';
import { createLesson, finishLesson } from '../db.ts';
/* getStudentByCode, NOT db.ts's same-named getStudent: that one reads
   `FROM students`, the table students_v2 retired. See appendToPortal. */
import { getStudentByCode } from '../entities.ts';
import { addHomework } from '../lessons.ts';
import { targetSkillFor, linkGameToSkill, type TargetSkill } from './targeting.ts';
import { recordGenerated } from '../materials.ts';
import { portalDir } from '../paths.ts';
import { contentPath } from '../content.ts';
import { assertPathSegment } from '../urls.ts';
import { singleton } from '../singleton.ts';
import { autopilotCovers } from '../../subjects.ts';
import { transliterate } from '../enroll.ts';
import {
  LessonGenerationError, engineHasCredentials, type LessonFailureKind,
} from './engine.ts';

const MAX_PER_DAY = 20;          // a runaway form must not run up an API bill
// Wrapped in singleton() so Vite HMR re-evaluating this module in dev cannot
// silently reset the daily generation cap.
const recent = singleton('lesson-recent', () => [] as number[]);   // timestamps of generations started today

// Lessons, game data and drafts are written through contentPath(), the same
// resolver src/routes/*/+server.ts reads through — DATA_DIR, not a
// SITE_ROOT this module tracked independently. That independent tracking
// (a `SITE_ROOT` set once from server root, mirroring the still-live
// server/lesson-queue.mjs) is exactly what let the write side and the read
// side drift: this module was ported before DATA_DIR existed and kept
// writing to the pre-migration location while the read side (content.ts)
// was later defined against DATA_DIR. There is deliberately no SITE_ROOT
// left here to drift again.

export interface Booking {
  name: string;
  subject: string;
  level?: string;
  /** The parent's optional note toward this lesson — a request, never a
   *  diagnosis. See LessonRequest.request in prep.ts. */
  request?: string;
  start?: string;
  end?: string;
  /** The plan's length, as /api/book validated it. Sets the deck length. */
  durationMin?: number;
}

export interface TriggerOpts {
  notify?: (text: string) => Promise<void> | void;
  enrolledCode?: string | null;
  /** The bookings_v2 row this lesson is for. Its homework is written held
   *  under it, for the lesson report to release or replace. */
  bookingId?: number | null;
}

/** Held booking-time homework goes out on its own this long after the
 *  lesson ends, if no report has replaced it first (spec D2): inside the
 *  3-day report chase, so a same-evening report always wins. */
const HOLD_MS = 24 * 60 * 60 * 1000;

/** The longest plan this site sells. An `end` further than this after the
 *  start is not one of its lessons. Read from PLANS, not restated. */
const LONGEST_LESSON_MS = Math.max(...PLANS.map(p => p.minutes)) * 60 * 1000;

/**
 * When a lesson's held homework goes out if no report replaces it first.
 *
 * `end` is client-supplied and /api/book only checks it is present. An end
 * that is unparseable, not after the start, or further after it than any
 * plan would hide a child's homework for as long as it says — decades, for
 * `2100-01-01`. Then the start plus the longest plan stands in for it.
 * Null — shown now — when neither is usable: never held forever.
 */
export function heldUntilFor(end: string | undefined, start?: string): string | null {
  const e = end ? new Date(end).getTime() : NaN;
  const s = start ? new Date(start).getTime() : NaN;
  const endIsSane = Number.isFinite(e)
    && (!Number.isFinite(s) || (e > s && e - s <= LONGEST_LESSON_MS));
  const lessonEnd = endIsSane ? e : Number.isFinite(s) ? s + LONGEST_LESSON_MS : NaN;
  return Number.isFinite(lessonEnd) ? new Date(lessonEnd + HOLD_MS).toISOString() : null;
}

export interface TriggerResult {
  slug?: string;
  started?: boolean;
  skipped?: string;
}

/**
 * Called from the booking handler. Returns immediately; the work continues in
 * the background and is never awaited by the request.
 */
export function triggerForBooking(booking: Booking, opts: TriggerOpts = {}): TriggerResult {
  /* Not a skip: nothing went wrong. Only maths is prepared automatically,
     so for any other subject nothing is recorded — no failed lesson on the
     dashboard, no WhatsApp alarm, and no row in `lessons` to break the
     gate's run of clean generations. The tutor's booking email says the
     lesson is hers to prepare. */
  if (!autopilotCovers(booking.subject)) return { skipped: 'not maths' };

  const slug = `${slugify(booking.name)}-${slugify(booking.subject)}-${Date.now().toString(36)}`;

  // Structural pre-flight only — "has anyone configured credentials", not
  // "are they still valid". A live-but-revoked credential passes here and
  // fails inside run() as 'engine-auth', which is the same message.
  if (!engineHasCredentials()) {
    return skip(slug, booking, opts, 'no credentials', FAILURE_MESSAGES['engine-auth']);
  }

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  while (recent.length && recent[0] < dayAgo) recent.shift();
  if (recent.length >= MAX_PER_DAY) {
    return skip(slug, booking, opts, 'daily cap', 'הגעת למכסה היומית ליצירת שיעורים — השיעור לא נוצר אוטומטית');
  }
  recent.push(Date.now());

  /* Checked BEFORE generation, not after. publish() validates the slug on
     the way to disk, so an unusable one used to cost a full generation —
     minutes of work and a slice of the engine's daily quota — before
     failing. Whatever is wrong with a slug is wrong before the agent runs. */
  try {
    assertPathSegment('slug', slug);
  } catch {
    return skip(slug, booking, opts, 'unusable slug', FAILURE_MESSAGES['bad-output']);
  }

  createLesson({
    slug, student: booking.name, subject: booking.subject,
    level: booking.level, topic: booking.request || booking.subject,
    lessonAt: booking.start,
  });

  // Intentionally not awaited.
  run(slug, booking, opts).catch(err => {
    // The engine's own words go to the log and ONLY to the log — see the
    // warning on LessonGenerationError.detail.
    const kind = err instanceof LessonGenerationError ? err.kind : 'unclassified';
    console.error(`lesson-queue failed [${kind}]`, slug, err?.message ?? err);
    if (err instanceof LessonGenerationError && err.detail) {
      console.error(`lesson-queue detail [${slug}]:\n${err.detail}`);
    }
    const problem = messageForFailure(err);
    finishLesson(slug, { status: 'failed', problem });
    notify(opts, `⚠️ ${problem} (${slug})`).catch(() => {});
  });

  return { slug, started: true };
}

/**
 * What the tutor is told, keyed by what actually broke.
 *
 * These strings are the ONLY thing allowed onto `lessons.problem`. That
 * column is served over HTTP (see src/routes/api/lessons/+server.ts, tutor
 * session required — it was unauthenticated until the leak was closed).
 * Fixed copy, no interpolation: the engine's own output can carry paths,
 * config and echoed prompt content, and it goes to the server log instead,
 * so this holds even if that route's guard is ever weakened again.
 *
 * Distinguishing them is the entire point. Every one of these previously
 * rendered as "שגיאה טכנית ביצירת השיעור" — so a cancelled subscription, a
 * missing binary and a malformed plan were one indistinguishable sentence on
 * the dashboard, and the tutor had no way to know which of them she was
 * looking at, or that the answer was "renew a subscription".
 */
const FAILURE_MESSAGES: Record<LessonFailureKind, string> = {
  'engine-missing': 'מנוע יצירת השיעורים אינו מותקן על השרת — יש לבדוק את ההתקנה',
  'engine-auth':    'פג תוקף החיבור למנוע יצירת השיעורים — יש לחדש את ההרשאה בשרת',
  'engine-quota':   'נגמרה המכסה ליצירת שיעורים אוטומטית — השיעור לא נוצר. אפשר לנסות שוב מאוחר יותר',
  'engine-timeout': 'יצירת השיעור ארכה זמן רב מדי ונעצרה — אפשר לנסות שוב',
  'engine-failed':  'מנוע יצירת השיעורים נכשל — יש לבדוק את יומן השרת',
  'no-output':      'מנוע יצירת השיעורים לא החזיר שיעור — יש לבדוק את יומן השרת',
  'bad-output':     'השיעור שנוצר חזר בפורמט לא תקין ולא נשמר — יש לבדוק את יומן השרת',
};

/** Fixed copy, like FAILURE_MESSAGES above, because it lands on
 *  `lessons.problem` too. */
const NOT_DELIVERED = 'אבל הוא לא נוסף לדף האישי של התלמיד/ה, ולכן לא נראה להם. יש לבדוק את יומן השרת.';

/** Exported for tests: the mapping is the load-bearing part, and it must
 *  hold for a plain Error too — a bug anywhere in run() lands here. */
export function messageForFailure(err: unknown): string {
  if (err instanceof LessonGenerationError) return FAILURE_MESSAGES[err.kind];
  return 'שגיאה טכנית ביצירת השיעור — יש לבדוק את יומן השרת';
}

/** A booking that never got a lesson attempt — still gets a DB row and a
 *  WhatsApp ping, so it's never silently invisible on the dashboard. */
function skip(slug: string, booking: Booking, opts: TriggerOpts, reasonKey: string, message: string): TriggerResult {
  console.warn(`lesson-queue: ${reasonKey}, skipping`, slug);
  createLesson({
    slug, student: booking.name, subject: booking.subject,
    level: booking.level, topic: booking.request || booking.subject,
    lessonAt: booking.start,
  });
  finishLesson(slug, { status: 'failed', problem: message });
  notify(opts, `⚠️ ${message}`).catch(() => {});
  return { skipped: reasonKey };
}

interface RunMeta {
  subject: string;
  level: string;
  student: string;
  /** Passed straight through to LessonRequest.request — see its doc
   *  comment in prep.ts for why there is no `topic` fallback here. */
  request?: string;
  /** The plan skill this lesson should teach, by TITLE. Chosen here from
   *  the tutor's plan, never by the model — see lesson/targeting.ts. Absent
   *  for the ordinary case of a student with no plan, and the generator is
   *  then told nothing about skills at all. */
  skill?: string;
  durationMin?: number;
}

async function run(slug: string, booking: Booking, opts: TriggerOpts): Promise<void> {
  /* Resolved BEFORE generation, because the title goes into the prompt and
     the id is what the resulting rows are tagged with. Null for a student
     with no plan, which is almost everyone today: the lesson is then
     generated exactly as before and simply produces no evidence link. */
  const target: TargetSkill | null = targetSkillFor(opts.enrolledCode ?? null, booking.subject);

  const meta: RunMeta = {
    subject: booking.subject,
    level:   booking.level ?? '',
    student: booking.name,
    request: booking.request,
    skill:   target?.title,
    durationMin: booking.durationMin,
  };

  const plan = await generateLesson(meta);

  // Structurally broken material is held rather than published — a game with
  // badStep out of range would break in a child's hands.
  const problems = validateLesson(plan);
  if (problems.length) {
    await publishDraftOnly(slug, plan, meta);
    finishLesson(slug, {
      status: 'held', title: plan.title, context: plan.gradeContext,
      problem: problems.join(' · '),
    });
    await notify(opts, `⚠️ שיעור נוצר אך נעצר לבדיקה — ${plan.title}\n${problems.join('\n')}`);
    return;
  }

  const published = await publish(slug, plan, meta);

  /* The return value is not decoration. A lesson that generated perfectly
     but never reached the portal file is invisible to the student and to
     the tutor — which is precisely how the legacy-table lookup (see
     appendToPortal) went unnoticed while four lessons were paid for and
     shown to nobody.

     Delivered BEFORE the row is finished, so the row can say whether it
     arrived. It used to be finished first, as a bare `ready`, and the
     failure lived only in the WhatsApp message and the server log: the
     dashboard showed the lesson as fine, and the p1 gate
     (scripts/vision-metrics.mjs) counted a lesson no child ever saw as a
     clean run. The status stays `ready` because the material is real and
     its slides render; `problem` is what records the missing delivery. */
  const onPortal = await appendToPortal(opts.enrolledCode ?? null, plan, published, target, {
    bookingId: opts.bookingId ?? null, heldUntil: heldUntilFor(booking.end, booking.start),
    lessonDate: booking.start ? israelDay(booking.start) : null,
  });
  if (!onPortal) {
    console.error(
      `[lesson-queue] ${slug}: generated, but not added to a portal `
      + `(enrolledCode=${opts.enrolledCode ?? 'null'}) — the student cannot see it`,
    );
  }

  finishLesson(slug, {
    status: 'ready', title: plan.title, context: plan.gradeContext,
    slides: `lessons/${slug}/slides.html`, homework: plan.homework, games: published.games,
    problem: onPortal ? null : NOT_DELIVERED,
  });

  await notify(opts, onPortal
    ? `✅ שיעור חדש מוכן — ${plan.title}\n${plan.gradeContext}`
    : `⚠️ שיעור חדש מוכן — ${plan.title}\n${plan.gradeContext}\n${NOT_DELIVERED}`);
}

interface PublishedGame {
  title: string;
  template: string;
  dataId: string;
}

interface Published {
  slug: string;
  games: PublishedGame[];
}

/**
 * Writes slides and game data where the routes in src/routes read them
 * from. Exported (in addition to being called by run(), above) so
 * tests/unit/queue-content.test.mjs can exercise the real write path
 * directly, without paying for a live lesson generation, and assert it
 * agrees with readContent() — the two having independently drifted apart
 * once already is the whole reason this function takes a contentPath
 * instead of a directory it computed itself.
 */
export async function publish(slug: string, plan: LessonPlan, meta: RunMeta): Promise<Published> {
  /* Games FIRST, before the slides: they are the part that must never be
     overwritten (see the 'wx' below), so a refused republish stops here
     having touched nothing.

     Whichever templates the plan chose — the catalog is open to the generator,
     so a lesson gets the games that suit its material rather than a fixed three. */
  const games: PublishedGame[] = [];
  for (const [key, data] of Object.entries(plan.games ?? {})) {
    const template = TEMPLATE_FILES[key];
    if (!template || !data) continue;
    const dataId = `${slug}-${template}`;
    const dataPath = contentPath('games-data', dataId);
    await mkdir(dirname(dataPath), { recursive: true });
    /* 'wx': never overwrite. A result in results_v2 names its game by
       dataId, and this file is the only record of which questions were
       asked — rewriting it would silently re-point every earlier answer at
       questions the child never saw. Changing a game means a new dataId.
       Slugs carry a timestamp, so a collision means a bug; it throws and
       run() records the lesson as failed rather than quietly clobbering. */
    await writeFile(dataPath, JSON.stringify(toTemplateShape(key, data), null, 2), { encoding: 'utf8', flag: 'wx' });
    // Records store facts, not URLs — the URL is derived at render time by
    // src/lib/server/urls.ts (gameUrl), never baked in here. Baking it here
    // would persist routing decisions into portal/lessons data again, which
    // is exactly the bug this shape change closes.
    games.push({ title: data.title, template, dataId });
  }

  const slidesHtml = renderSlides(plan, meta);
  const slidesPath = contentPath('lessons', slug);
  await mkdir(dirname(slidesPath), { recursive: true });
  await writeFile(slidesPath, slidesHtml, 'utf8');

  /* And into the versioned store, which is what makes materials.ts's two
     opening rules true rather than merely stated. Until now that table had
     one consumer — the tutor's own editor API — while this function wrote
     the file the student reads, so a regeneration silently overwrote her
     correction.
  
     recordGenerated keeps the new version either way and declines to make
     it publishable when she has edited. The file above is still written
     because every lesson generated before migration 012 is served from
     disk, and the route falls back to it. */
  recordGenerated(slug, { slides: slidesHtml, plan: JSON.stringify(plan) });

  return { slug, games };
}

export async function publishDraftOnly(slug: string, plan: LessonPlan, meta: RunMeta): Promise<void> {
  const slidesPath = contentPath('drafts', slug, 'slides.html');
  const planPath   = contentPath('drafts', slug, 'lesson.json');
  await mkdir(dirname(slidesPath), { recursive: true });
  await writeFile(slidesPath, renderSlides(plan, meta), 'utf8');
  await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8');
}

/**
 * Adds the lesson to the student's portal file so it shows on their own page.
 * Takes the student `code` directly — the same code enrollFromBooking()
 * already resolved for this booking (by phone, or explicitly by name +
 * password for a returning parent). Re-deriving identity here independently
 * (by phone, or by name) previously caused two different bugs: it could
 * disagree with what enrollment decided, or collide across students who
 * shared a name.
 *
 * The lookup MUST be entities.ts's getStudentByCode. db.ts exports a
 * function of the same name that reads `FROM students` — the table the
 * students_v2 migration retired — and this used to call that one. On
 * production at 2026-09-21 the legacy table held three rows and students_v2
 * held seven, so every student enrolled since the migration resolved to
 * null, this returned false, and the caller dropped it.
 *
 * What that cost: four lessons generated at minutes of billed agent time
 * each, slides.html and game data on disk, `status: ready` in the database
 * — and every portal file holding `lessons: [], homework: [], games: []`,
 * which is the only place /api/portal/[code] reads those three from. The
 * tutor and the student both saw an empty page and nothing reported a
 * failure. db.ts already carries a warning about this exact two-functions-
 * one-name hazard for getBest; this is the same trap, sprung.
 *
 * Exported so it can be tested directly against a student that exists in
 * students_v2 and not in the legacy table — production's actual shape.
 */
export async function appendToPortal(
  code: string | null, plan: LessonPlan, published: Published,
  target: TargetSkill | null = null,
  /** Booking-time homework is held for its lesson (migration 018). */
  hold: { bookingId: number | null; heldUntil: string | null; lessonDate?: string | null } = { bookingId: null, heldUntil: null },
): Promise<boolean> {
  const student = code ? getStudentByCode(code) : null;
  if (!student) return false;

  const path = join(portalDir(), `${student.code}.json`);
  let data: any;
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch { return false; }

  data.games = [...published.games, ...(data.games ?? [])].slice(0, 20);

  /* Homework goes to the `homework` TABLE, not into this file.
     
     It used to go only here, and homework the tutor typed went only to the
     table, so neither kind worked end to end: she could not see or mark a
     generated task, and the student could not see one she had typed.
     Verified before changing it — a task added through the dashboard came
     back from /api/students/<code>/activity and was absent from
     /api/portal/<code>.
     
     The table is the better home for a second reason: it DERIVES `done`
     from the student's own game results, matched per student, which a flat
     array in a JSON file cannot do. */
  /* Generated homework is OFFLINE work, and carries no game.
   
     Every task used to be given published.games[0] — the first game in the
     lesson, whatever the task said. Verified against real Codex output on
     2026-09-22: all four tasks were written exercises ("מחיר מעיל 300 ש״ח,
     הנחה של 20% ואז 10%…") and all four pointed at the matching game. So
     finishing the quiz ticked nothing, finishing matching would have ticked
     all four at once, and the student page rendered four "התחילו" buttons
     that all led to the same unrelated game.
   
     The link is removed rather than repaired, because no play event can
     legitimately complete a pen-and-paper exercise. The lesson's games are
     still published and still reachable: the student page has its own Games
     section, which is where a game belongs. An explicitly game-backed
     assignment is a different feature, and it needs the generator to be
     ASKED which task a game completes — it never has been. */
  for (const h of plan.homework) {
    addHomework({
      studentId: student.id, task: h.task, template: null, dataId: null,
      /* The skill the lesson was generated for. Null when the student has
         no plan — "not evidence about any skill", which the suggestion
         engine must read as silence rather than as a zero. */
      nodeId: target?.id ?? null,
      bookingId: hold.bookingId, heldUntil: hold.heldUntil,
    });
  }

  /* The lesson's games are published separately and are NOT homework rows
     (generated homework is offline work, carrying no data_id — see the
     comment above). So their link to a skill lives in its own table, keyed
     per student because a data id identifies a game, not a child's copy of
     one. */
  if (target) {
    for (const g of published.games) linkGameToSkill(student.id, g.dataId, target.id);
  }

  data.lessons = [
    /* The LESSON's date, and no summary: generation runs at booking time,
       and gradeContext is a note for the tutor. The family's page shows
       this as coming until the date passes (FamilyLesson.upcoming). */
    { date: hold.lessonDate ?? today(), topic: plan.title, slug: published.slug },
    ...(data.lessons ?? []),
  ].slice(0, 20);
  data.updated = today();

  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  return true;
}

async function notify(opts: TriggerOpts, text: string): Promise<void> {
  if (typeof opts.notify === 'function') {
    await Promise.resolve(opts.notify(text)).catch(() => {});
  } else {
    console.log('[lesson-queue] ' + text.replace(/\n/g, ' | '));
  }
}

const DEFAULT_PHONE = TUTOR_PHONE;

/** Sends a WhatsApp message to the tutor via CallMeBot — same mechanism
 *  already used by api/remind.js. Reused here as the real notify()
 *  implementation instead of the silent console.log fallback. */
export async function sendWhatsApp(text: string): Promise<void> {
  const phone  = process.env.CALLMEBOT_PHONE || DEFAULT_PHONE;
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) {
    console.warn('lesson-queue: CALLMEBOT_API_KEY not set, cannot WhatsApp:', text.replace(/\n/g, ' | '));
    return;
  }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
    const r = await fetch(url);
    const body = await r.text();
    if (!r.ok || body.includes('ERROR')) {
      console.error('lesson-queue: CallMeBot error:', body);
    }
  } catch (err: any) {
    console.error('lesson-queue: CallMeBot request failed:', err.message);
  }
}

const today   = (): string => israelToday();
/**
 * A lesson slug, guaranteed to be a legal path segment.
 *
 * This used to keep `\p{L}` — ANY letter — which on a Hebrew tutoring service
 * means every real student's name went into the slug in Hebrew. urls.ts
 * enforces /^[a-z0-9-]+$/ on path segments, so publish() threw "urls: invalid
 * slug" for essentially every booking: the lesson generated, spent the
 * engine's quota, and died on the way to disk. The one production lesson
 * that ever ran before this was a Latin-named test.
 *
 * Hebrew is transliterated rather than dropped, reusing enroll.ts's map so
 * there is one transliteration in the codebase and not two. A slug is only
 * ever cosmetic — the trailing timestamp is what makes it unique — so a name
 * that transliterates to nothing degrades to 'lesson' rather than failing.
 */
/** Exported under a test-only name so the slug rules can be pinned directly
 *  rather than inferred from a booking's side effects. */
export const slugifyForTest = (s: unknown): string => slugify(s);

const slugify = (s: unknown): string => {
  const raw = String(s ?? '').trim().toLowerCase();
  const ascii = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const base = ascii || transliterate(raw);
  // Belt and braces: whatever the inputs, what leaves here matches
  // urls.ts's PATH_SEGMENT. Nothing downstream re-checks before use.
  return base.replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'lesson';
};
