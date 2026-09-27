<script lang="ts">
  /**
   * An answer from /api/ask, with its formulas laid out and its prose left
   * alone.
   *
   * Three things this has to get right, and all three were in the task:
   *
   * 1. **Direction.** The page is RTL. Maths is not: "2x + 3 = 11" read
   *    right-to-left is a different statement. Each formula is its own
   *    inline-block with dir="ltr", so it keeps its own direction inside a
   *    Hebrew sentence without forcing the sentence to change.
   *
   * 2. **Fallback.** A formula that did not parse is shown as the exact
   *    source the model wrote. Half a rendered equation is wrong rather
   *    than ugly, and a child cannot tell which.
   *
   * 3. **Copying.** Selecting a message copies text, so the source is kept
   *    as the element's title and the fallback is literal text. Nothing a
   *    child copies turns into markup on the way out.
   */
  import MathNode from './MathNode.svelte';
  import { splitMath } from './parse.ts';

  let { text }: { text: string } = $props();

  const segments = $derived(splitMath(text));
</script>

{#each segments as seg}
  {#if seg.math}
    <span class="math" dir="ltr" title={seg.raw}>
      {#each seg.math as node}<MathNode {node} />{/each}
    </span>
  {:else}{seg.raw}{/if}
{/each}

<style>
  .math {
    display: inline-block;
    /* Its own direction, inside a sentence that keeps its own. */
    direction: ltr;
    unicode-bidi: isolate;
    font-family: 'Cambria Math', 'Times New Roman', Georgia, serif;
    white-space: nowrap;
    /* A long formula on a 320px screen scrolls by itself rather than
       widening the bubble and pushing the whole conversation sideways. */
    max-width: 100%;
    overflow-x: auto;
    vertical-align: middle;
  }
</style>
