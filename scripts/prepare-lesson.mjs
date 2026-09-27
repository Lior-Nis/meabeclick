#!/usr/bin/env node
/**
 * Prepare a lesson from the command line.
 *
 *   node scripts/prepare-lesson.mjs \
 *     --subject מתמטיקה --level "כיתה י\"א" --topic "תרגול לקראת מבחן באינטגרלים" \
 *     --student נוגה --stuck "לא יודעת מה להציב"
 *
 * Generation runs through Codex (`codex exec`), which authenticates from
 * $CODEX_HOME/auth.json — run `codex login` once on the machine you run this
 * from. This used to demand CLAUDE_CODE_OAUTH_TOKEN and refuse without it,
 * long after the Claude Code engine was removed (see engine.ts's header:
 * "the engine is Codex, and only Codex"), so a real run was blocked by a
 * variable for an engine that no longer exists while the correct check sat
 * exported and unused beside it.
 *
 * Run it where `codex` is actually installed. On the VPS that is inside the
 * app container, not the host — the host has no codex on PATH, so this
 * script cannot generate there.
 *
 * Writes to <DATA_DIR>/drafts/<slug>/ — the same place the app resolves a
 * draft to, and inside what server/backup-db.sh backs up. Nothing is
 * published to students until you copy it across.
 *
 *   --topic   the ask for this lesson, in your own words: a topic for a
 *             test, an exercise the student got stuck on, "continue from
 *             last time". Free text, never a claim about what the student
 *             did or didn't understand in a PREVIOUS lesson — it flows
 *             straight into LessonRequest.request (see prep.ts). Required,
 *             since it also names the draft folder.
 *   --stuck   optional extra detail folded into the same request text —
 *             what specifically the student is stuck on. There is no
 *             separate field for this any more (see LessonRequest.request's
 *             doc comment in prep.ts): a request is one thing, not a topic
 *             plus a diagnosis of a prior lesson.
 *   --dry     skip the model call and use a fixture, to check the plumbing
 */

import { generateLesson, saveLesson, validateLesson, renderSlides } from '../src/lib/server/lesson/prep.ts';
import { engineHasCredentials, codexHome } from '../src/lib/server/lesson/engine.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where saveLesson() writes the draft folder.
 *
 * This used to be ROOT, so drafts landed in `<checkout>/drafts/<slug>/`
 * while server/backup-db.sh backs up `data/drafts` — meaning a draft, which
 * is minutes of model work that exists nowhere else, was in no backup at
 * all, local or on Drive. The app disagreed too: content.ts resolves a
 * draft to `join(dataDir(), 'drafts', slug, file)`, so the CLI was the only
 * thing writing them anywhere else.
 *
 * DATA_DIR when set (the production case, and what the app itself reads);
 * otherwise `<checkout>/data`, NOT content.ts's bare './data' — the CLI is
 * run by hand from wherever the tutor happens to be standing, and a draft
 * should not land in a different place depending on cwd.
 */
export function draftsRoot(env = process.env) {
  return env.DATA_DIR || join(ROOT, 'data');
}

/** Parses `--flag value` pairs off argv; a flag with no following value (or
 *  one immediately followed by another flag) becomes `true`. */
export function parseArgs(argv) {
  return Object.fromEntries(
    argv.reduce((acc, a, i, arr) => {
      if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
      return acc;
    }, []));
}

/**
 * Builds the meta object the rest of the script runs on.
 *
 * `request` is what generateLesson()'s LessonRequest reads — the operator's
 * `--topic` (with `--stuck`, if given, folded in as extra detail rather than
 * kept as its own field: LessonRequest has no `notUnderstood` any more, and
 * a request is one thing, not a topic plus a diagnosis of a prior lesson —
 * see prep.ts).
 *
 * `topic` is kept as its own field too, because saveLesson() uses it — not
 * `request` — to name the draft folder (SaveLessonMeta.topic). Losing that
 * wiring is exactly the bug this function exists to prevent: before this,
 * the CLI dropped the operator's `--topic` into a field LessonRequest no
 * longer has, generateLesson() got an empty request and silently produced a
 * generic diagnostic lesson instead, and the draft folder — still slugged
 * from a `meta.topic` that never received the operator's value — carried a
 * confident, wrong label.
 */
export function buildMeta(args) {
  const request = [args.topic, args.stuck ? `תקוע/ה ב: ${args.stuck}` : null]
    .filter(Boolean)
    .join(' — ');
  return {
    subject: args.subject || 'מתמטיקה',
    level:   args.level   || 'כיתה י',
    request,
    topic:   args.topic,
    student: args.student,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = buildMeta(args);

  if (!args.topic) {
    console.error('חסר --topic\n');
    console.error('דוגמה: node scripts/prepare-lesson.mjs --topic "אינטגרלים" --level "כיתה יא" --student נוגה');
    process.exit(1);
  }

  // engine.ts owns "is it authenticated" so this and boot-checks.ts cannot
  // drift apart — which is exactly what had happened: this guard still
  // demanded the retired Claude Code token.
  if (!args.dry && !engineHasCredentials()) {
    console.error('אין פרטי התחברות ל-Codex — הריצו codex login, או השתמשו בדגל --dry\n');
    console.error(`נבדק: ${codexHome()}/auth.json\n`);
    process.exit(1);
  }

  const plan = args.dry ? fixture(meta) : await generateLesson(meta).catch(err => {
    console.error(`\n✗ ${err.message}`);
    process.exit(1);
  });

  const problems = validateLesson(plan);
  if (problems.length) {
    console.error('\n⚠ בעיות בתוכן שנוצר:');
    for (const p of problems) console.error('  · ' + p);
    console.error('  (הקבצים נשמרו בכל זאת — בדקו לפני שימוש)');
  }

  const out = await saveLesson(plan, meta, draftsRoot());

  console.log(`\n✓ ${plan.title}`);
  console.log(`  ${plan.gradeContext}`);
  console.log(`  ${plan.slides.length} שקפים · ${plan.examples.length} דוגמאות · ${plan.homework.length} משימות`);
  console.log(`\n  נשמר ב: drafts/${out.slug}/`);
  for (const f of out.files) console.log(`    ${f}`);
  console.log('\n  לפרסום: העתיקו את קבצי ה-data ל-DATA_DIR/games-data/ ואת slides.html ל-DATA_DIR/lessons/<slug>.');
}

/* Lets the whole pipeline — schema, validation, rendering, file writing — be
   exercised without spending a token or needing a key. */
function fixture(m) {
  return {
    title: `${m.topic} — שיעור`,
    gradeContext: `נלמד ב${m.level}; דורש ידע קודם באלגברה בסיסית.`,
    slides: [
      { heading: 'מה נלמד היום', bullets: ['הגדרה', 'דוגמה', 'תרגול'], note: 'שקף פתיחה' },
      { heading: 'ההגדרה',        bullets: ['נקודה ראשונה', 'נקודה שנייה', 'נקודה שלישית'] },
      { heading: 'איך מזהים',     bullets: ['סימן ראשון', 'סימן שני', 'סימן שלישי'] },
      { heading: 'טעויות נפוצות', bullets: ['טעות א', 'טעות ב'], note: 'שימו לב' },
    ],
    examples: [{ problem: 'תרגיל לדוגמה', steps: ['שלב 1', 'שלב 2'], answer: '42' }],
    homework: [
      { task: 'משחק זיכרון', why: 'לחזק שינון' },
      { task: 'ציד טעויות',  why: 'לזהות שגיאות' },
    ],
    memory: { title: `${m.topic} — זיכרון`, subject: m.subject,
      pairs: Array.from({ length: 6 }, (_, i) => ({ a: `מונח ${i + 1}`, b: `הגדרה ${i + 1}` })) },
    twoTruths: { title: `${m.topic} — אמת ושקר`, subject: m.subject,
      rounds: [{ statements: ['נכון א', 'שקר', 'נכון ב'], lieIndex: 1, why: 'הסבר' }] },
    errorHunt: { title: `${m.topic} — ציד טעויות`, subject: m.subject,
      rounds: [{ problem: 'פתרו', steps: ['שלב נכון', 'שלב שגוי', 'סיום'], badStep: 1, why: 'ההסבר' }] },
  };
}

// Only run as a CLI, not when imported by the test suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
