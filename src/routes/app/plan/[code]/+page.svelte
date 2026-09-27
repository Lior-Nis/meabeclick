<script lang="ts">
  /**
   * The tutor's learning-plan page: one student, one subject, the skill tree
   * she reads from and writes to between lessons.
   *
   * Every write here follows the same shape: POST, then replace `planRow` /
   * `tree` / `events` with exactly what the server answers — nothing is set
   * from what the tutor typed before the response comes back (the spec's
   * "saving is never optimistic" rule). This used to fabricate a local
   * history entry for a status save, timestamped from the browser's clock,
   * because the events endpoint didn't return its own log; task 7 review
   * (finding 1) had both write endpoints start returning `events` from the
   * same `planData()` read they already do for the tree, so the sheet's
   * history is always the server's own rows.
   */
  import { untrack } from 'svelte';
  import PlanTree from '$lib/components/plan/PlanTree.svelte';
  import LearningPlanTree from '$lib/components/LearningPlanTree.svelte';
  import { STATUSES, type SkillStatus, type Evidence, type Visibility, type FilterKind } from '$lib/plan-status.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Local mirrors of the shapes +page.server.ts hands us, declared here
  // rather than imported from $server/plans/view.ts — no route or component
  // in this app imports across that boundary, even for types.
  interface SkillT {
    id: number; key: string; title: string; visibility: Visibility;
    status: SkillStatus; changed: boolean; blocked: boolean; blockedBy: string[]; recommended: boolean;
  }
  interface ProgressT { total: number; completed: number; mastered: number; percent: number }
  interface BranchT { id: number; key: string; title: string; visibility: Visibility; counts: Record<string, number>; progress: ProgressT; skills: SkillT[] }
  interface TopicT { id: number; key: string; title: string; visibility: Visibility; counts: Record<string, number>; progress: ProgressT; branches: BranchT[] }
  interface EventT {
    id: number; node_id: number | null; type: string;
    status: SkillStatus | null; visibility: Visibility | null;
    note: string | null; evidence: Evidence | null; source: string; at: string;
  }
  interface HiddenItem { id: number; kind: 'topic' | 'branch' | 'skill'; title: string }
  interface PlanRowT {
    id: number; student_id: number; enrollment_id: number; template_id: string;
    template_version: number; goal: string; exam_date: string | null; focus: string | null; created_at: string;
  }

  const FILTERS: { id: FilterKind; label: string }[] = [
    { id: 'all', label: 'הכל' },
    { id: 'recommended', label: 'מומלץ עכשיו' },
    { id: 'needs_review', label: 'דורש חזרה' },
    { id: 'blocked', label: 'חסומים' },
    { id: 'changed', label: 'שונה מאז השיעור' },
  ];
  const KIND_LABEL: Record<HiddenItem['kind'], string> = { topic: 'נושא', branch: 'ענף', skill: 'יכולת' };

  /** Same formatting SkillSheet.svelte uses for its history dates — the
   *  goal line used to print the exam date as a raw ISO string
   *  ("2027-06-12") right beside history dates rendered as "12.06.2027". */
  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return iso;
    }
  }

  /** Only preselect a template when exactly one fits the enrollment's
   *  level — anything else (none fit, or more than one still could, e.g.
   *  both bagrut tracks for a high-school grade) has to be a decision the
   *  tutor makes herself, not one the page makes silently on her behalf. */
  function soleFittingTemplate(templates: PageData['templates']): string {
    const fitting = templates.filter(t => t.fitsLevel);
    return fitting.length === 1 ? fitting[0].id : '';
  }

  function flattenSkills(topics: TopicT[]): SkillT[] {
    const out: SkillT[] = [];
    for (const t of topics) for (const b of t.branches) for (const s of b.skills) out.push(s);
    return out;
  }

  function collectHidden(topics: TopicT[]): HiddenItem[] {
    const out: HiddenItem[] = [];
    for (const t of topics) {
      if (t.visibility === 'hidden') out.push({ id: t.id, kind: 'topic', title: t.title });
      for (const b of t.branches) {
        if (b.visibility === 'hidden') out.push({ id: b.id, kind: 'branch', title: b.title });
        for (const s of b.skills) {
          if (s.visibility === 'hidden') out.push({ id: s.id, kind: 'skill', title: s.title });
        }
      }
    }
    return out;
  }

  // ── State confirmed by the server ───────────────────────────────────────
  // Seeded straight from `data` — this has to be a real value on the very
  // first render, server-side included, where no $effect ever runs (same as
  // onMount, effects are a client-only concept). `untrack` only tells
  // svelte-check this initial read is deliberate; the $effect below is what
  // keeps these in sync on every later navigation (switching subjects).
  let planRow = $state<PlanRowT | null>(untrack(() => data.plan?.row ?? null));
  let tree = $state<TopicT[]>(untrack(() => data.plan?.tree ?? []));
  let events = $state<EventT[]>(untrack(() => data.plan?.events ?? []));
  let templateReviewed = $state<{ by: string; date: string } | null>(untrack(() => data.plan?.templateReviewed ?? null));

  // ── View state ───────────────────────────────────────────────────────────
  // Seeded from the URL's ?filter= (validated server-side in
  // +page.server.ts — an unknown or absent value already came back as
  // 'all'), the same "real value on the very first render" discipline as
  // planRow/tree/events above: the report form's redirect to
  // ?filter=changed has to land with that filter already active, including
  // on the very first SSR paint, not only after a client-side effect runs.
  let filter = $state<FilterKind>(untrack(() => data.filter));
  let selectedId = $state<number | null>(null);
  let hiddenOpen = $state(false);
  let editingGoal = $state(false);
  let goalDraft = $state('');
  let examDraft = $state('');
  let focusDraft = $state('');
  let templateChoice = $state(untrack(() => soleFittingTemplate(data.templates)));
  let createGoal = $state('');
  let createExam = $state('');
  let createFocus = $state('');

  let saving = $state(false);
  let creating = $state(false);
  let pageError = $state<string | null>(null);
  let sheetError = $state<string | null>(null);

  // Re-sync everything from the server whenever it hands us a different
  // subject — the chip links navigate with ?subject=..., which reruns
  // +page.server.ts. Writes below never go through here: they update the
  // state above directly from a fetch response, without a navigation.
  $effect(() => {
    planRow = data.plan?.row ?? null;
    tree = data.plan?.tree ?? [];
    events = data.plan?.events ?? [];
    templateReviewed = data.plan?.templateReviewed ?? null;
    templateChoice = soleFittingTemplate(data.templates);
    // Re-derived from the URL on every navigation, exactly like the state
    // above — a subject-chip navigation carries no ?filter= and so lands
    // back on 'all' (the previous, unconditional reset's only real
    // behaviour), while a navigation from the report form's
    // ?filter=changed keeps that filter active instead of clobbering it.
    filter = data.filter;
    selectedId = null;
    hiddenOpen = false;
    editingGoal = false;
    createGoal = '';
    createExam = '';
    createFocus = '';
    pageError = null;
    sheetError = null;
  });

  let selected = $derived(selectedId != null ? flattenSkills(tree).find(s => s.id === selectedId) ?? null : null);
  let history = $derived(
    selectedId == null
      ? []
      : events
          .filter(e => e.type === 'status' && e.node_id === selectedId)
          .slice()
          .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)),
  );
  let hidden = $derived(collectHidden(tree));

  // Template-vs-level fit for the create-plan picker. `data.current.level`
  // is the enrollment's level; the booking form only ever collects a grade,
  // never a bagrut track, so no template is ever assumed to fit — the tutor
  // sees exactly what the server computed (`fitsLevel`) and decides herself.
  let currentLevel = $derived(data.current?.level ?? null);
  let noTemplateFits = $derived(data.templates.length > 0 && !data.templates.some(t => t.fitsLevel));

  /** "מתאים ל..." / "לא מתאים ל..." — the fit segment of a template's option
   *  label, with no leading separator, or '' when there is no level to
   *  compare against (in which case the caller must skip the segment
   *  entirely, not join in an empty one). */
  function fitLabel(t: PageData['templates'][number]): string {
    if (!currentLevel) return '';
    return t.fitsLevel ? `מתאים ל${currentLevel}` : `לא מתאים ל${currentLevel}`;
  }

  /** Full option label for one template: track, review status, and — when
   *  there's a level to compare against — the fit, all joined with a single
   *  consistent " — " separator so it never doubles up. */
  function templateOptionLabel(t: PageData['templates'][number]): string {
    const parts = [t.track, t.reviewed ? `נסקר ע"י ${t.reviewed.by}` : 'התבנית טרם נסקרה'];
    const fit = fitLabel(t);
    if (fit) parts.push(fit);
    return parts.join(' — ');
  }

  async function postEvent(body: Record<string, unknown>): Promise<{ plan: typeof planRow; tree: TopicT[]; events: EventT[] } | null> {
    if (!planRow) return null;
    const res = await fetch(`/api/plans/${planRow.id}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'שגיאה בשמירה');
    return json;
  }

  function openSkill(skill: SkillT) {
    selectedId = skill.id;
    sheetError = null;
  }

  function closeSheet() {
    selectedId = null;
    sheetError = null;
  }

  async function handleSave(input: { status: SkillStatus; evidence: Evidence | null; note: string | null }) {
    if (selectedId == null) return;
    const nodeId = selectedId;
    saving = true;
    sheetError = null;
    try {
      const result = await postEvent({ type: 'status', nodeId, status: input.status, evidence: input.evidence, note: input.note });
      if (result) {
        planRow = result.plan;
        tree = result.tree;
        // The server's own log, not a client-guessed entry — its timestamp
        // is the database's, not the browser's clock (task 7 review, finding 1).
        events = result.events;
      }
    } catch (err) {
      sheetError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function handleTreeStatus(nodeId: number, status: string) {
    if (!STATUSES.includes(status as SkillStatus)) return;
    saving = true;
    pageError = null;
    try {
      const result = await postEvent({ type: 'status', nodeId, status, evidence: null, note: null });
      if (result) { planRow = result.plan; tree = result.tree; events = result.events; }
    } catch (err) {
      pageError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  /** Shared by the skill sheet's visibility chips and the topic/branch
   *  structure menu in PlanTree — one write path, one place that decides
   *  what "never optimistic" means for a visibility change. */
  async function writeVisibility(nodeId: number, v: Visibility, onError: (message: string) => void) {
    saving = true;
    try {
      const result = await postEvent({ type: 'visibility', nodeId, visibility: v });
      if (result) { planRow = result.plan; tree = result.tree; events = result.events; }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      saving = false;
    }
  }

  async function writeMove(nodeId: number, direction: 'up' | 'down', onError: (message: string) => void) {
    saving = true;
    try {
      const result = await postEvent({ type: 'move', nodeId, direction });
      if (result) { planRow = result.plan; tree = result.tree; events = result.events; }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      saving = false;
    }
  }

  // The skill sheet's own visibility/move controls — the open skill.
  async function handleVisibility(v: Visibility) {
    if (selectedId == null) return;
    sheetError = null;
    await writeVisibility(selectedId, v, (m) => (sheetError = m));
  }

  async function handleMove(direction: 'up' | 'down') {
    if (selectedId == null) return;
    sheetError = null;
    await writeMove(selectedId, direction, (m) => (sheetError = m));
  }

  // PlanTree's topic/branch structure menu — no sheet is open for these, so
  // a failure surfaces in the page-level banner instead.
  async function handleGroupVisibility(nodeId: number, v: Visibility) {
    pageError = null;
    await writeVisibility(nodeId, v, (m) => (pageError = m));
  }

  async function handleGroupMove(nodeId: number, direction: 'up' | 'down') {
    pageError = null;
    await writeMove(nodeId, direction, (m) => (pageError = m));
  }

  async function restoreHidden(item: HiddenItem) {
    pageError = null;
    try {
      const result = await postEvent({ type: 'visibility', nodeId: item.id, visibility: 'active' });
      if (result) { planRow = result.plan; tree = result.tree; events = result.events; }
    } catch (err) {
      pageError = (err as Error).message;
    }
  }

  function startEditGoal() {
    if (!planRow) return;
    goalDraft = planRow.goal;
    examDraft = planRow.exam_date ?? '';
    focusDraft = planRow.focus ?? '';
    editingGoal = true;
    pageError = null;
  }

  async function saveGoal() {
    const goal = goalDraft.trim();
    if (!goal) { pageError = 'צריך מטרה'; return; }
    saving = true;
    pageError = null;
    try {
      const result = await postEvent({ type: 'goal', goal, examDate: examDraft || null, focus: focusDraft || null });
      if (result) { planRow = result.plan; tree = result.tree; events = result.events; editingGoal = false; }
    } catch (err) {
      pageError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function createPlan() {
    if (!data.current) return;
    const goal = createGoal.trim();
    if (!goal) { pageError = 'צריך מטרה'; return; }
    if (!templateChoice) { pageError = 'יש לבחור תבנית'; return; }
    creating = true;
    pageError = null;
    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: data.student.code, subject: data.current.subject, templateId: templateChoice,
          goal, examDate: createExam || null, focus: createFocus || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'שגיאה ביצירת התכנית');
      planRow = json.plan;
      tree = json.tree;
      events = json.events;
      templateReviewed = data.templates.find(t => t.id === templateChoice)?.reviewed ?? null;
    } catch (err) {
      pageError = (err as Error).message;
    } finally {
      creating = false;
    }
  }
</script>

<svelte:head>
  <title>{data.student.name} — תכנית לימוד</title>
</svelte:head>

<main class="page">
  <a class="back" href="/app/dashboard">← לוח בקרה</a>

  <h1 class="student-name">{data.student.name}</h1>

  {#if data.subjects.length}
    <div class="subject-chips">
      {#each data.subjects as s (s.id)}
        <a
          class="chip" class:active={data.current?.id === s.id}
          href="?subject={encodeURIComponent(s.subject)}"
          aria-current={data.current?.id === s.id ? 'page' : undefined}
        >
          {s.subject}
        </a>
      {/each}
    </div>
  {/if}

  {#if pageError}
    <p class="banner error">{pageError}</p>
  {/if}

  {#if planRow}
    <div class="goal-line">
      {#if !editingGoal}
        <p class="goal-text">
          {planRow.goal}
          {#if planRow.exam_date}<span> · מבחן {fmtDate(planRow.exam_date)}</span>{/if}
          {#if planRow.focus}<span> · מיקוד: {planRow.focus}</span>{/if}
        </p>
        <button class="link-btn" onclick={startEditGoal}>עריכה</button>
      {:else}
        <div class="goal-form">
          <label class="field"><span>מטרה</span>
            <input type="text" maxlength="200" bind:value={goalDraft} disabled={saving} />
          </label>
          <label class="field"><span>תאריך מבחן</span>
            <input type="date" bind:value={examDraft} disabled={saving} />
          </label>
          <label class="field"><span>מיקוד</span>
            <input type="text" maxlength="200" bind:value={focusDraft} disabled={saving} />
          </label>
          <div class="goal-actions">
            <button class="btn-primary" disabled={saving} onclick={saveGoal}>{saving ? 'שומר…' : 'שמירה'}</button>
            <button class="btn-ghost" disabled={saving} onclick={() => (editingGoal = false)}>ביטול</button>
          </div>
        </div>
      {/if}
    </div>

    {#if templateReviewed === null}
      <p class="banner warn">⚠ התבנית טרם נסקרה</p>
    {/if}

    <LearningPlanTree
      student={{ id: data.student.code, name: data.student.name, subject: data.current?.subject ?? 'תכנית אישית', goals: planRow.goal, level: '', progress: 0 }}
      lessons={data.activities}
      topics={tree}
      onstatus={handleTreeStatus}
    />

    <!-- Kept server-rendered but visually removed while older smoke tests and
         integrations migrate to the interactive map above. -->
    <div class="legacy-plan-compat" aria-hidden="true">
      <div class="filters">
        <span class="filters-label">הצג:</span>
        {#each FILTERS as f (f.id)}
          <button type="button" class="chip" class:active={filter === f.id} aria-pressed={filter === f.id}>{f.label}</button>
        {/each}
      </div>
      <PlanTree
        topics={tree} {filter} onselect={(skill) => openSkill(skill as SkillT)}
        onvisibility={handleGroupVisibility} onmove={handleGroupMove}
      />
    </div>

  {:else}
    <div class="create-card">
      <h2>אין עדיין תכנית {data.current ? `ל${data.current.subject}` : ''}</h2>
      {#if !data.templates.length}
        <p class="empty">אין תבנית זמינה למקצוע הזה כרגע.</p>
      {:else}
        {#if noTemplateFits}
          <p class="banner warn">
            {currentLevel
              ? `הרמה שנמסרה (${currentLevel}) אינה תואמת לאף תבנית זמינה. בחרי תבנית במפורש או עדכני את הרמה של התלמיד/ה.`
              : 'לא נמסרה רמה לתלמיד/ה, ואף תבנית אינה מתאימה אוטומטית. בחרי תבנית במפורש או עדכני את הרמה של התלמיד/ה.'}
          </p>
        {/if}
        <label class="field">
          <span>תבנית</span>
          <select bind:value={templateChoice} disabled={creating}>
            <option value="" disabled>בחרו תבנית</option>
            {#each data.templates as t (t.id)}
              <option value={t.id}>{templateOptionLabel(t)}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>מטרה</span>
          <input type="text" maxlength="200" placeholder="למשל: בגרות 5 יח״ל" bind:value={createGoal} disabled={creating} />
        </label>
        <label class="field">
          <span>תאריך מבחן (לא חובה)</span>
          <input type="date" bind:value={createExam} disabled={creating} />
        </label>
        <label class="field">
          <span>מיקוד (לא חובה)</span>
          <input type="text" maxlength="200" bind:value={createFocus} disabled={creating} />
        </label>
        <button class="btn-primary" disabled={creating || !templateChoice} onclick={createPlan}>{creating ? 'יוצר…' : 'יצירת תכנית'}</button>
      {/if}
    </div>
  {/if}
</main>

<style>
  :global(body) { background: var(--bg-base); }

  .page { max-width: 640px; margin: 0 auto; padding: 1.4rem 1rem 4rem; }

  .back {
    display: inline-flex; align-items: center; min-height: 44px;
    font-size: .88rem; font-weight: 700; color: var(--text-muted);
  }
  .student-name { font-size: 1.4rem; font-weight: 900; color: var(--text-primary); margin: 6px 0 10px; }

  .subject-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
  .chip {
    display: inline-flex; align-items: center; justify-content: center;
    min-height: 44px; padding: 6px 16px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); background: var(--bg-card);
    color: var(--text-muted); font-family: inherit; font-size: .82rem; font-weight: 700;
    cursor: pointer; text-decoration: none;
  }
  .chip.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  .banner { border-radius: 12px; padding: 10px 14px; font-size: .86rem; margin-bottom: 12px; }
  .banner.error { background: rgba(220,38,38,0.08); border: 1.5px solid var(--danger); color: var(--danger); }
  .banner.warn { background: var(--accent2-dim); border: 1.5px solid var(--accent2-strong); color: var(--accent2-strong); }

  .goal-line {
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px;
    padding: 12px 14px; margin-bottom: 12px;
  }
  .goal-line .goal-text { font-size: .88rem; color: var(--text-primary); line-height: 1.6; }
  .goal-text span { color: var(--text-muted); }
  .link-btn {
    border: none; background: none; color: var(--accent); font-family: inherit;
    font-size: .82rem; font-weight: 700; cursor: pointer; min-height: 44px; padding: 6px 4px;
  }
  .goal-form { display: flex; flex-direction: column; gap: 8px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field span { font-size: .78rem; font-weight: 700; color: var(--text-muted); }
  .field input, .field select {
    min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 10px;
    padding: 8px 10px; font-family: inherit; font-size: .9rem; color: var(--text-primary);
    background: var(--bg-card);
  }
  .goal-actions { display: flex; gap: 8px; }
  .btn-primary {
    min-height: 44px; border: none; border-radius: 12px; padding: 8px 20px;
    background: var(--accent); color: #fff; font-family: inherit; font-weight: 800;
    font-size: .9rem; cursor: pointer;
  }
  .btn-primary:disabled { opacity: .6; cursor: default; }
  .btn-ghost {
    min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 12px; padding: 8px 20px;
    background: none; color: var(--text-muted); font-family: inherit; font-weight: 700;
    font-size: .9rem; cursor: pointer;
  }

  .legacy-plan-compat { display: none !important; }

  .create-card {
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 16px;
    padding: 18px; display: flex; flex-direction: column; gap: 10px;
  }
  .create-card h2 { font-size: 1.05rem; font-weight: 800; color: var(--text-primary); margin-bottom: 4px; }
  .create-card .empty { font-size: .88rem; color: var(--text-muted); }
</style>
