<script lang="ts">
  /**
   * Port of games/labelling.html. `data.svg` is tutor-authored inline SVG
   * markup, inserted with `{@html}` — same trust level games/game.js
   * always gave it (`Game.el('diagram').innerHTML = data.svg`). Its
   * elements are never part of Svelte's own template, so:
   *  - none of the CSS below reaching into `.diagram` can rely on Svelte's
   *    scoping class landing on that markup — every such rule is wrapped
   *    in `:global(...)`, or it silently never matches (the exact trap
   *    this migration already hit once on the homepage).
   *  - the `active`/`solved` state on a target, and the click listeners
   *    themselves, are attached imperatively in the `$effect` below, not
   *    via `class:`/`onclick` directives — those only work on elements
   *    Svelte's compiler actually owns.
   * The label buttons on the other hand ARE ordinary Svelte-rendered
   * elements, so those safely use `class:used`.
   */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, type GameEngineContext, type GameData } from './engine.ts';

  type Target = { id: string; label: string };
  type LabelBtn = { id: string; label: string; used: boolean; flash: boolean };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const svgMarkup = (data.svg as string | undefined) ?? '';
  const targets = (data.targets as Target[] | undefined) ?? [];

  let diagramEl: HTMLDivElement | undefined = $state();
  let labelBtns = $state<LabelBtn[]>([]);
  let solved = $state(0);
  let wrong = $state(0);
  let hint = $state('לחצו על חלק בתרשים, ואז על התווית המתאימה');
  let noMatch = $state(false);
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  let activeNode: Element | null = null;
  let activeTarget: Target | null = null;
  let attached = false;

  $effect(() => {
    if (!diagramEl || attached || !svgMarkup || !targets.length) return;
    attached = true;

    let found = 0;
    for (const t of targets) {
      const node = diagramEl.querySelector('#' + CSS.escape(t.id));
      if (!node) continue;
      found++;
      node.setAttribute('data-target', t.id);
      node.addEventListener('click', () => selectTarget(node, t));
    }
    if (!found) {
      noMatch = true;
      return;
    }

    labelBtns = engine.shuffle(targets.map((t) => ({ id: t.id, label: t.label, used: false, flash: false })));
    engine.startTimer();
  });

  function selectTarget(node: Element, t: Target) {
    if (node.classList.contains('solved')) return;
    diagramEl?.querySelectorAll('[data-target]').forEach((n) => n.classList.remove('active'));
    node.classList.add('active');
    activeNode = node;
    activeTarget = t;
    tell('עכשיו בחרו את התווית המתאימה');
  }

  /** The hint line is this game's only feedback: shown, and said. */
  function tell(text: string) {
    hint = text;
    engine.say(text);
  }

  function selectLabel(btn: LabelBtn) {
    if (btn.used) return;
    if (!activeNode || !activeTarget) {
      tell('קודם לחצו על חלק בתרשים');
      return;
    }

    if (btn.id === activeTarget.id) {
      activeNode.classList.remove('active');
      activeNode.classList.add('solved');
      btn.used = true;
      solved++;
      tell('יפה! ממשיכים לחלק הבא');
      activeNode = null;
      activeTarget = null;
      if (solved === targets.length) setTimeout(end, 500);
    } else {
      wrong++;
      missed.push(activeTarget.label);
      tell('לא התווית הזאת — נסו אחרת');
      btn.flash = true;
      setTimeout(() => { btn.flash = false; }, 500);
    }
  }

  function end() {
    engine.finish({
      template: 'labelling',
      score: Math.max(0, targets.length - wrong),
      total: targets.length,
      extraLine: wrong ? `${wrong} טעויות` : 'בלי טעויות!',
      missed: [...new Set(missed)],
    });
  }
</script>

{#if !svgMarkup || !targets.length}
  <div class="msg">חסר תרשים או תוויות בקובץ המשחק.</div>
{:else if noMatch}
  <div class="msg">התוויות בקובץ לא מתאימות לתרשים.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{solved}/{targets.length}</div><div class="stat-lbl">תוויות</div></div>
    <div class="stat"><div class="stat-val">{wrong}</div><div class="stat-lbl">טעויות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(solved / targets.length) * 100}%"></div></div>

  <div class="prompt">מה זה החלק הזה? 🏷️</div>
  <div class="hint">{hint}</div>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  <div class="diagram" bind:this={diagramEl}>{@html svgMarkup}</div>
  <div class="labels">
    {#each labelBtns as b (b.id + b.label)}
      <button class="label" class:used={b.used} class:flash={b.flash} onclick={() => selectLabel(b)}>{b.label}</button>
    {/each}
  </div>
{/if}

<style>
  .diagram {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 16px;
    padding: 12px; margin: 0.3rem 0 1rem; overflow-x: auto;
  }
  :global(.diagram svg) { width: 100%; height: auto; display: block; max-width: 460px; margin: 0 auto; }
  :global(.diagram [data-target]) { cursor: pointer; }
  :global(.diagram [data-target]:hover) { filter: brightness(0.92); }
  :global(.diagram [data-target].active) { stroke: #2563eb; stroke-width: 4; }
  :global(.diagram [data-target].solved) { stroke: #10b981; stroke-width: 4; }

  .labels { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .label {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 999px;
    padding: 9px 18px; font-size: 0.92rem; font-weight: 700; cursor: pointer; transition: all 0.15s;
    font-family: inherit;
  }
  .label:hover:not(.used) { border-color: var(--accent); background: var(--accent-dim); }
  .label.used { opacity: 0.35; cursor: default; text-decoration: line-through; }
  .label.flash { border-color: var(--danger); }
</style>
