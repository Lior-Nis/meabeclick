/**
 * What the tutor's editor may change in a lesson, and how an edit becomes
 * a lesson again.
 *
 * Spec: docs/superpowers/specs/2026-09-25-lesson-editor-design.md. She
 * edits the PLAN — title, slides, worked examples — never HTML (D1); the
 * deck is rendered from the plan on publish, so the two cannot drift (D2).
 * Games and homework stay as generated (D5): applyEdit carries them over
 * untouched rather than trusting the client to send them back — except on
 * a library master, whose check questions and homework she may rewrite
 * (docs/superpowers/specs/2026-09-28-prepared-library-design.md): no child
 * has played a master, and every booking copied from it afterwards takes
 * its published plan.
 */
import {
  renderSlides, validateLesson, type HomeworkItem, type LessonPlan, type QuizGame, type Slide, type WorkedExample,
} from './prep.ts';
import { readLessons, inTransaction } from '../db.ts';
import { addMaterial, history, type MaterialRow } from '../materials.ts';
import { isLibrarySlug } from '../library/slug.ts';

type QuizQuestion = QuizGame['questions'][number];

export interface PlanEdit {
  title: string;
  slides: Slide[];
  examples: WorkedExample[];
  /** Notes for the tutor only — stored beside the version, never rendered
   *  into the deck or served to a family (D6). */
  teacherOnly: string | null;
  /** A master's check questions and homework. Absent means "keep the
   *  plan's own", which is what every edit of a student's lesson (and
   *  every Drive edit) sends. */
  quiz?: QuizQuestion[];
  homework?: HomeworkItem[];
}

const MAX_FIELD = 2000;
const MAX_ITEMS = 40;

/** Thrown inside normalizeEdit and turned into its `ok: false` — a limit
 *  is refused with a reason, never enforced by cutting her text silently. */
class TooLong extends Error {}

const text = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (t.length > MAX_FIELD) throw new TooLong(`טקסט ארוך מדי — עד ${MAX_FIELD} תווים בשדה אחד`);
  return t;
};
const lines = (v: unknown): string[] => {
  const out = (Array.isArray(v) ? v : []).map(text).filter(Boolean);
  if (out.length > MAX_ITEMS) throw new TooLong(`יותר מדי שורות — עד ${MAX_ITEMS} ברשימה אחת`);
  return out;
};

type Result = { ok: true; edit: PlanEdit } | { ok: false; error: string };

/** Validates and trims an edit (D4). The generator's stricter shape rules
 *  are not applied: the tutor is the judge of her own lesson. */
export function normalizeEdit(input: unknown): Result {
  try {
    return check(input);
  } catch (err) {
    if (err instanceof TooLong) return { ok: false, error: err.message };
    throw err;
  }
}

function check(input: unknown): Result {
  if (!input || typeof input !== 'object') return { ok: false, error: 'עריכה לא תקינה' };
  const raw = input as Record<string, unknown>;

  const title = text(raw.title);
  if (!title) return { ok: false, error: 'צריך כותרת לשיעור' };

  if (!Array.isArray(raw.slides) || raw.slides.length === 0) return { ok: false, error: 'צריך לפחות שקף אחד' };
  if (raw.slides.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שקפים — עד ${MAX_ITEMS}` };
  const slides: Slide[] = [];
  for (const [i, s] of raw.slides.entries()) {
    const r = (s ?? {}) as Record<string, unknown>;
    const heading = text(r.heading);
    const bullets = lines(r.bullets);
    if (!heading) return { ok: false, error: `לשקף ${i + 1} אין כותרת` };
    if (!bullets.length) return { ok: false, error: `בשקף ${i + 1} אין אף נקודה` };
    const note = text(r.note);
    slides.push(note ? { heading, bullets, note } : { heading, bullets });
  }

  const rawExamples = Array.isArray(raw.examples) ? raw.examples : [];
  if (rawExamples.length > MAX_ITEMS) return { ok: false, error: `יותר מדי דוגמאות — עד ${MAX_ITEMS}` };
  const examples: WorkedExample[] = [];
  for (const [i, e] of rawExamples.entries()) {
    const r = (e ?? {}) as Record<string, unknown>;
    const problem = text(r.problem);
    const answer = text(r.answer);
    if (!problem) return { ok: false, error: `לדוגמה ${i + 1} אין תרגיל` };
    if (!answer) return { ok: false, error: `לדוגמה ${i + 1} אין תשובה` };
    examples.push({ problem, steps: lines(r.steps), answer });
  }

  const edit: PlanEdit = { title, slides, examples, teacherOnly: text(raw.teacherOnly) || null };

  if (raw.quiz !== undefined) {
    if (!Array.isArray(raw.quiz) || raw.quiz.length === 0) return { ok: false, error: 'צריך לפחות שאלה אחת בחידון' };
    if (raw.quiz.length > MAX_ITEMS) return { ok: false, error: `יותר מדי שאלות — עד ${MAX_ITEMS}` };
    edit.quiz = [];
    for (const [i, x] of raw.quiz.entries()) {
      const r = (x ?? {}) as Record<string, unknown>;
      const q = text(r.q);
      if (!q) return { ok: false, error: `לשאלה ${i + 1} אין טקסט` };
      if (!Array.isArray(r.options) || r.options.length < 2) return { ok: false, error: `לשאלה ${i + 1} צריך לפחות שתי אפשרויות` };
      if (r.options.length > MAX_ITEMS) return { ok: false, error: `יותר מדי אפשרויות בשאלה ${i + 1}` };
      const options = r.options.map(text);
      /* Refused, not dropped: dropping one would shift every later option,
         and the marked answer would silently point at a different one. */
      const blank = options.findIndex(o => !o);
      if (blank >= 0) return { ok: false, error: `באפשרות ${blank + 1} של שאלה ${i + 1} אין טקסט` };
      if (!Number.isInteger(r.answer) || (r.answer as number) < 0 || (r.answer as number) >= options.length) {
        return { ok: false, error: `בשאלה ${i + 1} לא סומנה תשובה נכונה` };
      }
      edit.quiz.push({ q, options, answer: r.answer as number, why: text(r.why), hint: text(r.hint) });
    }
  }

  if (raw.homework !== undefined) {
    if (!Array.isArray(raw.homework)) return { ok: false, error: 'שיעורי בית לא תקינים' };
    if (raw.homework.length > MAX_ITEMS) return { ok: false, error: `יותר מדי משימות — עד ${MAX_ITEMS}` };
    edit.homework = [];
    for (const [i, x] of raw.homework.entries()) {
      const r = (x ?? {}) as Record<string, unknown>;
      const task = text(r.task);
      if (!task) return { ok: false, error: `למשימה ${i + 1} אין טקסט` };
      const answer = text(r.answer);
      edit.homework.push(answer ? { task, why: text(r.why), answer } : { task, why: text(r.why) });
    }
  }

  return { ok: true, edit };
}

/**
 * A stored plan, whatever its shape, as the editor form can show it. A
 * version written by the raw `save` verb can hold anything — a null slide,
 * bullets as a string — and the page must show what it can rather than
 * fail to render.
 */
export function formPlan(raw: unknown): {
  title: string;
  slides: { heading: string; bullets: string[]; note: string }[];
  examples: { problem: string; steps: string[]; answer: string }[];
  /** Null when the plan has no quiz: there is nothing to edit, and the
   *  editor must not offer to create one. */
  quiz: { q: string; options: string[]; answer: number; why: string; hint: string }[] | null;
  homework: { task: string; why: string; answer: string }[];
} {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(str) : typeof v === 'string' && v ? [v] : []);
  const obj = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  const games = obj(r.games);
  const quiz = games.quiz && typeof games.quiz === 'object' ? obj(games.quiz) : null;
  return {
    title: str(r.title),
    slides: (Array.isArray(r.slides) ? r.slides : []).map(obj)
      .map(s => ({ heading: str(s.heading), bullets: list(s.bullets), note: str(s.note) })),
    examples: (Array.isArray(r.examples) ? r.examples : []).map(obj)
      .map(e => ({ problem: str(e.problem), steps: list(e.steps), answer: str(e.answer) })),
    quiz: quiz ? (Array.isArray(quiz.questions) ? quiz.questions : []).map(obj).map(q => ({
      q: str(q.q), options: list(q.options), why: str(q.why), hint: str(q.hint),
      answer: Number.isInteger(q.answer) ? q.answer as number : 0,
    })) : null,
    homework: (Array.isArray(r.homework) ? r.homework : []).map(obj)
      .map(h => ({ task: str(h.task), why: str(h.why), answer: str(h.answer) })),
  };
}

/** The lesson an edit describes: the base plan with title, slides and
 *  examples replaced — and the quiz's questions and the homework when the
 *  edit carries them — and everything else kept as it was. */
export function applyEdit(base: LessonPlan, edit: PlanEdit): LessonPlan {
  const plan: LessonPlan = { ...base, title: edit.title, slides: edit.slides, examples: edit.examples };
  if (edit.quiz && base.games?.quiz) plan.games = { ...base.games, quiz: { ...base.games.quiz, questions: edit.quiz } };
  if (edit.homework) plan.homework = edit.homework;
  return plan;
}

/** What renderSlides needs to know about the lesson, from its own row —
 *  the same subject, level and student the generated deck was made for. */
export function lessonMeta(slug: string): { subject: string; level: string; student: string } | null {
  const l = readLessons().find(x => x.slug === slug);
  return l ? { subject: l.subject ?? '', level: l.level ?? '', student: l.student } : null;
}

/**
 * The version the editor starts from and an edit applies to — one rule,
 * used by the page's seed and by every save, so the two cannot disagree.
 *
 * The newest version that PARSES and is either published or her own work
 * (edited, restored — a draft is her earlier work). NOT an unpublished
 * generated version: recordGenerated appends a regeneration unpublished
 * precisely so it cannot replace her edit, and starting the editor from it
 * would let one click of "publish" do exactly that. It is reported as
 * `pendingRegeneration` instead, for the page to offer.
 */
export function editBase(slug: string): {
  version: number; plan: LessonPlan; teacherOnly: string | null; pendingRegeneration: number | null;
} | null {
  const versions = history(slug, 'plan');
  const newest = versions[0];
  const pendingRegeneration = newest && newest.origin === 'generated' && !newest.published_at ? newest.version : null;
  for (const v of versions) {
    if (v.origin === 'generated' && !v.published_at) continue;
    try {
      return { version: v.version, plan: JSON.parse(v.content) as LessonPlan, teacherOnly: v.teacher_only, pendingRegeneration };
    } catch { /* a version that does not parse is skipped, not a dead end */ }
  }
  return null;
}

/**
 * The lesson an edit describes: editBase() merged with the edit. A 409 when
 * the lesson has no usable plan version (generated before #106, spec D8).
 */
export function editedPlan(slug: string, rawEdit: unknown):
  { plan: LessonPlan; teacherOnly: string | null } | { error: string; status: number } {
  const edit = normalizeEdit(rawEdit);
  if (!edit.ok) return { error: edit.error, status: 400 };
  const { quiz, homework } = edit.edit;
  if ((quiz || homework) && !isLibrarySlug(slug)) {
    return { error: 'שאלות בדיקה ושיעורי בית אפשר לערוך רק בשיעור מהספרייה — בשיעור של תלמיד/ה הם כבר נשלחו', status: 400 };
  }
  const base = editBase(slug);
  if (!base) return { error: 'לשיעור הזה אין גרסה שאפשר לערוך', status: 409 };
  if (quiz && !base.plan.games?.quiz) return { error: 'בשיעור הזה אין חידון', status: 400 };
  return { plan: applyEdit(base.plan, edit.edit), teacherOnly: edit.edit.teacherOnly };
}

/**
 * Why a plan may not be published, when the lesson is a library master:
 * every booking copied from it is checked by validateLesson and held on a
 * problem, so a master that fails the check would hold each of them. A
 * student's own lesson is not checked — she is the judge of it.
 */
export function masterProblems(slug: string, plan: LessonPlan): string[] {
  return isLibrarySlug(slug) ? validateLesson(plan) : [];
}

/**
 * Publishes a plan to the student: the plan AND the deck rendered from it,
 * both or neither — a published plan whose deck was not updated would tell
 * the tutor one thing and show the student another. The one way anything
 * publishes an edited plan: the editor's publish-plan and a Drive edit.
 */
export function publishPlan(slug: string, plan: LessonPlan, teacherOnly: string | null):
  { plan: MaterialRow; slides: MaterialRow } {
  const html = renderSlides(plan, lessonMeta(slug) ?? { subject: '', level: '' });
  return inTransaction(() => ({
    plan: addMaterial({ slug, kind: 'plan', content: JSON.stringify(plan), teacherOnly, origin: 'edited', publish: true }),
    slides: addMaterial({ slug, kind: 'slides', content: html, origin: 'edited', publish: true }),
  }));
}
