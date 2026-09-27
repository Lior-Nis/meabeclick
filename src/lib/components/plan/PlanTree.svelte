<script lang="ts">
  import { STATUS_LABEL, VISIBILITY_LABEL, type SkillStatus, type Visibility } from '$lib/plan-status.ts';

  interface Skill {
    id: number; key: string; title: string; visibility: string;
    status: SkillStatus; changed: boolean; blocked: boolean; blockedBy: string[]; recommended: boolean;
    /** When it was last taught, independent of assessment. */
    coveredAt?: string | null;
  }
  interface Branch { id: number; key: string; title: string; visibility: string; counts: Record<string, number>; skills: Skill[] }
  interface Topic { id: number; key: string; title: string; visibility: string; counts: Record<string, number>; branches: Branch[] }

  let { topics, filter, onselect, onvisibility, onmove }: {
    topics: Topic[];
    filter: 'all' | 'recommended' | 'needs_review' | 'blocked' | 'changed';
    onselect: (skill: Skill) => void;
    /** Structure control for topic/branch rows — task 7 whole-branch review,
     *  finding 4: the store/API/view already support pausing, hiding and
     *  reordering a topic or branch, only the page had no entry point. */
    onvisibility: (nodeId: number, visibility: Visibility) => void;
    onmove: (nodeId: number, direction: 'up' | 'down') => void;
  } = $props();

  let open = $state<Record<number, boolean>>({});
  const toggle = (id: number) => { open[id] = !open[id]; };

  // Which single topic/branch's structure menu is open, if any. A separate
  // button from the disclosure toggle (siblings, not nested — a button
  // cannot contain a button) so opening it can never also expand/collapse
  // the row, and vice versa.
  let menuFor = $state<number | null>(null);
  function toggleMenu(id: number, e: MouseEvent) {
    e.stopPropagation();
    menuFor = menuFor === id ? null : id;
  }
  function act(fn: () => void) {
    fn();
    menuFor = null;
  }

  function keep(s: Skill): boolean {
    if (s.visibility === 'hidden') return false;
    if (filter === 'recommended') return s.recommended;
    if (filter === 'needs_review') return s.status === 'needs_review';
    if (filter === 'blocked') return s.blocked;
    if (filter === 'changed') return s.changed;
    return true;
  }

  /** "4 עצמאי · 2 בתרגול" — only the statuses that actually occur. */
  function summary(counts: Record<string, number>): string {
    return Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([status, n]) => `${n} ${STATUS_LABEL[status as SkillStatus]}`)
      .join(' · ');
  }
</script>

{#each topics.filter(t => t.visibility !== 'hidden') as topic (topic.id)}
  <section class="topic">
    <div class="row group">
      <button class="row-toggle" aria-expanded={!!open[topic.id]} onclick={() => toggle(topic.id)}>
        <span class="caret">{open[topic.id] ? '▾' : '▸'}</span>
        <span class="title">{topic.title}</span>
        <span class="counts">{summary(topic.counts)}</span>
      </button>
      <button
        class="menu-btn" aria-haspopup="true" aria-expanded={menuFor === topic.id}
        aria-label="אפשרויות מבנה: {topic.title}" onclick={(e) => toggleMenu(topic.id, e)}
      >⋮</button>
    </div>
    {#if menuFor === topic.id}
      <div class="menu" role="menu">
        {#each Object.entries(VISIBILITY_LABEL) as [v, label] (v)}
          <button
            type="button" class="menu-item" class:active={topic.visibility === v}
            onclick={() => act(() => onvisibility(topic.id, v as Visibility))}
          >{label}</button>
        {/each}
        <button type="button" class="menu-item" onclick={() => act(() => onmove(topic.id, 'up'))}>▲ למעלה</button>
        <button type="button" class="menu-item" onclick={() => act(() => onmove(topic.id, 'down'))}>▼ למטה</button>
      </div>
    {/if}

    {#if open[topic.id]}
      {#each topic.branches.filter(b => b.visibility !== 'hidden') as branch (branch.id)}
        {@const visible = branch.skills.filter(keep)}
        {#if visible.length}
          <div class="row group branch-row">
            <button class="row-toggle branch" aria-expanded={!!open[branch.id]} onclick={() => toggle(branch.id)}>
              <span class="caret">{open[branch.id] ? '▾' : '▸'}</span>
              <span class="title">{branch.title}</span>
              <span class="counts">{summary(branch.counts)}</span>
            </button>
            <button
              class="menu-btn" aria-haspopup="true" aria-expanded={menuFor === branch.id}
              aria-label="אפשרויות מבנה: {branch.title}" onclick={(e) => toggleMenu(branch.id, e)}
            >⋮</button>
          </div>
          {#if menuFor === branch.id}
            <div class="menu branch-menu" role="menu">
              {#each Object.entries(VISIBILITY_LABEL) as [v, label] (v)}
                <button
                  type="button" class="menu-item" class:active={branch.visibility === v}
                  onclick={() => act(() => onvisibility(branch.id, v as Visibility))}
                >{label}</button>
              {/each}
              <button type="button" class="menu-item" onclick={() => act(() => onmove(branch.id, 'up'))}>▲ למעלה</button>
              <button type="button" class="menu-item" onclick={() => act(() => onmove(branch.id, 'down'))}>▼ למטה</button>
            </div>
          {/if}

          {#if open[branch.id]}
            {#each visible as skill (skill.id)}
              <button class="row skill" class:paused={skill.visibility === 'paused'} onclick={() => onselect(skill)}>
                <span class="title">
                  {skill.title}
                  {#if skill.changed}<span class="dot" title="השתנה מאז השיעור האחרון">●</span>{/if}
                  {#if skill.blocked}<span class="lock" title="חסום: {skill.blockedBy.join(', ')}">🔒</span>{/if}
                </span>
                <!-- "Taught" and "assessed" are different facts. A skill that
                     has been in a lesson but never checked reads «נלמד, טרם
                     נבדק» rather than a bare «לא נבדק», which would say the
                     same thing about a skill nobody has opened yet. Still
                     data-status="not_checked": it has NOT moved along the
                     scale, and the colour must not suggest it has. -->
                <span class="pill" data-status={skill.status}>
                  {#if skill.status === 'not_checked' && skill.coveredAt}
                    נלמד, טרם נבדק
                  {:else}
                    {STATUS_LABEL[skill.status]}
                  {/if}
                </span>
              </button>
            {/each}
          {/if}
        {/if}
      {/each}
    {/if}
  </section>
{/each}

<style>
  .row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    min-height: 44px; padding: 8px 10px; background: none; border: none;
    border-bottom: 1px solid var(--border); font-family: inherit;
    font-size: .92rem; color: var(--text-primary); text-align: right; cursor: pointer;
  }
  /* Topic/branch rows: a plain layout div (not a button — it now holds two
     independent buttons side by side) carrying the same border/padding the
     single button used to. */
  div.row { cursor: default; }
  .row-toggle {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
    min-height: 44px; background: none; border: none; padding: 0;
    font-family: inherit; font-size: inherit; color: inherit; text-align: right; cursor: pointer;
  }
  .group .row-toggle { font-weight: 800; }
  .branch-row { padding-inline-start: 22px; }
  .row-toggle.branch { font-size: .88rem; }
  .skill { padding-inline-start: 40px; font-weight: 500; }
  .skill.paused { opacity: .55; }
  .title { flex: 1; min-width: 0; }
  .counts { font-size: .75rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
  .caret { color: var(--text-muted); }
  .dot { color: var(--accent2-strong); font-size: .7rem; vertical-align: middle; }
  .pill {
    font-size: .75rem; font-weight: 700; padding: 3px 10px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); color: var(--text-muted); white-space: nowrap;
  }
  .pill[data-status='independent'] { color: var(--accent3-strong); border-color: var(--accent3-strong); }
  .pill[data-status='needs_review'] { color: var(--danger); border-color: var(--danger); }
  .pill[data-status='guided'], .pill[data-status='with_help'] { color: var(--accent); border-color: var(--accent); }

  /* Structure menu — its own hit area beside the disclosure toggle, never
     inside it, so it can't swallow the expand/collapse tap. */
  .menu-btn {
    flex-shrink: 0; min-width: 44px; min-height: 44px; border-radius: 8px;
    background: none; border: none; font-size: 1.15rem; line-height: 1;
    color: var(--text-muted); cursor: pointer;
  }
  .menu-btn[aria-expanded='true'] { background: var(--bg-surface); color: var(--accent); }
  .menu {
    display: flex; flex-wrap: wrap; gap: 6px;
    padding: 6px 10px 10px; border-bottom: 1px solid var(--border);
  }
  .branch-menu { padding-inline-start: 32px; }
  .menu-item {
    min-height: 44px; padding: 4px 14px; border-radius: 999px;
    border: 1.5px solid var(--border-strong); background: var(--bg-surface);
    color: var(--text-muted); font-family: inherit; font-size: .78rem; font-weight: 700; cursor: pointer;
  }
  .menu-item.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim); }
</style>
