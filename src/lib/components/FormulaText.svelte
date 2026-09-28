<script lang="ts">
  /**
   * Hebrew text with plain formulas in it («א. 8-x-3=5-x»), each formula
   * isolated left to right — see $lib/bidi.ts. For LaTeX-delimited answers
   * use $lib/math/MathText.svelte instead.
   */
  import { formulaRuns } from '$lib/bidi.ts';
  let { text }: { text: string } = $props();
  const runs = $derived(formulaRuns(text));
</script>

{#each runs as r}{#if r.ltr}<bdi dir="ltr">{r.text}</bdi>{:else}{r.text}{/if}{/each}
