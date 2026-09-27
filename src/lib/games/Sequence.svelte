<script lang="ts">
  /** Port of games/sequence.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, type GameEngineContext, type GameData } from './engine.ts';

  type Step = { text: string; origIdx: number; placedOrder: number | null; state: 'idle' | 'placed' | 'miss' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const steps = (data.steps as string[] | undefined) ?? [];

  let pool = $state<Step[]>([]);
  let next = $state(0);
  let wrong = $state(0);
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());
  const ordered = $derived(pool.filter((s) => s.state === 'placed').sort((a, b) => (a.placedOrder ?? 0) - (b.placedOrder ?? 0)));
  const unplaced = $derived(pool.filter((s) => s.state !== 'placed'));

  function build() {
    pool = engine.shuffle(steps.map((text, i) => ({ text, origIdx: i, placedOrder: null, state: 'idle' as const })));
  }

  function choose(s: Step) {
    if (s.state === 'placed') return;

    if (s.origIdx === next) {
      s.state = 'placed';
      s.placedOrder = next;
      next++;
      if (next === steps.length) setTimeout(end, 450);
    } else {
      wrong++;
      missed.push(steps[next]); // the step that should have come now
      s.state = 'miss';
      setTimeout(() => { if (s.state === 'miss') s.state = 'idle'; }, 500);
    }
  }

  function end() {
    engine.finish({
      template: 'sequence',
      score: Math.max(0, steps.length - wrong),
      total: steps.length,
      extraLine: wrong ? `${wrong} טעויות סדר` : 'בלי טעויות!',
      missed: [...new Set(missed)],
    });
  }

  if (steps.length >= 2) {
    engine.startTimer();
    build();
  }
</script>

{#if steps.length < 2}
  <div class="msg">צריך לפחות שני שלבים בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{next}/{steps.length}</div><div class="stat-lbl">שלבים</div></div>
    <div class="stat"><div class="stat-val">{wrong}</div><div class="stat-lbl">טעויות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {(next / steps.length) * 100}%"></div></div>

  <div class="prompt">מה קורה קודם? 🔢</div>
  <div class="hint">לחצו על השלבים לפי הסדר הנכון — מהראשון לאחרון</div>

  <div class="slot-title">הסדר שלכם</div>
  <div>
    {#each ordered as s (s.origIdx)}
      <div class="step placed">
        <span class="num">{(s.placedOrder ?? 0) + 1}</span>
        <span>{s.text}</span>
      </div>
    {/each}
  </div>

  <div class="slot-title">השלבים</div>
  <div>
    {#each unplaced as s (s.origIdx)}
      <button class="step" class:miss={s.state === 'miss'} onclick={() => choose(s)}>
        <span class="num">?</span>
        <span>{s.text}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .step {
    background: var(--bg-card); border: 2px solid var(--border); border-radius: 14px;
    padding: 13px 14px; margin-bottom: 10px; cursor: pointer; font-size: 0.96rem;
    line-height: 1.45; display: flex; align-items: center; gap: 10px; transition: all 0.15s;
    width: 100%; font-family: inherit; text-align: right;
  }
  .step:hover:not(.placed) { border-color: var(--accent); }
  .step.placed { border-color: var(--accent3); background: var(--accent3-dim); color: var(--accent3-strong); cursor: default; }
  .step.miss { border-color: var(--danger); background: var(--danger-dim); }
  .num {
    width: 26px; height: 26px; flex: 0 0 26px; border-radius: 50%;
    background: var(--accent-dim); color: var(--accent); font-weight: 900; font-size: 0.82rem;
    display: flex; align-items: center; justify-content: center;
  }
  .step.placed .num { background: var(--accent3); color: #fff; }
  .slot-title { font-size: 0.78rem; font-weight: 800; color: var(--text-muted); margin: 1rem 0 0.4rem; }
</style>
