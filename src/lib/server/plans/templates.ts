/**
 * Reviewed skill-tree templates: one per subject and track.
 *
 * These are CONFIG, not content — they live in the repo beside
 * games/registry.json, are read off process.cwd() at runtime, and are copied
 * into the image by their own COPY line in the Dockerfile. They never live
 * under DATA_DIR.
 *
 * validateTemplate() is exported separately from the loader so CI can run it
 * against the shipped files (tests/unit/plan-template-content.test.mjs). A
 * broken template must fail there, in a pull request, rather than at a tutor's
 * first click.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TemplateSkill {
  key: string;
  title: string;
  gloss?: string;
  /** Keys of skills that should come first. May cross topics. */
  requires?: string[];
}

export interface TemplateBranch { key: string; title: string; skills: TemplateSkill[] }
export interface TemplateTopic { key: string; title: string; branches: TemplateBranch[] }

export interface PlanTemplate {
  id: string;
  version: number;
  subject: string;
  track: string;
  questionnaires?: string[];
  source?: string;
  /** null until the tutor has read the tree end to end. */
  reviewed: { by: string; date: string } | null;
  /**
   * Grades this template applies to (booking's grade options, e.g. "כיתה י").
   * Absent means unconstrained — fits any grade. This is deliberately never
   * inferred from a bagrut track: the booking form only ever collects a
   * grade, never a track, so 4 vs 5 units is a separate decision a template
   * cannot make for the tutor.
   */
  grades?: string[];
  topics: TemplateTopic[];
}

const TEMPLATE_DIR = join(process.cwd(), 'templates', 'plans');

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every problem with `value`, in reading order. Empty means valid. */
export function validateTemplate(value: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(value)) return ['template is not an object'];

  for (const field of ['id', 'subject', 'track'] as const) {
    if (typeof value[field] !== 'string' || !(value[field] as string).trim()) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
    errors.push('version must be an integer');
  }
  const reviewed = value.reviewed;
  if (reviewed !== null) {
    if (!isObject(reviewed) || typeof reviewed.by !== 'string' || typeof reviewed.date !== 'string') {
      errors.push('reviewed must be null or { by, date }');
    }
  }

  // grades is optional — absent means "fits any grade", which keeps every
  // template written before this field existed valid. When present it must
  // be a non-empty array of non-empty strings; anything else is a mistake
  // rather than a template that means "no grades apply".
  if ('grades' in value && value.grades !== undefined) {
    const grades = value.grades;
    if (!Array.isArray(grades) || grades.length === 0 ||
        !grades.every(g => typeof g === 'string' && g.trim())) {
      errors.push('grades must be absent or a non-empty array of non-empty strings');
    }
  }

  const topics = value.topics;
  if (!Array.isArray(topics) || topics.length === 0) {
    errors.push('topics must be a non-empty array');
    return errors;
  }

  const keys = new Set<string>();
  const skillKeys = new Set<string>();
  const requires = new Map<string, string[]>();

  const noteKey = (key: unknown, where: string): string | null => {
    if (typeof key !== 'string' || !key.trim()) {
      errors.push(`${where}: key must be a non-empty string`);
      return null;
    }
    if (keys.has(key)) errors.push(`duplicate key ${key}`);
    keys.add(key);
    return key;
  };

  topics.forEach((topic, ti) => {
    if (!isObject(topic)) { errors.push(`topic ${ti} is not an object`); return; }
    noteKey(topic.key, `topic ${ti}`);
    if (typeof topic.title !== 'string' || !topic.title.trim()) errors.push(`topic ${ti}: title is required`);
    const branches = topic.branches;
    if (!Array.isArray(branches) || branches.length === 0) {
      errors.push(`topic ${String(topic.key)}: branches must be a non-empty array`);
      return;
    }
    branches.forEach((branch, bi) => {
      if (!isObject(branch)) { errors.push(`branch ${bi} is not an object`); return; }
      noteKey(branch.key, `branch ${bi}`);
      if (typeof branch.title !== 'string' || !branch.title.trim()) errors.push(`branch ${bi}: title is required`);
      const skills = branch.skills;
      if (!Array.isArray(skills) || skills.length === 0) {
        errors.push(`branch ${String(branch.key)}: skills must be a non-empty array`);
        return;
      }
      skills.forEach((skill, si) => {
        if (!isObject(skill)) { errors.push(`skill ${si} is not an object`); return; }
        const key = noteKey(skill.key, `skill ${si}`);
        if (typeof skill.title !== 'string' || !skill.title.trim()) errors.push(`skill ${si}: title is required`);
        if (key) {
          skillKeys.add(key);
          const req = skill.requires ?? [];
          if (!Array.isArray(req)) errors.push(`skill ${key}: requires must be an array`);
          else requires.set(key, req.map(String));
        }
      });
    });
  });

  for (const [key, req] of requires) {
    for (const target of req) {
      if (!skillKeys.has(target)) {
        errors.push(`skill ${key}: requires ${target}, which is not a skill in this template`);
      }
    }
  }

  // Depth-first cycle detection over the prerequisite edges.
  const state = new Map<string, 'open' | 'done'>();
  const walk = (key: string, trail: string[]): void => {
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'open') {
      errors.push(`prerequisite cycle: ${[...trail, key].join(' → ')}`);
      return;
    }
    state.set(key, 'open');
    for (const next of requires.get(key) ?? []) {
      if (skillKeys.has(next)) walk(next, [...trail, key]);
    }
    state.set(key, 'done');
  };
  for (const key of skillKeys) walk(key, []);

  return errors;
}

let cache: PlanTemplate[] | null = null;

/** Every valid template on disk. Invalid ones are warned about and skipped, so
 *  one broken file cannot take the page down for every other track. */
export function loadTemplates(): PlanTemplate[] {
  if (cache) return cache;
  let files: string[] = [];
  try {
    files = readdirSync(TEMPLATE_DIR).filter(f => f.endsWith('.json')).sort();
  } catch {
    console.warn(`WARNING: ${TEMPLATE_DIR} is missing — no learning-plan templates are available`);
    cache = [];
    return cache;
  }

  const out: PlanTemplate[] = [];
  for (const file of files) {
    const path = join(TEMPLATE_DIR, file);
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      const errors = validateTemplate(parsed);
      if (errors.length) {
        console.warn(`WARNING: ${path} is not a valid plan template: ${errors.join('; ')}`);
        continue;
      }
      out.push(parsed as PlanTemplate);
    } catch (e) {
      console.warn(`WARNING: ${path} could not be read: ${(e as Error).message}`);
    }
  }
  cache = out;
  return cache;
}

export function templateById(id: string): PlanTemplate | null {
  return loadTemplates().find(t => t.id === id) ?? null;
}

export function templatesForSubject(subject: string): PlanTemplate[] {
  const wanted = subject.trim();
  return loadTemplates().filter(t => t.subject === wanted);
}

/**
 * True when `template` could reasonably be offered for a student at `level`.
 *
 * A template with no `grades` is unconstrained and fits any level, including
 * a missing one. A template that does declare `grades` only fits a level
 * that, trimmed, appears in that list — a missing or blank level never
 * fits it, since there is nothing to match against.
 */
export function templateFitsLevel(template: PlanTemplate, level: string | null): boolean {
  if (!template.grades) return true;
  const trimmed = level?.trim();
  if (!trimmed) return false;
  return template.grades.map(g => g.trim()).includes(trimmed);
}
