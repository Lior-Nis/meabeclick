<script lang="ts">
  /**
   * One node of a parsed formula.
   *
   * Recursive, and built only from ordinary elements — there is no
   * `{@html}` anywhere in this file or its sibling, so the tree from
   * parse.ts cannot become markup however it was produced.
   */
  import Self from './MathNode.svelte';
  import type { MathNode } from './parse.ts';

  let { node }: { node: MathNode } = $props();
</script>

{#if node.k === 'text'}{node.v}{:else if node.k === 'group'}
  {#each node.body as child}<Self node={child} />{/each}
{:else if node.k === 'frac'}
  <span class="frac">
    <span class="num">{#each node.num as child}<Self node={child} />{/each}</span>
    <span class="bar" aria-hidden="true"></span>
    <span class="den">{#each node.den as child}<Self node={child} />{/each}</span>
  </span>
{:else if node.k === 'sqrt'}
  <span class="sqrt"><span class="radical" aria-hidden="true">√</span><span
    class="under">{#each node.body as child}<Self node={child} />{/each}</span></span>
{:else if node.k === 'sup'}
  <Self node={node.base} /><sup>{#each node.exp as child}<Self node={child} />{/each}</sup>
{:else if node.k === 'sub'}
  <Self node={node.base} /><sub>{#each node.idx as child}<Self node={child} />{/each}</sub>
{/if}

<style>
  /* A fraction is a stack, which is what makes it readable on a phone —
     "1/2" inline is fine, but "(x+3)/(2x-1)" inline is where a child loses
     track of what is divided by what. */
  .frac {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    margin: 0 0.15em;
  }
  .num, .den { display: block; padding: 0 0.25em; line-height: 1.15; }
  .bar {
    display: block;
    width: 100%;
    border-top: 1px solid currentColor;
    margin: 0.08em 0;
  }

  .sqrt { display: inline-flex; align-items: flex-start; }
  .radical { margin-inline-end: 0.05em; }
  /* The overline is what says where the root ends. Without it √x+1 is
     ambiguous about whether the 1 is inside. */
  .under { border-top: 1px solid currentColor; padding: 0 0.15em; }

  sup, sub { font-size: 0.75em; line-height: 0; }
</style>
