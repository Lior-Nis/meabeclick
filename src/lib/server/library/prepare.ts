/**
 * Preparing the library: one master lesson per skill of a plan template,
 * generated once and used by every booking that targets that skill.
 * docs/superpowers/specs/2026-09-28-prepared-library-design.md
 *
 * A master goes through the same generator, validation and publish() as a
 * booking's lesson, so everything downstream — the editor, the preview,
 * versions — treats it as the ordinary lesson it is.
 */
import { createLesson, finishLesson, handle } from '../db.ts';
import { generateLesson, validateLesson, type LessonPlan, type LessonRequest } from '../lesson/prep.ts';
import { publish, publishDraftOnly, messageForFailure } from '../lesson/queue.ts';
import { templateById, type PlanTemplate, type TemplateSkill } from '../plans/templates.ts';
import { singleton } from '../singleton.ts';
import { setItem, itemFor, type LibraryItem } from './store.ts';
import { masterSlug } from './slug.ts';

/** What `lessons.student` says for a master: it is nobody's lesson. */
export const LIBRARY_STUDENT = 'ספרייה';

export { masterSlug, isLibrarySlug } from './slug.ts';

export interface PrepareDeps {
  generate?: (req: LessonRequest) => Promise<LessonPlan>;
  /** Who made the plan, when it is not this server's Codex: an import from
   *  the tutor's machine (/api/library/import). Recorded in lesson_engines
   *  so the gate does not count it as a Codex run. */
  engine?: 'claude' | 'opencode';
}

function findSkill(template: PlanTemplate, skillKey: string): { skill: TemplateSkill; context: string } | null {
  for (const topic of template.topics) {
    for (const branch of topic.branches) {
      const skill = branch.skills.find(s => s.key === skillKey);
      if (skill) return { skill, context: `${topic.title} — ${branch.title}` };
    }
  }
  return null;
}

/** The grade a template teaches, as the generator should hear it. */
const levelOf = (t: PlanTemplate): string => t.grades?.[0] ?? t.track;

/** Prepares one skill's master. Resolves with where it stands; never
 *  rejects for an engine failure — that is a recorded status. */
/** What the engine is asked for a skill's master — here and on the tutor's
 *  machine alike (scripts/library-local.mjs), so an imported lesson answers
 *  the same request a preparation here would have sent. */
export function libraryRequest(templateId: string, skillKey: string) {
  const template = templateById(templateId);
  if (!template) throw new Error(`no template ${templateId}`);
  const found = findSkill(template, skillKey);
  if (!found) throw new Error(`no skill ${skillKey} in ${templateId}`);
  return {
    subject: template.subject,
    level: levelOf(template),
    student: '',
    skill: found.skill.title,
    request: `${found.skill.title} (${found.context})`,
    durationMin: 90,
  };
}

export async function prepareSkill(templateId: string, skillKey: string, deps: PrepareDeps = {}): Promise<LibraryItem> {
  const meta = libraryRequest(templateId, skillKey);
  const { generate = generateLesson } = deps;

  const slug = masterSlug(templateId, skillKey);
  createLesson({ slug, student: LIBRARY_STUDENT, subject: meta.subject, level: meta.level, topic: meta.skill, lessonAt: null });
  if (deps.engine) {
    handle().prepare(`INSERT INTO lesson_engines (lesson_slug, engine, at) VALUES (?, ?, ?)`)
      .run(slug, deps.engine, new Date().toISOString());
  }
  setItem({ templateId, skillKey, slug, status: 'preparing' });

  try {
    const plan = await generate(meta);
    const problems = validateLesson(plan);
    if (problems.length) {
      await publishDraftOnly(slug, plan, meta);
      const problem = problems.join(' · ');
      finishLesson(slug, { status: 'held', title: plan.title, context: plan.gradeContext, problem });
      return setItem({ templateId, skillKey, slug, status: 'held', problem });
    }
    const published = await publish(slug, plan, meta);
    finishLesson(slug, {
      status: 'ready', title: plan.title, context: plan.gradeContext,
      slides: `lessons/${slug}/slides.html`, homework: plan.homework, games: published.games,
    });
    return setItem({ templateId, skillKey, slug, status: 'ready' });
  } catch (err) {
    const problem = messageForFailure(err);
    console.error(`[library] ${templateId}/${skillKey} failed:`, (err as Error)?.message ?? err);
    finishLesson(slug, { status: 'failed', problem });
    return setItem({ templateId, skillKey, slug, status: 'failed', problem });
  }
}

/* One engine run at a time, across every request: a topic is several
   minutes of work per skill, and the engine is shared with bookings. */
const runner = singleton('library-runner', () => ({ tail: Promise.resolve() as Promise<unknown> }));

/** Queues skills and returns when they have all been prepared. Callers that
 *  must not wait (the API) ignore the promise; tests await it. */
export function enqueue(templateId: string, skillKeys: string[], deps: PrepareDeps = {}): Promise<LibraryItem[]> {
  for (const key of skillKeys) setItem({ templateId, skillKey: key, status: 'queued' });
  const done: LibraryItem[] = [];
  const run = runner.tail.then(async () => {
    for (const key of skillKeys) done.push(await prepareSkill(templateId, key, deps));
    return done;
  });
  runner.tail = run.catch(() => {});
  return run;
}

/** A topic's skills that are not ready yet, prepared one at a time. */
export function prepareTopic(templateId: string, topicKey: string, deps: PrepareDeps = {}): Promise<LibraryItem[]> {
  const template = templateById(templateId);
  const topic = template?.topics.find(t => t.key === topicKey);
  if (!template || !topic) return Promise.reject(new Error(`no topic ${topicKey} in ${templateId}`));
  const keys = topic.branches.flatMap(b => b.skills.map(s => s.key))
    .filter(key => itemFor(templateId, key)?.status !== 'ready');
  return enqueue(templateId, keys, deps);
}
