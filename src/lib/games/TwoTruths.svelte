<script lang="ts">
  import FormulaText from '$lib/components/FormulaText.svelte';
  /** Port of games/two-truths.html. */
  import { getContext } from 'svelte';
  import { GAME_CONTEXT_KEY, offersHints, verdict, type GameEngineContext, type GameData } from './engine.ts';
  import RoundHint from './RoundHint.svelte';

  type Round = { statements: string[]; lieIndex: number; why: string; hint?: string };
  type Item = { text: string; isLie: boolean; state: 'idle' | 'correct' | 'wrong' };

  let { data }: { data: GameData } = $props();
  const engine = getContext<GameEngineContext>(GAME_CONTEXT_KEY);
  const rounds = (data.rounds as Round[] | undefined) ?? [];

  let idx = $state(0);
  let score = $state(0);
  let answered = $state(false);
  /** Hints the child asked for — see RoundHint.svelte. */
  let hintsUsed = $state(0);
  let items = $state<Item[]>([]);
  let whyText = $state('');
  const missed: string[] = [];
  const elapsed = $derived(engine.secs());

  function renderRound() {
    answered = false;
    whyText = '';
    const r = rounds[idx];
    items = engine.shuffle(r.statements.map((text, i) => ({ text, isLie: i === r.lieIndex, state: 'idle' as const })));
  }

  function choose(it: Item) {
    if (answered) return;
    answered = true;
    items.forEach((x) => { if (x.isLie) x.state = 'correct'; });
    if (it.isLie) score++;
    else {
      it.state = 'wrong';
      missed.push(rounds[idx].statements[rounds[idx].lieIndex]);
    }
    whyText = rounds[idx].why;
    engine.say(verdict(it.isLie, { answer: rounds[idx].statements[rounds[idx].lieIndex], note: whyText }));
  }

  function next() {
    idx++;
    if (idx < rounds.length) renderRound();
    else engine.finish({ template: 'two-truths', score, total: rounds.length, missed, ...(offersHints(rounds) ? { hints: hintsUsed } : {}) });
  }

  if (rounds.length) {
    engine.startTimer();
    renderRound();
  }
</script>

{#if !rounds.length}
  <div class="msg">אין סבבים בקובץ המשחק.</div>
{:else}
  <div class="stats">
    <div class="stat"><div class="stat-val">{idx + 1}/{rounds.length}</div><div class="stat-lbl">סבב</div></div>
    <div class="stat"><div class="stat-val">{score}</div><div class="stat-lbl">נכונות</div></div>
    <div class="stat"><div class="stat-val">{engine.fmt(elapsed)}</div><div class="stat-lbl">זמן</div></div>
  </div>
  <div class="progress-outer"><div class="progress-inner" style="width: {((idx + 1) / rounds.length) * 100}%"></div></div>

  <div class="prompt">איזה משפט <u>לא נכון</u>? 🕵️</div>
  <div class="hint">שניים מהמשפטים נכונים, אחד שקרי — מצאו אותו</div>
  <div>
    {#each items as it (it.text)}
      <button
        class="opt"
        class:correct={it.state === 'correct'}
        class:wrong={it.state === 'wrong'}
        disabled={answered}
        onclick={() => choose(it)}
      >{#if it.state === 'correct'}<span class="tag lie">שקר</span>{/if}<FormulaText text={it.text} />{#if it.state === 'wrong'}<span class="mark">✗</span>{/if}</button>
    {/each}
  </div>
  {#key idx}
    <RoundHint hint={rounds[idx]?.hint} locked={answered} onuse={() => hintsUsed++} />
  {/key}
  {#if whyText}<div class="why"><FormulaText text={whyText} /></div>{/if}
  {#if answered}
    <div style="text-align:center">
      <button class="btn" onclick={next}>{idx + 1 < rounds.length ? 'הבא ←' : 'סיום 🏁'}</button>
    </div>
  {/if}
{/if}

<style>
  .opt { line-height: 1.5; }
  .tag {
    display: inline-block; font-size: 0.72rem; font-weight: 800;
    border-radius: 999px; padding: 1px 9px; margin-left: 7px;
    background: var(--danger); color: #fff;
  }
</style>
