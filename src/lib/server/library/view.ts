/**
 * The library as the tutor's page shows it: a template's topics and
 * skills, each with its prepared item, if any.
 */
import { loadTemplates, templateById } from '../plans/templates.ts';
import { itemsForTemplate, type LibraryItem } from './store.ts';
import { dueNext, type DueSkill } from './due.ts';

export interface LibrarySkillView { key: string; title: string; item: LibraryItem | null }
export interface LibraryTopicView { key: string; title: string; skills: LibrarySkillView[] }
export interface LibraryView {
  template: { id: string; subject: string; track: string };
  templates: { id: string; track: string }[];
  topics: LibraryTopicView[];
  /** Every template's, not only this one's: the page opens on one
   *  template, and a student on another must not be missed. */
  due: DueSkill[];
}

export function libraryView(templateId: string): LibraryView | null {
  const template = templateById(templateId);
  if (!template) return null;
  const items = new Map(itemsForTemplate(templateId).map(i => [i.skillKey, i]));
  return {
    template: { id: template.id, subject: template.subject, track: template.track },
    templates: loadTemplates().map(t => ({ id: t.id, track: t.track })),
    topics: template.topics.map(topic => ({
      key: topic.key,
      title: topic.title,
      skills: topic.branches.flatMap(b => b.skills).map(s => ({ key: s.key, title: s.title, item: items.get(s.key) ?? null })),
    })),
    due: dueNext(),
  };
}

/** A topic's skill keys, or null when the template or topic does not exist. */
export function topicSkillKeys(templateId: string, topicKey: string): string[] | null {
  const topic = templateById(templateId)?.topics.find(t => t.key === topicKey);
  return topic ? topic.branches.flatMap(b => b.skills.map(s => s.key)) : null;
}

export function skillExists(templateId: string, skillKey: string): boolean {
  return !!templateById(templateId)?.topics.some(t => t.branches.some(b => b.skills.some(s => s.key === skillKey)));
}
