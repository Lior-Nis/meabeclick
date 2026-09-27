<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  /**
   * The one place a tutor records what a student can do.
   *
   * Opens over whichever skill PlanTree.svelte selected. Owns nothing about
   * the network: every button here calls back into the page, which does the
   * actual POST and replaces this component's `skill`/`history` props with
   * whatever the server confirms — see +page.svelte's "never optimistic"
   * writes. That is also why the status/evidence/note draft resets on every
   * prop change: a fresh `skill` object means either a different skill was
   * opened, or this one's status just came back from a successful save, and
   * either way the draft should reflect the server's current truth rather
   * than what the tutor typed a moment ago.
   */
  import {
    STATUSES, STATUS_LABEL, EVIDENCE_LABEL, VISIBILITY_LABEL,
    type SkillStatus, type Evidence, type Visibility,
  } from '$lib/plan-status.ts';

  interface Skill {
    id: number; key: string; title: string; visibility: Visibility;
    status: SkillStatus; changed: boolean; blocked: boolean; blockedBy: string[]; recommended: boolean;
  }
  interface HistoryEntry {
    id: number; status: SkillStatus | null; evidence: Evidence | null; note: string | null; at: string;
  }

  let {
    skill, history, saving = false, error = null,
    onsave, onvisibility, onmove, onclose,
  }: {
    skill: Skill;
    history: HistoryEntry[];
    saving?: boolean;
    error?: string | null;
    onsave: (input: { status: SkillStatus; evidence: Evidence | null; note: string | null }) => void;
    onvisibility: (v: Visibility) => void;
    onmove: (direction: 'up' | 'down') => void;
    onclose: () => void;
  } = $props();

  // Seeded and re-armed entirely by the $effect below — see its comment —
  // rather than read from `skill` here, which svelte-check flags as
  // capturing only the initial prop value.
  let status = $state<SkillStatus>('not_checked');
  let evidence = $state<Evidence | ''>('');
  let note = $state('');

  // Re-arm the draft on IDENTITY, not on object churn. `skill` is a fresh
  // object out of the page's tree on every write's response — a visibility
  // or move on THIS skill refreshes the tree (and so `skill`) without
  // touching its status, and re-arming there would wipe a note the tutor
  // is mid-typing while the sheet is still open (task 7 whole-branch
  // review, finding 2). Only two things should ever reset the draft: a
  // different skill opened (`skill.id` changes), or a new status event
  // landing for this one (the newest entry at the top of `history` — kept
  // newest-first by the page — changes id).
  let lastSkillId = $state<number | null>(null);
  let lastHistoryTopId = $state<number | null>(null);
  $effect(() => {
    const topId = history[0]?.id ?? null;
    if (skill.id === lastSkillId && topId === lastHistoryTopId) return;
    status = skill.status;
    evidence = '';
    note = '';
    lastSkillId = skill.id;
    lastHistoryTopId = topId;
  });

  function save() {
    onsave({ status, evidence: evidence || null, note: note.trim() ? note.trim() : null });
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
      return iso;
    }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />

<div class="backdrop" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <!-- aria-modal, not a focus trap — the trap is deliberately deferred
       (task 7 whole-branch review, finding 8). -->
  <div class="sheet" role="dialog" aria-modal="true" aria-label={skill.title}>
    <div class="head">
      <h3>{skill.title}</h3>
      <button class="icon-btn" onclick={onclose} aria-label="סגירה"><Icon name="close" size={16} /></button>
    </div>

    {#if skill.changed}
      <p class="note-line changed">● השתנה מאז השיעור האחרון</p>
    {/if}
    {#if skill.blocked}
      <p class="note-line blocked">🔒 חסום על ידי: {skill.blockedBy.join(', ')}</p>
    {/if}

    {#if error}
      <p class="banner error">{error}</p>
    {/if}

    <div class="statuses">
      {#each STATUSES as s (s)}
        <button
          type="button" class="status-btn" class:active={status === s}
          aria-pressed={status === s} disabled={saving}
          onclick={() => (status = s)}
        >
          {STATUS_LABEL[s]}
        </button>
      {/each}
    </div>

    <label class="field">
      <span>ראיה</span>
      <select bind:value={evidence} disabled={saving}>
        <option value="">— לא צוין —</option>
        {#each Object.entries(EVIDENCE_LABEL) as [id, label] (id)}
          <option value={id}>{label}</option>
        {/each}
      </select>
    </label>

    <label class="field">
      <span>הערה</span>
      <textarea rows="2" placeholder="הערה קצרה (לא חובה)" bind:value={note} disabled={saving}></textarea>
    </label>

    <button class="save-btn" onclick={save} disabled={saving}>
      {saving ? 'שומר…' : 'שמירה'}
    </button>

    <div class="structure">
      <span class="structure-label">מבנה</span>
      <div class="structure-row">
        {#each Object.entries(VISIBILITY_LABEL) as [v, label] (v)}
          <button
            type="button" class="chip" class:active={skill.visibility === v}
            aria-pressed={skill.visibility === v} disabled={saving}
            onclick={() => onvisibility(v as Visibility)}
          >
            {label}
          </button>
        {/each}
      </div>
      <div class="structure-row">
        <button type="button" class="chip" disabled={saving} onclick={() => onmove('up')}>▲ למעלה</button>
        <button type="button" class="chip" disabled={saving} onclick={() => onmove('down')}>▼ למטה</button>
      </div>
    </div>

    <div class="history">
      <h4>היסטוריה</h4>
      {#if !history.length}
        <p class="empty">אין עדיין היסטוריה</p>
      {:else}
        <ul>
          {#each history as h, i (i)}
            <li>
              <span class="h-status">{h.status ? STATUS_LABEL[h.status] : ''}</span>
              <span class="h-date">{fmtDate(h.at)}</span>
              {#if h.evidence}<span class="h-evidence">{EVIDENCE_LABEL[h.evidence]}</span>{/if}
              {#if h.note}<p class="h-note">{h.note}</p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 400;
    background: rgba(30, 41, 59, 0.35);
    display: flex; align-items: flex-end; justify-content: center;
  }
  .sheet {
    background: var(--bg-card); width: 100%; max-height: 88vh; overflow-y: auto;
    border-radius: 18px 18px 0 0; padding: 18px 16px calc(18px + env(safe-area-inset-bottom));
    box-shadow: 0 -8px 32px var(--shadow-md);
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .head h3 { font-size: 1.05rem; font-weight: 800; color: var(--text-primary); }
  .icon-btn {
    min-width: 44px; min-height: 44px; border: none; background: none;
    font-size: 1.1rem; color: var(--text-muted); cursor: pointer;
  }
  .note-line { font-size: .82rem; margin-bottom: 6px; }
  .note-line.changed { color: var(--accent2-strong); }
  .note-line.blocked { color: var(--danger); }
  .banner {
    border-radius: 10px; padding: 8px 12px; font-size: .85rem; margin-bottom: 10px;
  }
  .banner.error { background: rgba(220,38,38,0.08); border: 1.5px solid var(--danger); color: var(--danger); }

  .statuses { display: flex; flex-wrap: wrap; gap: 8px; margin-block: 10px; }
  .status-btn {
    min-height: 44px; padding: 8px 14px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); background: var(--bg-surface);
    color: var(--text-primary); font-family: inherit; font-size: .85rem; font-weight: 600;
    cursor: pointer;
  }
  .status-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }

  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .field span { font-size: .78rem; font-weight: 700; color: var(--text-muted); }
  .field select, .field textarea {
    min-height: 44px; border: 1.5px solid var(--border-strong); border-radius: 10px;
    padding: 8px 10px; font-family: inherit; font-size: .9rem; color: var(--text-primary);
    background: var(--bg-card); resize: vertical;
  }

  .save-btn {
    width: 100%; min-height: 44px; border: none; border-radius: 12px;
    background: var(--accent); color: #fff; font-family: inherit; font-weight: 800;
    font-size: .95rem; cursor: pointer; margin-bottom: 14px;
  }
  .save-btn:disabled { opacity: .6; cursor: default; }

  .structure { border-top: 1px solid var(--border); padding-top: 10px; margin-bottom: 14px; }
  .structure-label { font-size: .78rem; font-weight: 700; color: var(--text-muted); }
  .structure-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .chip {
    min-height: 44px; padding: 6px 14px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); background: var(--bg-card);
    color: var(--text-muted); font-family: inherit; font-size: .82rem; font-weight: 600;
    cursor: pointer;
  }
  .chip.active { border-color: var(--accent2-strong); color: var(--accent2-strong); background: var(--accent2-dim); }

  .history { border-top: 1px solid var(--border); padding-top: 10px; }
  .history h4 { font-size: .85rem; font-weight: 800; color: var(--text-primary); margin-bottom: 6px; }
  .history .empty { font-size: .82rem; color: var(--text-muted); }
  .history ul { display: flex; flex-direction: column; gap: 8px; }
  .history li { border-bottom: 1px solid var(--border); padding-bottom: 8px; font-size: .82rem; }
  .h-status { font-weight: 700; color: var(--text-primary); }
  .h-date { color: var(--text-muted); margin-inline-start: 8px; }
  .h-evidence { color: var(--text-muted); margin-inline-start: 8px; }
  .h-note { color: var(--text-muted-strong); margin-top: 2px; }

  @media (min-width: 700px) {
    /* flex-start, not flex-end: the page is RTL, so the main axis runs
       right-to-left and flex-start is the physical right edge — where the
       spec puts this panel ("a right-hand panel"). */
    .backdrop { align-items: stretch; justify-content: flex-start; background: rgba(30, 41, 59, 0.18); }
    .sheet {
      width: min(380px, 100%); max-height: 100vh; height: 100%;
      /* Negative x, not positive: the panel is flush against the right
         edge of the viewport, so a positive offset casts the shadow off
         the right of the screen entirely — invisible. The content the
         shadow should fall over is to the panel's left. */
      border-radius: 0; box-shadow: -8px 0 32px var(--shadow-md);
      padding: 22px 20px calc(22px + env(safe-area-inset-bottom));
    }
  }
</style>
