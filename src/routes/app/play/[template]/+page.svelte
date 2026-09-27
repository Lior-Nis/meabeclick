<script lang="ts">
  /**
   * Picks the right game component for `data.template` (already validated
   * against the registry by +page.server.ts) and wraps it in GameShell,
   * which owns the timer/finish state every template needs (see
   * GameShell.svelte's header comment) and provides it through context.
   */
  import type { PageData } from './$types';
  import GameShell from '$lib/games/GameShell.svelte';
  import Memory from '$lib/games/Memory.svelte';
  import Quiz from '$lib/games/Quiz.svelte';
  import Matching from '$lib/games/Matching.svelte';
  import Sequence from '$lib/games/Sequence.svelte';
  import Sort from '$lib/games/Sort.svelte';
  import Table from '$lib/games/Table.svelte';
  import Labelling from '$lib/games/Labelling.svelte';
  import NumberLine from '$lib/games/NumberLine.svelte';
  import SpeedDrill from '$lib/games/SpeedDrill.svelte';
  import ErrorHunt from '$lib/games/ErrorHunt.svelte';
  import GraphMatch from '$lib/games/GraphMatch.svelte';
  import TwoTruths from '$lib/games/TwoTruths.svelte';

  let { data }: { data: PageData } = $props();

  const components = {
    memory: Memory,
    quiz: Quiz,
    matching: Matching,
    sequence: Sequence,
    sort: Sort,
    table: Table,
    labelling: Labelling,
    'number-line': NumberLine,
    'speed-drill': SpeedDrill,
    'error-hunt': ErrorHunt,
    'graph-match': GraphMatch,
    'two-truths': TwoTruths,
  } as const;

  const Board = $derived(components[data.template as keyof typeof components]);
</script>

{#if Board}
  <!-- Keyed on the dataset, so a second game is a NEW shell and a NEW
       board rather than the previous one handed a new prop.

       Every template reads `data` once at init (`const questions =
       data.questions ?? []`) and keeps its progress in $state starting at
       zero. Without this key, a client-side move between two games of the
       same template left the first game's content on screen under the
       second game's title — and GameShell, whose clock is its own $state,
       filed the result against the NEW dataId. A child answering the old
       questions had the score written to the new game's record.

       Outside GameShell, not just around <Board>: the shell owns the timer
       and the reporting, and both have to start again too. -->
  {#key `${data.template}:${data.dataId}`}
  <GameShell
    title={data.title}
    subject={data.subject}
    best={data.best}
    dataId={data.dataId}
    student={data.student}
    t={data.t ?? ''}
  >
    <Board data={data.gameData} />
  </GameShell>
  {/key}
{:else}
  <div class="wrap">
    <div class="msg">תבנית משחק לא נתמכת עדיין.</div>
  </div>
{/if}

<style>
  .wrap { max-width: 760px; margin: 0 auto; }
</style>
