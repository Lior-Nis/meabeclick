<script lang="ts">
  /**
   * The end-of-lesson report form: one lesson, filed once and correctable
   * afterwards.
   *
   * Every write here follows the plan page's "never optimistic" rule: POST,
   * then navigate only once the server has confirmed the write. Nothing on
   * this screen is pre-ticked, and a ticked skill starts with no status —
   * a hurried submit must never record a judgement she did not make, so
   * the button stays disabled until every ticked row has one.
   */
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { STATUSES, STATUS_LABEL, type SkillStatus } from '$lib/plan-status.ts';
  import type { Suggestion } from '$lib/skill-suggestion.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Local mirror of the shape +page.server.ts hands us — same convention
  // the plan page uses, rather than importing across the server/client
  // boundary even for a type.
  interface SkillRow {
    id: number;
    title: string;
    topic: string;
    branch: string;
    /* The imported type, not a hand-copy: the engine and this form must not
       be able to disagree about the shape. See $lib/skill-suggestion.ts. */
    draft: Suggestion | null;
  }
  interface FiledEntry { title: string; status: SkillStatus }

  // The loader answers a slimmer shape (booking/student/subject/reason
  // alone) for a cancelled or not-yet-ended lesson — item 4's fix, so the
  // form itself is never even built for a lesson /api/reports would refuse
  // anyway. These default to empty rather than reading undefined fields.
  let suggested = $derived((data.reportable ? data.suggested : []) as SkillRow[]);
  let rest = $derived((data.reportable ? data.rest : []) as SkillRow[]);
  let filedEntries = $derived((data.reportable ? data.filedEntries : []) as FiledEntry[]);

  // Seeded for every skill in the plan (not just the ones on screen), so
  // opening the search disclosure later never meets an unseeded id.
  let ticked = $state<Record<number, boolean>>({});
  let statusChoice = $state<Record<number, SkillStatus | ''>>({});
  // `note` MUST have a real value on the very first render, server-side
  // included, where no $effect ever runs (same reasoning as the plan
  // page's `planRow`/`tree`/`events` seeding) — a correction opened with
  // no JS, or before hydration completes, must already show the note she
  // filed, not an empty box that only fills in once an effect runs.
  // Fix round 1, item 1: this used to be seeded only inside the $effect
  // below, so the server rendered a blank textarea and only client-side
  // hydration ever wrote the real value into it.
  let note = $state(untrack(() => (data.reportable ? data.report?.note : null) ?? ''));
  let saving = $state(false);
  let formError = $state<string | null>(null);
  let searchOpen = $state(false);
  let searchTerm = $state('');

  // Re-seeded whenever the server hands us a different lesson (a fresh
  // navigation to another /app/report/<booking>) — the same "resync from
  // the server" discipline the plan page uses for its subject switch.
  // This never runs during SSR, which is exactly why `note` above also has
  // its own synchronous initial value.
  $effect(() => {
    if (!data.reportable) return;
    const all = [...data.suggested, ...data.rest] as SkillRow[];
    ticked = Object.fromEntries(all.map(s => [s.id, false]));
    statusChoice = Object.fromEntries(all.map(s => [s.id, '']));
    note = data.report?.note ?? '';
    saving = false;
    formError = null;
    searchOpen = false;
    searchTerm = '';
  });

  let filteredRest = $derived(
    searchTerm.trim() ? rest.filter(s => s.title.includes(searchTerm.trim())) : [],
  );

  let tickedIds = $derived(
    Object.entries(ticked).filter(([, on]) => on).map(([id]) => Number(id)),
  );
  // Item 1: a lesson with no plan (no enrollment resolved, or an enrollment
  // with no plan yet) has nothing to validate a skill claim against — the
  // store refuses an entry there, so ticking one here must never reach
  // submit as though it could succeed. A note-only submit is unaffected.
  let noPlanToRecordAgainst = $derived((!data.reportable || data.planId === null) && tickedIds.length > 0);
  let canSubmit = $derived(
    !saving && !noPlanToRecordAgainst && tickedIds.every(id => !!statusChoice[id]),
  );

  function toggle(id: number) {
    ticked[id] = !ticked[id];
    if (!ticked[id]) statusChoice[id] = '';
  }

  function setStatus(id: number, e: Event) {
    statusChoice[id] = (e.currentTarget as HTMLSelectElement).value as SkillStatus | '';
  }

  /* The ONLY route from a draft into the form, and it is a click.
     
     Nothing preselects a draft and nothing ticks a skill because one
     exists. The approval gate is the feature (spec §7): a tutor confirming
     the system's opinion rather than recording her own is precisely the
     inference this work removes, and a preselected draft is that with an
     extra step. Ticking here too is deliberate — accepting a suggestion
     means "yes, record this", and leaving the row unticked would drop it
     silently at submit. */
  function acceptDraft(id: number, status: SkillStatus) {
    ticked[id] = true;
    statusChoice[id] = status;
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return iso;
    }
  }
  function fmtTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  async function submit() {
    if (!canSubmit) return;
    saving = true;
    formError = null;
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: data.booking.id,
          note: note.trim() ? note.trim() : null,
          entries: tickedIds.map(id => ({ nodeId: id, status: statusChoice[id] })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'שגיאה בשמירת הדיווח');
      // Back to the plan, with the filter that shows exactly what this
      // report just moved — she should never have to go hunting for it.
      const query = data.subject
        ? `?subject=${encodeURIComponent(data.subject)}&filter=changed`
        : '?filter=changed';
      goto(`/app/plan/${data.student.code}${query}`);
    } catch (err) {
      // Saving is never optimistic: a failure leaves the form exactly as
      // the tutor left it and shows the server's own message.
      formError = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>דיווח שיעור — {data.student.name}</title>
</svelte:head>

<main class="page">
  <a class="back" href="/app/dashboard">← לוח בקרה</a>

  <h1 class="title">
    דיווח שיעור · {data.student.name}{data.subject ? ` · ${data.subject}` : ''}
  </h1>
  <p class="lesson-time">{fmtDate(data.booking.start)} · {fmtTime(data.booking.start)}–{fmtTime(data.booking.end)}</p>

  {#if formError}
    <p class="banner error" role="alert">{formError}</p>
  {/if}

  {#if !data.reportable}
    <!-- Item 4: the loader used to check only that the booking exists, so
         a lesson cancelled after the prompt email went out (or a stale
         link opened before the lesson ends — /api/reports refuses both
         with a 400) still rendered the whole fillable form. She now finds
         out before typing anything, not after a rejected submit. -->
    <p class="no-plan">{data.reason}</p>
  {:else if data.planId === null}
    <p class="no-plan">
      אין עדיין תכנית {data.subject ? `ל${data.subject}` : ''} לתלמיד/ה הזה/ו.
      <a href="/app/plan/{data.student.code}{data.subject ? `?subject=${encodeURIComponent(data.subject)}` : ''}">
        יצירת תכנית
      </a>
    </p>
  {:else}
    {#if data.report && filedEntries.length}
      <!-- Read-only: shows what the previous filing recorded, but ticks
           nothing. Pre-ticking here would mean an unchanged re-submit
           appends a second, identical judgement to the plan's history —
           a correction should record only what she actively changes now. -->
      <p class="filed-summary">
        בדיווח הקודם: {filedEntries.map(e => `${e.title} — ${STATUS_LABEL[e.status]}`).join(' · ')}
      </p>
    {/if}

    <h2 class="section-title">מה עברתם?</h2>

    {#if suggested.length}
      <div class="skill-list">
        {#each suggested as s (s.id)}
          <div class="skill-row">
            <label class="skill-check">
              <input type="checkbox" checked={!!ticked[s.id]} onchange={() => toggle(s.id)} disabled={saving} />
              <span class="skill-text">
                <span class="skill-title">{s.title}</span>
                <span class="skill-branch">{s.branch}</span>
              </span>
            </label>
            <select
              value={statusChoice[s.id]}
              disabled={saving || !ticked[s.id]}
              onchange={(e) => setStatus(s.id, e)}
              aria-label="מצב עבור {s.title}"
            >
              <option value="">בחרו מצב</option>
              {#each STATUSES as st (st)}
                <option value={st}>{STATUS_LABEL[st]}</option>
              {/each}
            </select>
          </div>
          {#if s.draft}
            {@const d = s.draft}
            <!-- A draft from the practice already recorded. It says
                 "הצעה" in words and shows its counts, so it can be checked
                 against rows rather than believed — and so it is never
                 distinguishable from a filed status by colour alone. -->
            <div class="draft">
              <span class="draft-label">הצעה לפי תרגול: <strong>{STATUS_LABEL[d.status]}</strong></span>
              <span class="draft-why">{d.why}</span>
              <button
                type="button" class="draft-accept" disabled={saving}
                onclick={() => acceptDraft(s.id, d.status)}
              >אימוץ ההצעה</button>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <p class="empty">אין כרגע יכולות מומלצות — אפשר לחפש אחת בתכנית למטה.</p>
    {/if}

    <div class="search-block">
      <button
        type="button" class="search-toggle" aria-expanded={searchOpen}
        onclick={() => (searchOpen = !searchOpen)}
      >
        {searchOpen ? '−' : '+'} חפשו יכולת אחרת בתכנית
      </button>
      {#if searchOpen}
        <input
          class="search-input" type="text" placeholder="חיפוש יכולת…"
          bind:value={searchTerm} disabled={saving}
        />
        {#if searchTerm.trim() && filteredRest.length}
          <div class="skill-list">
            {#each filteredRest as s (s.id)}
              <div class="skill-row">
                <label class="skill-check">
                  <input type="checkbox" checked={!!ticked[s.id]} onchange={() => toggle(s.id)} disabled={saving} />
                  <span class="skill-text">
                    <span class="skill-title">{s.title}</span>
                    <span class="skill-branch">{s.topic} · {s.branch}</span>
                  </span>
                </label>
                <select
                  value={statusChoice[s.id]}
                  disabled={saving || !ticked[s.id]}
                  onchange={(e) => setStatus(s.id, e)}
                  aria-label="מצב עבור {s.title}"
                >
                  <option value="">בחרו מצב</option>
                  {#each STATUSES as st (st)}
                    <option value={st}>{STATUS_LABEL[st]}</option>
                  {/each}
                </select>
              </div>
              {#if s.draft}
                {@const d = s.draft}
                <div class="draft">
                  <span class="draft-label">הצעה לפי תרגול: <strong>{STATUS_LABEL[d.status]}</strong></span>
                  <span class="draft-why">{d.why}</span>
                  <button
                    type="button" class="draft-accept" disabled={saving}
                    onclick={() => acceptDraft(s.id, d.status)}
                  >אימוץ ההצעה</button>
                </div>
              {/if}
            {/each}
          </div>
        {:else if searchTerm.trim()}
          <p class="empty">לא נמצאה יכולת מתאימה.</p>
        {/if}
      {/if}
    </div>
  {/if}

  {#if data.reportable}
    <label class="field note-field">
      <span>הערה</span>
      <textarea
        rows="3" maxlength="2000" placeholder="הערה על השיעור (לא חובה)"
        bind:value={note} disabled={saving}
      ></textarea>
    </label>

    {#if noPlanToRecordAgainst}
      <p class="banner error" role="alert">אי אפשר לרשום יכולות בלי תכנית לימודים לשיעור הזה — אפשר לשלוח הערה בלבד.</p>
    {/if}

    <button class="submit-btn" disabled={!canSubmit} onclick={submit}>
      {saving ? 'שולח…' : (data.report ? 'תיקון הדיווח' : 'שליחת הדיווח')}
    </button>
  {/if}
</main>

<style>
  :global(body) { background: var(--bg-base); }

  .page { max-width: 640px; margin: 0 auto; padding: 1.4rem 1rem 4rem; }

  .back {
    display: inline-flex; align-items: center; min-height: 44px;
    font-size: .88rem; font-weight: 700; color: var(--text-muted);
  }
  .title { font-size: 1.2rem; font-weight: 900; color: var(--text-primary); margin: 6px 0 2px; }
  .lesson-time { font-size: .85rem; color: var(--text-muted); margin-bottom: 14px; }

  .banner { border-radius: 12px; padding: 10px 14px; font-size: .86rem; margin-bottom: 12px; }
  .banner.error { background: rgba(220,38,38,0.08); border: 1.5px solid var(--danger); color: var(--danger); }

  .no-plan {
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px;
    padding: 14px; font-size: .9rem; color: var(--text-primary); line-height: 1.7; margin-bottom: 14px;
  }
  .no-plan a { font-weight: 700; }

  .filed-summary {
    background: var(--bg-surface); border: 1.5px solid var(--border); border-radius: 12px;
    padding: 10px 12px; font-size: .84rem; color: var(--text-muted-strong); line-height: 1.6;
    margin-bottom: 12px;
  }

  .section-title { font-size: 1rem; font-weight: 800; color: var(--text-primary); margin-bottom: 8px; }
  .empty { font-size: .86rem; color: var(--text-muted); padding: 6px 2px 12px; }

  .skill-list {
    display: flex; flex-direction: column;
    background: var(--bg-card); border: 1.5px solid var(--border); border-radius: 14px;
    margin-bottom: 10px; overflow: hidden;
  }
  .skill-row {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--border);
  }
  .skill-row:last-child { border-bottom: none; }
  .skill-check {
    display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
    min-height: 44px; cursor: pointer;
  }
  .skill-check input[type='checkbox'] { width: 20px; height: 20px; flex-shrink: 0; }
  .skill-text { display: flex; flex-direction: column; min-width: 0; }
  .skill-title { font-size: .9rem; font-weight: 600; color: var(--text-primary); }
  .skill-branch { font-size: .75rem; color: var(--text-muted); }

  /* A draft, not a decision. Set apart by a dashed edge and by the word
     «הצעה» rather than by colour, so it stays legible in greyscale and to
     a colour-blind reader — the same rule the rest of the app follows for
     status. 44px tap target on the accept button, like every other control
     a tutor uses on a phone. */
  .draft {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin: 0 0 10px; padding: 8px 10px;
    border: 1px dashed var(--border); border-radius: 8px;
  }
  .draft-label { font-size: .85rem; }
  .draft-why { font-size: .8rem; color: var(--text-muted); }
  .draft-accept {
    font-family: inherit; font-size: .82rem; font-weight: 700;
    min-height: 44px; padding: 0 14px; margin-inline-start: auto;
    border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg-card); color: var(--accent); cursor: pointer;
  }
  .draft-accept:disabled { opacity: .55; cursor: default; }

  select {
    min-height: 44px; flex-shrink: 0; border: 1.5px solid var(--border-strong); border-radius: 10px;
    padding: 6px 8px; font-family: inherit; font-size: .84rem; color: var(--text-primary);
    background: var(--bg-card);
  }
  select:disabled { opacity: .55; }

  .search-block { margin-bottom: 16px; }
  .search-toggle {
    min-height: 44px; width: 100%; text-align: right; background: none; border: none;
    font-family: inherit; font-size: .85rem; font-weight: 700; color: var(--accent); cursor: pointer;
  }
  .search-input {
    width: 100%; min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 10px;
    padding: 8px 10px; font-family: inherit; font-size: .9rem; color: var(--text-primary);
    background: var(--bg-card); margin-bottom: 8px;
  }

  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
  .field span { font-size: .78rem; font-weight: 700; color: var(--text-muted); }
  .field textarea {
    min-height: 88px; border: 1.5px solid var(--border-strong); border-radius: 10px;
    padding: 8px 10px; font-family: inherit; font-size: .9rem; color: var(--text-primary);
    background: var(--bg-card); resize: vertical;
  }

  .submit-btn {
    width: 100%; min-height: 48px; border: none; border-radius: 12px;
    background: var(--accent); color: #fff; font-family: inherit; font-weight: 800;
    font-size: .95rem; cursor: pointer;
  }
  .submit-btn:disabled { opacity: .5; cursor: default; }
</style>
