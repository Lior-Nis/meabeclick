<script lang="ts">
  import FormulaText from '$lib/components/FormulaText.svelte';
  /**
   * One round's hint, on demand — shared by the round-based templates.
   *
   * Help is a legitimate way to learn, so the button says nothing
   * discouraging and the count is not shown to the child: it reaches the
   * tutor through the result's `hints`, which the suggestion engine reads
   * (no hints on the last play before `independent`). Parents render this
   * inside {#key idx}, so each round starts with its hint hidden.
   *
   * Disabled once shown, so one round's hint counts once however often it
   * is pressed; and once the round is answered, because help after the
   * answer is feedback, which the template's own "why" already gives.
   */
  let { hint, locked, onuse }: { hint?: string; locked: boolean; onuse: () => void } = $props();
  let shown = $state('');

  function reveal() {
    if (!hint || locked || shown) return;
    shown = hint;
    onuse();
  }
</script>

{#if hint}
  <div class="help-row">
    <button class="help-btn" onclick={reveal} disabled={!hint || locked || !!shown}>💡 רמז</button>
    {#if shown}<span class="help-text"><FormulaText text={shown} /></span>{/if}
  </div>
{/if}

<style>
  .help-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 12px; }
  /* Same look as matching's help button, which came first. */
  .help-btn {
    font-family: inherit; font-size: .9rem; font-weight: 700;
    min-height: 44px; padding: 0 16px; border-radius: 10px;
    border: 1px solid var(--border, #E2E8F0); background: #fff; cursor: pointer;
  }
  .help-btn:disabled { opacity: .5; cursor: default; }
  .help-text { font-size: .9rem; line-height: 1.5; }
</style>
