<script lang="ts">
  /**
   * The tutor's lesson editor — spec
   * docs/superpowers/specs/2026-09-25-lesson-editor-design.md.
   *
   * She edits the PLAN (title, slides, worked examples — and on a library
   * master, the check questions and homework too), never HTML; the
   * deck the student sees is rendered from it on the server when she
   * publishes. "Save draft" and "publish" are separate buttons on purpose:
   * the safe mistake is not showing a child something, never showing them
   * something unfinished.
   */
  import { tick, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { formatDateTime } from '$lib/dates.ts';

  let { data } = $props();

  type SlideForm = { heading: string; bullets: string; note: string };
  type ExampleForm = { problem: string; steps: string; answer: string };
  type QuestionForm = { q: string; options: string[]; answer: number; why: string; hint: string };
  type HomeworkForm = { task: string; why: string; answer: string };
  type TruthsForm = { statements: string[]; lieIndex: number; why: string; hint: string };
  type HuntForm = { problem: string; steps: string[]; badStep: number; why: string; hint: string };
  type PairForm = { left: string; right: string; hint: string };

  const ORIGIN: Record<string, string> = { generated: 'נוצר', edited: 'נערך', restored: 'שוחזר' };

  let title = $state('');
  let slides = $state<SlideForm[]>([]);
  let examples = $state<ExampleForm[]>([]);
  /** Null when the plan has no quiz — there is nothing to edit then. */
  let quiz = $state<QuestionForm[] | null>(null);
  let homework = $state<HomeworkForm[]>([]);
  /* A master's other games, each null when the plan has none. */
  let twoTruths = $state<TruthsForm[] | null>(null);
  let errorHunt = $state<HuntForm[] | null>(null);
  let sequence = $state<string[] | null>(null);
  let matching = $state<PairForm[] | null>(null);
  let teacherOnly = $state('');
  let loadedVersion = $state<number | null>(null);

  let busy = $state(false);
  let message = $state('');
  let failed = $state(false);
  let previewShown = $state(false);
  let previewForm: HTMLFormElement | undefined = $state();
  let previewEdit = $state('');

  /** Fills the form from a stored version — the newest on first load, any
   *  one from history on request (spec D7: loading is not publishing). */
  function load(v: (typeof data.versions)[number]) {
    if (!v.plan) return;
    // Already shaped for the form on the server (formPlan), whatever was stored.
    title = v.plan.title;
    slides = v.plan.slides.map(s => ({ heading: s.heading, bullets: s.bullets.join('\n'), note: s.note }));
    examples = v.plan.examples.map(e => ({ problem: e.problem, steps: e.steps.join('\n'), answer: e.answer }));
    quiz = v.plan.quiz ? v.plan.quiz.map(q => ({ ...q, options: [...q.options] })) : null;
    homework = v.plan.homework.map(h => ({ ...h }));
    twoTruths = v.plan.twoTruths ? v.plan.twoTruths.map(r => ({ ...r, statements: [...r.statements] })) : null;
    errorHunt = v.plan.errorHunt ? v.plan.errorHunt.map(r => ({ ...r, steps: [...r.steps] })) : null;
    sequence = v.plan.sequence ? [...v.plan.sequence] : null;
    matching = v.plan.matching ? v.plan.matching.map(p => ({ ...p })) : null;
    teacherOnly = v.teacherOnly ?? '';
    loadedVersion = v.version;
    previewShown = false;
    confirmLoad = null;
    saved = JSON.stringify(edit());
  }

  /* Unsaved typing: what the form holds versus what was last loaded or
     saved. Loading another version over it takes a second, explicit tap,
     and leaving the page warns. */
  let saved = $state('');
  let confirmLoad = $state<number | null>(null);
  const dirty = $derived(saved !== '' && JSON.stringify(edit()) !== saved);

  function askLoad(v: (typeof data.versions)[number]) {
    if (dirty && confirmLoad !== v.version) { confirmLoad = v.version; return; }
    load(v);
  }

  function onbeforeunload(e: BeforeUnloadEvent) {
    if (dirty) e.preventDefault();
  }

  /* Seeded ONCE, deliberately untracked: after a save, invalidateAll()
     refreshes `data` for the history list, and re-seeding would throw away
     whatever she has typed since. */
  const first = untrack(() => data.versions.find(v => v.version === data.seedVersion));
  if (first) load(first);

  function edit() {
    const lines = (t: string) => t.split('\n');
    return {
      title,
      slides: slides.map(s => ({ heading: s.heading, bullets: lines(s.bullets), note: s.note })),
      examples: examples.map(e => ({ problem: e.problem, steps: lines(e.steps), answer: e.answer })),
      teacherOnly,
      /* Only a master sends them: the server refuses them for a student's
         lesson, whose games are already out. */
      ...(data.isMaster ? {
        homework: homework.map(h => ({ ...h })),
        ...(quiz !== null ? { quiz: quiz.map(q => ({ ...q, options: [...q.options] })) } : {}),
        ...(twoTruths !== null ? { twoTruths: twoTruths.map(r => ({ ...r, statements: [...r.statements] })) } : {}),
        ...(errorHunt !== null ? { errorHunt: errorHunt.map(r => ({ ...r, steps: [...r.steps] })) } : {}),
        ...(sequence !== null ? { sequence: [...sequence] } : {}),
        ...(matching !== null ? { matching: matching.map(p => ({ ...p })) } : {}),
      } : {}),
    };
  }

  /** Removing the marked option leaves none marked, for her to choose
   *  again, rather than silently marking whichever slid into its place. */
  /** Removing the marked wrong step leaves none marked, like an option. */
  function removeStep(r: HuntForm, k: number) {
    r.steps = r.steps.filter((_, j) => j !== k);
    r.badStep = r.badStep === k ? -1 : r.badStep > k ? r.badStep - 1 : r.badStep;
  }

  function removeOption(q: QuestionForm, k: number) {
    q.options = q.options.filter((_, j) => j !== k);
    q.answer = q.answer === k ? -1 : q.answer > k ? q.answer - 1 : q.answer;
  }

  /** Renders the UNSAVED edit into the frame below — a form POST that
   *  navigates the frame, not fetched HTML in a srcdoc. See
   *  src/routes/app/lessons/[slug]/preview/+server.ts for why. */
  async function showPreview() {
    previewEdit = JSON.stringify(edit());
    previewShown = true;
    await tick();
    previewForm?.requestSubmit();
  }

  async function send(type: 'save-plan' | 'publish-plan') {
    if (busy) return;
    busy = true; message = ''; failed = false;
    try {
      const r = await fetch(`/api/lessons/${data.slug}/materials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, edit: edit() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { failed = true; message = j.error ?? 'משהו השתבש — השינויים לא נשמרו'; return; }
      saved = JSON.stringify(edit());
      message = type === 'publish-plan'
        ? (data.isMaster ? 'פורסם בספרייה — שיעורים שיוזמנו מעכשיו יקבלו את הגרסה הזו' : 'פורסם — התלמיד/ה רואה עכשיו את הגרסה הזו')
        : (data.isMaster ? 'נשמר כטיוטה — הספרייה ממשיכה להשתמש בגרסה שפורסמה' : 'נשמר כטיוטה — התלמיד/ה עדיין רואה את הגרסה שפורסמה');
      await invalidateAll();
      loadedVersion = data.versions[0]?.version ?? loadedVersion;
    } catch {
      failed = true; message = 'אין חיבור — השינויים לא נשמרו';
    } finally {
      busy = false;
    }
  }

  function move<T>(list: T[], i: number, by: number): T[] {
    const j = i + by;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  }
</script>

<svelte:head><title>עריכת שיעור — מאה בקליק</title></svelte:head>
<svelte:window {onbeforeunload} />

<main class="wrap">
  <a class="back" href="/app/dashboard">→ חזרה ללוח הבקרה</a>
  <h1>עריכת שיעור</h1>
  <p class="meta">{data.lesson.student} · {data.lesson.subject ?? ''} {data.lesson.level ?? ''}</p>

  {#if data.seedVersion === null}
    <p class="empty">לשיעור הזה אין גרסה שאפשר לערוך — הוא נוצר לפני שמירת הגרסאות.</p>
  {:else}
    {#if data.pendingRegeneration !== null}
      <!-- Not loaded on purpose: publishing a regeneration over her edit is
           what recordGenerated prevents. She can choose it from the history. -->
      <p class="state">השיעור נוצר מחדש אוטומטית (גרסה {data.pendingRegeneration}) ולא פורסם, כדי לא לדרוס את העריכה שלך. הטופס מציג את הגרסה שלך; אפשר לטעון את החדשה מההיסטוריה.</p>
    {/if}
    {#if data.isMaster}
      <p class="state">שיעור מהספרייה: כל שיעור שיוזמן מעכשיו על המיומנות הזו יקבל את הגרסה שמפורסמת כאן. שיעורים שכבר נשלחו לא משתנים.</p>
    {/if}
    {#if data.unpublishedEdits}
      <p class="state">יש טיוטה שעוד לא פורסמה. התלמיד/ה רואה את הגרסה האחרונה שפורסמה.</p>
    {/if}

    <label class="field">כותרת השיעור<input dir="auto" bind:value={title} /></label>

    <h2>שקפים</h2>
    {#each slides as s, i (i)}
      <fieldset class="card">
        <legend>שקף {i + 1}</legend>
        <label class="field">כותרת<input dir="auto" bind:value={s.heading} /></label>
        <label class="field">נקודות — שורה לכל נקודה<textarea dir="auto" rows="4" bind:value={s.bullets}></textarea></label>
        <label class="field">הערה על השקף (מוצגת לתלמיד/ה)<input dir="auto" bind:value={s.note} /></label>
        <div class="row">
          <button type="button" onclick={() => (slides = move(slides, i, -1))} disabled={i === 0} aria-label="הזזת השקף למעלה">↑</button>
          <button type="button" onclick={() => (slides = move(slides, i, 1))} disabled={i === slides.length - 1} aria-label="הזזת השקף למטה">↓</button>
          <button type="button" class="danger" onclick={() => (slides = slides.filter((_, k) => k !== i))}>הסרת שקף</button>
        </div>
      </fieldset>
    {/each}
    <button type="button" class="add" onclick={() => (slides = [...slides, { heading: '', bullets: '', note: '' }])}>+ שקף</button>

    <h2>דוגמאות פתורות</h2>
    {#each examples as e, i (i)}
      <fieldset class="card">
        <legend>דוגמה {i + 1}</legend>
        <label class="field">תרגיל<input dir="auto" bind:value={e.problem} /></label>
        <label class="field">שלבים — שורה לכל שלב<textarea dir="auto" rows="3" bind:value={e.steps}></textarea></label>
        <label class="field">תשובה<input dir="auto" bind:value={e.answer} /></label>
        <div class="row">
          <button type="button" onclick={() => (examples = move(examples, i, -1))} disabled={i === 0} aria-label="הזזת הדוגמה למעלה">↑</button>
          <button type="button" onclick={() => (examples = move(examples, i, 1))} disabled={i === examples.length - 1} aria-label="הזזת הדוגמה למטה">↓</button>
          <button type="button" class="danger" onclick={() => (examples = examples.filter((_, k) => k !== i))}>הסרת דוגמה</button>
        </div>
      </fieldset>
    {/each}
    <button type="button" class="add" onclick={() => (examples = [...examples, { problem: '', steps: '', answer: '' }])}>+ דוגמה</button>

    {#if data.isMaster}
      {#if quiz !== null}
        <h2>שאלות בדיקה</h2>
        <p class="meta">החידון שבסוף השיעור. השאלה הראשונה מופיעה גם במצגת, בשקף «בדקו את עצמכם».</p>
        {#each quiz as q, i (i)}
          <fieldset class="card">
            <legend>שאלה {i + 1}</legend>
            <label class="field">שאלה<input dir="auto" bind:value={q.q} /></label>
            <fieldset class="options">
              <legend>אפשרויות — סמנו את הנכונה</legend>
              {#each q.options as _, k (k)}
                <div class="option">
                  <input type="radio" name="answer-{i}" value={k} bind:group={q.answer} aria-label="התשובה הנכונה: אפשרות {k + 1}" />
                  <input dir="auto" bind:value={q.options[k]} aria-label="אפשרות {k + 1}" />
                  <button type="button" class="danger" onclick={() => removeOption(q, k)} disabled={q.options.length <= 2} aria-label="הסרת אפשרות {k + 1}">✕</button>
                </div>
              {/each}
              <button type="button" class="add" onclick={() => (q.options = [...q.options, ''])}>+ אפשרות</button>
            </fieldset>
            <label class="field">הסבר — מוצג אחרי שעונים<input dir="auto" bind:value={q.why} /></label>
            <label class="field">רמז — מוצג רק למי שמבקש<input dir="auto" bind:value={q.hint} /></label>
            <div class="row">
              <button type="button" onclick={() => (quiz = move(quiz!, i, -1))} disabled={i === 0} aria-label="הזזת השאלה למעלה">↑</button>
              <button type="button" onclick={() => (quiz = move(quiz!, i, 1))} disabled={i === quiz!.length - 1} aria-label="הזזת השאלה למטה">↓</button>
              <button type="button" class="danger" onclick={() => (quiz = quiz!.filter((_, k) => k !== i))} disabled={quiz!.length <= 1}>הסרת שאלה</button>
            </div>
          </fieldset>
        {/each}
        <button type="button" class="add" onclick={() => (quiz = [...quiz!, { q: '', options: ['', ''], answer: -1, why: '', hint: '' }])}>+ שאלה</button>
      {/if}

      {#if twoTruths !== null}
        <h2>שתי אמיתות ושקר</h2>
        <p class="meta">בכל סבב שלושה משפטים, ואחד מהם שקרי. סמנו אותו.</p>
        {#each twoTruths as r, i (i)}
          <fieldset class="card">
            <legend>סבב {i + 1}</legend>
            <fieldset class="options">
              <legend>משפטים — סמנו את השקרי</legend>
              {#each r.statements as _, k (k)}
                <div class="option">
                  <input type="radio" name="lie-{i}" value={k} bind:group={r.lieIndex} aria-label="המשפט השקרי: משפט {k + 1}" />
                  <input dir="auto" bind:value={r.statements[k]} aria-label="משפט {k + 1}" />
                </div>
              {/each}
            </fieldset>
            <label class="field">הסבר — למה זה שקר<input dir="auto" bind:value={r.why} /></label>
            <label class="field">רמז — מוצג רק למי שמבקש<input dir="auto" bind:value={r.hint} /></label>
            <div class="row">
              <button type="button" onclick={() => (twoTruths = move(twoTruths!, i, -1))} disabled={i === 0} aria-label="הזזת הסבב למעלה">↑</button>
              <button type="button" onclick={() => (twoTruths = move(twoTruths!, i, 1))} disabled={i === twoTruths!.length - 1} aria-label="הזזת הסבב למטה">↓</button>
              <button type="button" class="danger" onclick={() => (twoTruths = twoTruths!.filter((_, k) => k !== i))} disabled={twoTruths!.length <= 1}>הסרת סבב</button>
            </div>
          </fieldset>
        {/each}
        <button type="button" class="add" onclick={() => (twoTruths = [...twoTruths!, { statements: ['', '', ''], lieIndex: -1, why: '', hint: '' }])}>+ סבב</button>
      {/if}

      {#if errorHunt !== null}
        <h2>ציד טעויות</h2>
        <p class="meta">פתרון בשלבים שיש בו שלב שגוי אחד. סמנו אותו.</p>
        {#each errorHunt as r, i (i)}
          <fieldset class="card">
            <legend>סבב {i + 1}</legend>
            <label class="field">תרגיל<input dir="auto" bind:value={r.problem} /></label>
            <fieldset class="options">
              <legend>שלבי הפתרון — סמנו את השגוי</legend>
              {#each r.steps as _, k (k)}
                <div class="option">
                  <input type="radio" name="bad-{i}" value={k} bind:group={r.badStep} aria-label="השלב השגוי: שלב {k + 1}" />
                  <input dir="auto" bind:value={r.steps[k]} aria-label="שלב {k + 1}" />
                  <button type="button" class="danger" onclick={() => removeStep(r, k)} disabled={r.steps.length <= 2} aria-label="הסרת שלב {k + 1}">✕</button>
                </div>
              {/each}
              <button type="button" class="add" onclick={() => (r.steps = [...r.steps, ''])}>+ שלב</button>
            </fieldset>
            <label class="field">הסבר — מה השגיאה<input dir="auto" bind:value={r.why} /></label>
            <label class="field">רמז — מוצג רק למי שמבקש<input dir="auto" bind:value={r.hint} /></label>
            <div class="row">
              <button type="button" onclick={() => (errorHunt = move(errorHunt!, i, -1))} disabled={i === 0} aria-label="הזזת הסבב למעלה">↑</button>
              <button type="button" onclick={() => (errorHunt = move(errorHunt!, i, 1))} disabled={i === errorHunt!.length - 1} aria-label="הזזת הסבב למטה">↓</button>
              <button type="button" class="danger" onclick={() => (errorHunt = errorHunt!.filter((_, k) => k !== i))} disabled={errorHunt!.length <= 1}>הסרת סבב</button>
            </div>
          </fieldset>
        {/each}
        <button type="button" class="add" onclick={() => (errorHunt = [...errorHunt!, { problem: '', steps: ['', ''], badStep: -1, why: '', hint: '' }])}>+ סבב</button>
      {/if}

      {#if sequence !== null}
        <h2>סידור רצף</h2>
        <p class="meta">השלבים בסדר הנכון. המשחק מערבב אותם, והתלמיד/ה מסדר/ת.</p>
        <fieldset class="card">
          <legend>שלבים</legend>
          {#each sequence as _, k (k)}
            <div class="option">
              <span class="num">{k + 1}</span>
              <input dir="auto" bind:value={sequence[k]} aria-label="שלב {k + 1}" />
              <button type="button" onclick={() => (sequence = move(sequence!, k, -1))} disabled={k === 0} aria-label="הזזת השלב למעלה">↑</button>
              <button type="button" onclick={() => (sequence = move(sequence!, k, 1))} disabled={k === sequence!.length - 1} aria-label="הזזת השלב למטה">↓</button>
              <button type="button" class="danger" onclick={() => (sequence = sequence!.filter((_, j) => j !== k))} disabled={sequence!.length <= 3} aria-label="הסרת שלב {k + 1}">✕</button>
            </div>
          {/each}
          <button type="button" class="add" onclick={() => (sequence = [...sequence!, ''])}>+ שלב</button>
        </fieldset>
      {/if}

      {#if matching !== null}
        <h2>משחק התאמה</h2>
        <p class="meta">כל זוג הוא שני צדדים שמתאימים זה לזה.</p>
        {#each matching as p, i (i)}
          <fieldset class="card">
            <legend>זוג {i + 1}</legend>
            <label class="field">צד אחד<input dir="auto" bind:value={p.left} /></label>
            <label class="field">הצד המתאים<input dir="auto" bind:value={p.right} /></label>
            <label class="field">רמז — מוצג רק למי שמבקש<input dir="auto" bind:value={p.hint} /></label>
            <div class="row">
              <button type="button" class="danger" onclick={() => (matching = matching!.filter((_, k) => k !== i))} disabled={matching!.length <= 3}>הסרת זוג</button>
            </div>
          </fieldset>
        {/each}
        <button type="button" class="add" onclick={() => (matching = [...matching!, { left: '', right: '', hint: '' }])}>+ זוג</button>
      {/if}

      {#if data.otherGames.length}
        <p class="meta">{data.otherGames.join(', ')} — נשארים כפי שנוצרו, ואי אפשר לערוך אותם כאן.</p>
      {/if}

      <h2>שיעורי בית</h2>
      {#each homework as h, i (i)}
        <fieldset class="card">
          <legend>משימה {i + 1}</legend>
          <label class="field">משימה<textarea dir="auto" rows="2" bind:value={h.task}></textarea></label>
          <label class="field">🔑 תשובון — רק לך, לא מוצג לתלמיד/ה ולא להורים<textarea dir="auto" rows="2" bind:value={h.answer}></textarea></label>
          <div class="row">
            <button type="button" onclick={() => (homework = move(homework, i, -1))} disabled={i === 0} aria-label="הזזת המשימה למעלה">↑</button>
            <button type="button" onclick={() => (homework = move(homework, i, 1))} disabled={i === homework.length - 1} aria-label="הזזת המשימה למטה">↓</button>
            <button type="button" class="danger" onclick={() => (homework = homework.filter((_, k) => k !== i))}>הסרת משימה</button>
          </div>
        </fieldset>
      {/each}
      <button type="button" class="add" onclick={() => (homework = [...homework, { task: '', why: '', answer: '' }])}>+ משימה</button>
    {/if}

    <label class="field">הערות לעצמי — לא מוצגות לתלמיד/ה ולא להורים<textarea dir="auto" rows="3" bind:value={teacherOnly}></textarea></label>

    <div class="actions">
      <button type="button" onclick={showPreview} disabled={busy}>תצוגה מקדימה</button>
      <button type="button" onclick={() => send('save-plan')} disabled={busy}>שמירת טיוטה</button>
      <button type="button" class="primary" onclick={() => send('publish-plan')} disabled={busy}>{data.isMaster ? 'פרסום בספרייה' : 'פרסום לתלמיד/ה'}</button>
    </div>
    {#if message}<p class="msg" class:bad={failed} role="status">{message}</p>{/if}

    <form bind:this={previewForm} method="POST" action="/app/lessons/{data.slug}/preview" target="lesson-preview" hidden>
      <input type="hidden" name="edit" value={previewEdit} />
    </form>
    {#if previewShown}
      <h2>תצוגה מקדימה — כך התלמיד/ה יראה/תראה את זה</h2>
      <!-- Scripts allowed, same origin NOT: the deck's own slide navigation
           runs, in an opaque origin that cannot reach this page or its
           session. Its text is escaped by renderSlides regardless. -->
      <iframe class="preview" name="lesson-preview" title="תצוגה מקדימה של המצגת" sandbox="allow-scripts"></iframe>
    {/if}

    <h2>היסטוריה</h2>
    <ul class="history">
      {#each data.versions as v (v.version)}
        <li class:current={v.version === loadedVersion}>
          <span>
            גרסה {v.version} · {ORIGIN[v.origin] ?? v.origin} · {formatDateTime(v.createdAt)}
            {#if v.version === data.liveVersion}<strong class="live">{data.isMaster ? '· בשימוש בספרייה עכשיו' : '· מוצגת לתלמיד/ה עכשיו'}</strong>{:else if v.publishedAt} · פורסמה בעבר{/if}
          </span>
          {#if v.plan}
            <button type="button" onclick={() => askLoad(v)} disabled={busy}>
              {confirmLoad === v.version ? 'לטעון בכל זאת? מה שלא נשמר יימחק' : 'טעינה לעריכה'}
            </button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if data.olderVersions}<p class="meta">ועוד {data.olderVersions} גרסאות ישנות יותר, שנשמרות אך לא מוצגות כאן.</p>{/if}
  {/if}
</main>

<style>
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; }
  .back { color: var(--accent); text-decoration: none; font-weight: 600; display: inline-block; min-height: 44px; line-height: 44px; }
  h1 { margin: 4px 0; font-size: 1.5rem; color: var(--text-primary); }
  h2 { margin: 28px 0 10px; font-size: 1.1rem; color: var(--text-primary); }
  .meta, .state, .empty { color: var(--text-muted); margin: 0 0 12px; }
  .state { color: var(--accent); font-weight: 600; }
  .field { display: grid; gap: 6px; margin: 0 0 12px; font-size: .9rem; font-weight: 600; color: var(--text-primary); }
  .field input, .field textarea {
    font: inherit; font-weight: 400; width: 100%; min-width: 0; box-sizing: border-box;
    padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary);
  }
  .card { border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-card); padding: 14px; margin: 0 0 12px; min-width: 0; }
  legend { font-weight: 700; color: var(--text-primary); padding: 0 6px; }
  .options { border: 0; padding: 0; margin: 0 0 12px; min-width: 0; }
  .options legend { padding: 0; margin-bottom: 6px; font-size: .9rem; font-weight: 600; }
  .option { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .option input[type='radio'] { width: 24px; height: 24px; flex: none; margin: 0; accent-color: var(--accent); }
  .option input:not([type='radio']) {
    font: inherit; flex: 1; min-width: 0; padding: 10px 12px;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary);
  }
  .option button { flex: none; min-width: 44px; padding: 0; }
  .num { flex: none; width: 24px; text-align: center; font-weight: 700; color: var(--text-muted); }
  .row, .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions { margin: 20px 0 8px; }
  button {
    font: inherit; min-height: 44px; padding: 0 16px; border-radius: var(--r-sm); cursor: pointer;
    border: 1px solid var(--border); background: var(--bg-card); color: var(--text-primary);
  }
  button:disabled { opacity: .5; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--btn-text, #fff); font-weight: 700; }
  button.danger { color: var(--danger); }
  button.add { margin-bottom: 8px; }
  .msg { font-weight: 600; color: var(--accent); }
  .msg.bad { color: var(--danger); }
  /* Tall enough for a whole slide on a phone: the deck's slides are 60vh. */
  .preview { width: 100%; height: min(75vh, 680px); border: 1px solid var(--border); border-radius: var(--r-md); background: #fff; }
  .history { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .history li { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-card); color: var(--text-primary); font-size: .9rem; }
  .history li.current { border-color: var(--accent); }
  .live { color: var(--accent); }
</style>
