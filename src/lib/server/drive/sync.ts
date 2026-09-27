/**
 * Keeps each student's Drive folder in step with their lessons — spec
 * docs/superpowers/specs/2026-09-25-drive-student-folders-design.md D3.
 *
 * One idempotent pass, run every 10 minutes by a timer. For every
 * generated lesson with a published plan:
 *
 *   no document            → create it (and the folders on the way)
 *   gone or trashed        → recreate it from the published plan; tell her
 *   edited in Drive        → PULL: once the document has been left alone
 *                            for 10 minutes, publish it to the student
 *                            (Lior, 2026-09-26: full sync) and tell her;
 *                            push nothing over it
 *   newer published plan   → update the document
 *
 * "Edited in Drive" is decided by CONTENT, not by time alone. A moved
 * modifiedTime only says something touched the file — and Google touches a
 * freshly converted document itself, seconds after our write returns
 * (seen on production, 2026-09-25). So a moved time means: export it and
 * compare with the baseline — the hash of Drive's own export taken right
 * after our last write or read (migration 020). Same → Google's touch.
 * Different → hers, unless it still parses to exactly the version we wrote
 * (an export taken before Google settled the conversion).
 *
 * An edit that cannot be read BLOCKS the file: her text is the only copy,
 * so nothing is pushed over it until it parses or the file is replaced.
 */

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** The part of a lesson a Drive document carries, in one comparable form. */
function comparable(input: unknown): string | null {
  const r = normalizeEdit(input);
  return r.ok ? JSON.stringify({ title: r.edit.title, slides: r.edit.slides, examples: r.edit.examples }) : null;
}
import { listStudents } from '../entities.ts';
import { createHash } from 'node:crypto';
import { unambiguousLessonsForStudent } from '../lessons.ts';
import { byVersion, latestPublished } from '../materials.ts';
import { editBase, editedPlan, lessonMeta, normalizeEdit, publishPlan } from '../lesson/editing.ts';
import type { LessonPlan } from '../lesson/prep.ts';
import type { DriveApi } from './api.ts';
import { planToHtml, indexHtml, parseDriveMarkdown } from './format.ts';
import { getItem, putItem, type DriveKind } from './store.ts';

const ROOT_NAME = 'מאה בקליק — תלמידים';
/** Google Docs saves every keystroke, so a document edited less than this
 *  long ago may be half a sentence. Its edit waits for a later pass. */
const QUIET_MS = 10 * 60 * 1000;

export interface SyncResult {
  created: number; updated: number; pulled: number; recreated: number; failed: number;
}

let running = false;

export async function syncDrive(deps: {
  api: DriveApi | null;
  notify: (text: string) => Promise<void> | void;
  /** The top folder's name. Only ever overridden to prove the sync against
   *  the real Drive in a throwaway folder, away from the real one. */
  rootName?: string;
  /** The clock, for tests. */
  now?: () => number;
}): Promise<SyncResult | { skipped: string }> {
  if (!deps.api) return { skipped: 'not configured' };
  /* A timer run and a manual one overlapping would each create the same
     folders — the check-then-create below is not atomic across runs. */
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    return await pass(deps.api, deps.notify, deps.rootName ?? ROOT_NAME, deps.now ?? Date.now);
  } finally {
    running = false;
  }
}

async function pass(
  api: DriveApi, notify: (t: string) => Promise<void> | void, rootName: string, now: () => number,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, updated: 0, pulled: 0, recreated: 0, failed: 0 };
  const tell = (t: string) => Promise.resolve(notify(t)).catch(() => {});
  const site = process.env.SITE_URL ?? '';

  /** Folder ids already confirmed this pass: a pass creating many lessons
   *  would otherwise re-check the same root and student folder for each. */
  const confirmed = new Map<string, string>();

  /** A folder we own, found by key or (re)created. */
  async function folder(key: string, kind: DriveKind, name: string, parent: string | null): Promise<string> {
    const known = confirmed.get(key);
    if (known) return known;
    const id = await findOrMakeFolder(key, kind, name, parent);
    confirmed.set(key, id);
    return id;
  }

  async function findOrMakeFolder(key: string, kind: DriveKind, name: string, parent: string | null): Promise<string> {
    const item = getItem(key);
    if (item) {
      const m = await api.meta(item.fileId);
      if (m && !m.trashed) return item.fileId;
    }
    const made = await api.createFolder(name, parent);
    putItem({ key, fileId: made.id, kind, syncedVersion: null, syncedModified: made.modifiedTime });
    return made.id;
  }

  /** What Drive holds right after our own write: its time and the hash of
   *  its export — the baseline a later pass compares against. */
  async function baseline(id: string, fallbackTime: string): Promise<{ syncedModified: string; syncedHash: string }> {
    const exported = await api.exportMarkdown(id);
    const syncedModified = (await api.meta(id))?.modifiedTime ?? fallbackTime;
    return { syncedModified, syncedHash: sha(exported) };
  }

  for (const student of listStudents()) {
    const lessons = unambiguousLessonsForStudent(student.id).filter(l => l.status === 'ready');
    /* Stale when missing or trashed — checked every pass, so a trashed
       index does not wait for the next lesson change to come back. */
    const knownIndex = getItem(`index:${student.id}`);
    const indexAlive = knownIndex ? await api.meta(knownIndex.fileId).catch(() => null) : null;
    let indexStale = lessons.length > 0 && (!indexAlive || indexAlive.trashed);
    const docs: { title: string; date: string; fileId: string }[] = [];

    for (const lesson of lessons) {
      const key = `lesson:${lesson.slug}`;
      try {
        const published = latestPublished(lesson.slug, 'plan');
        if (!published) continue; // generated before plans were versioned (D7)
        const plan = JSON.parse(published.content) as LessonPlan;
        const meta = lessonMeta(lesson.slug) ?? { subject: '', level: '' };
        const title = plan.title || lesson.title || lesson.slug;
        const item = getItem(key);

        const create = async () => {
          const root = await folder('root', 'root', rootName, null);
          const dir = await folder(`student:${student.id}`, 'student', `${student.name} · ${student.code}`, root);
          const made = await api.createDoc(title, planToHtml(plan, meta), dir);
          /* Recorded at once: if anything after this throws, the next pass
             must find this document, not create a second one. */
          const fresh = { key, fileId: made.id, kind: 'lesson' as const, syncedVersion: published.version,
            syncedModified: made.modifiedTime, syncedHash: null, blocked: null };
          putItem(fresh);
          putItem({ ...fresh, ...(await baseline(made.id, made.modifiedTime)) });
          indexStale = true;
          return made.id;
        };

        if (!item) {
          docs.push({ title, date: lesson.lesson_at?.slice(0, 10) ?? '', fileId: await create() });
          result.created += 1;
          continue;
        }

        const m = await api.meta(item.fileId);
        if (!m || m.trashed) {
          docs.push({ title, date: lesson.lesson_at?.slice(0, 10) ?? '', fileId: await create() });
          result.recreated += 1;
          await tell(`📄 המסמך של "${title}" נמחק מהדרייב, ונוצר מחדש מהגרסה שפורסמה.`);
          continue;
        }
        docs.push({ title, date: lesson.lesson_at?.slice(0, 10) ?? '', fileId: item.fileId });

        if (item.syncedModified && m.modifiedTime > item.syncedModified) {
          /* Still being typed: leave it — not recorded as seen, not pushed
             over — and look again next pass. */
          if (now() - Date.parse(m.modifiedTime) < QUIET_MS) continue;
          const exported = await api.exportMarkdown(item.fileId);
          const hash = sha(exported);
          const seen = { ...item, syncedModified: m.modifiedTime, syncedHash: hash };

          if (hash !== item.syncedHash) {
            const edit = parseDriveMarkdown(exported);
            const wrote = item.syncedVersion ? byVersion(lesson.slug, 'plan', item.syncedVersion) : null;
            const unchanged = !item.blocked && wrote && comparable(edit) !== null
              && comparable(edit) === comparable(JSON.parse(wrote.content));

            if (!unchanged) {
              const merged = editedPlan(lesson.slug, { ...edit, teacherOnly: editBase(lesson.slug)?.teacherOnly ?? null });
              if ('error' in merged) {
                /* Blocked, and reported once: the time and hash are
                   recorded, so this text is not re-examined until it
                   changes — and nothing is pushed over it meanwhile. */
                putItem({ ...seen, blocked: merged.error });
                await tell(`⚠️ לא הצלחתי לקרוא את העריכה בדרייב של "${title}": ${merged.error}. שום דבר לא נשמר, והמסמך בדרייב לא יעודכן מהאתר עד שיתוקן שם.`);
                continue;
              }
              const out = publishPlan(lesson.slug, merged.plan, merged.teacherOnly);
              if (merged.plan.title && merged.plan.title !== title) {
                await api.rename(item.fileId, merged.plan.title);
                indexStale = true;
              }
              /* What Drive holds now IS what the student sees: recorded as
                 the synced version, it is not pushed back, and only a LATER
                 publish from the site (the editor) is. */
              putItem({ ...seen, syncedVersion: out.plan.version, blocked: null });
              result.pulled += 1;
              await tell(`✏️ העריכה בדרייב פורסמה לתלמיד/ה: "${title}". לצפייה ולשחזור גרסה קודמת: ${site}/app/lessons/${lesson.slug}/edit`);
              continue;
            }
          }
          // Google's own touch, or our own content settling: just record it.
          putItem(seen);
          Object.assign(item, seen);
        }

        if (item.blocked) continue; // her unreadable edit is the only copy

        if (published.version > (item.syncedVersion ?? 0)) {
          const wrote = await api.updateDoc(item.fileId, planToHtml(plan, meta));
          await api.rename(item.fileId, title);
          putItem({ ...item, syncedVersion: published.version, ...(await baseline(item.fileId, wrote.modifiedTime)) });
          result.updated += 1;
          indexStale = true;
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[drive-sync] ${key}: ${(err as Error).message}`);
      }
    }

    if (indexStale && docs.length) {
      try {
        const html = indexHtml(student.name, docs);
        const idx = getItem(`index:${student.id}`);
        const alive = idx ? await api.meta(idx.fileId) : null;
        if (idx && alive && !alive.trashed) {
          const wrote = await api.updateDoc(idx.fileId, html);
          putItem({ ...idx, syncedModified: wrote.modifiedTime });
        } else {
          const dir = await folder(`student:${student.id}`, 'student', `${student.name} · ${student.code}`,
            await folder('root', 'root', rootName, null));
          const made = await api.createDoc(`${student.name} — כל השיעורים`, html, dir);
          putItem({ key: `index:${student.id}`, fileId: made.id, kind: 'index', syncedVersion: null, syncedModified: made.modifiedTime });
        }
      } catch (err) {
        result.failed += 1;
        console.error(`[drive-sync] index:${student.id}: ${(err as Error).message}`);
      }
    }
  }
  return result;
}
