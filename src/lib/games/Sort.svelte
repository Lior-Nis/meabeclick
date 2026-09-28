<script lang="ts">
  /** Port of games/sort.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, verdict, type GameEngineContext, type GameData } from './engine.ts';

  type Item = { text: string; category: string };
  type CatBtn = { name: string; state: 'idle' | 'right' | 'wrong' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const cats = (data.categories as string[] | undefined) ?? [];
  const items = engine.shuffle(((data.items as Item[] | undefined) ?? []).slice());

  let idx = $state(0);
  let score = $state(0);
  let answered = $state(false);
  let catBtns = $state<CatBtn[]>([]);
  let whyHtml = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function renderItem() {
    answered = false;
    whyHtml = '';
    catBtns = cats.map((name) => ({ name, state: 'idle' as const }));
  }

  function choose(btn: CatBtn) {
    if (answered) return;
    answered = true;
    const it = items[idx];
    catBtns.forEach((b) => { if (b.name === it.category) b.state = 'right'; });
    engine.say(verdict(btn.name === it.category, { answer: it.category }));
    if (btn.name === it.category) {
      score++;
    } else {
      btn.state = 'wrong';
      missed.push(it.text);
      whyHtml = `<b>${escapeHtml(it.text)}</b> שייך ל<b>${escapeHtml(it.category)}</b>`;
    }
  }

  // The only place a shared "escape" helper is still needed: the why-line
  // above mixes trusted markup (<b>) with data-file text in the same
  // string, so it can't be plain Svelte interpolation like every other
  // template's why-text. Kept local rather than reintroducing engine.ts's
  // dropped `Game.esc` for one call site.
  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function next() {
    idx++;
    if (idx < items.length) renderItem();
    else engine.finish({ template: 'sort', score, total: items.length, missed });
  }

  if (cats.length && items.length) {
    engine.startTimer();
    renderItem();
  }
</script>

{#if !cats.length || !items.length}
  <div class="msg">חסרות קבוצות או פריטים בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{idx + 1}/{items.length}</div><div class="stat-lbl">פריט</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((idx + 1) / items.length) * 100}%"></div></div>

  <div class="prompt">לאיזו קבוצה זה שייך? 🗂️</div>
  <div class="hint">קראו את הפריט ובחרו את הקבוצה המתאימה</div>
  <div class="item-card">{items[idx].text}</div>
  <div class="cats">
    {#each catBtns as b (b.name)}
      <button
        class="cat"
        class:right={b.state === 'right'}
        class:wrong={b.state === 'wrong'}
        disabled={answered}
        onclick={() => choose(b)}
      >{b.name}{#if b.state === 'right'}<span class="mark">✓</span>{:else if b.state === 'wrong'}<span class="mark">✗</span>{/if}</button>
    {/each}
  </div>
  {#if whyHtml}<div class="why">{@html whyHtml}</div>{/if}
  {#if answered}
    <div style="text-align:center">
      <button class="btn" onclick={next}>{idx + 1 < items.length ? 'הבא ←' : 'סיום 🏁'}</button>
    </div>
  {/if}
{/if}

<style>
  .item-card {
    background: var(--bg-card); border: 2px solid var(--accent); border-radius: 18px;
    padding: 26px 18px; text-align: center; font-size: 1.15rem; font-weight: 800;
    line-height: 1.45; margin: 0.3rem 0 1rem;
  }
  .cats { display: grid; gap: 10px; }
  .cat {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 14px;
    padding: 15px 12px; font-size: 1rem; font-weight: 800; cursor: pointer; transition: all 0.15s;
    font-family: inherit; width: 100%;
  }
  .cat:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-dim); }
  .cat:disabled { cursor: default; }
  .cat.right { border-color: var(--accent3); background: var(--accent3-dim); color: var(--accent3-strong); }
  .cat.wrong { border-color: var(--danger); background: var(--danger-dim); color: var(--danger); }
</style>
