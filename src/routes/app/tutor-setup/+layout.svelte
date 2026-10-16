<script lang="ts">
  /* The tutor's setup pages: one narrow column, the confirm-booking page's
     look. Styles are :global under .wrap so both pages share them. */
  import BrandMark from '$lib/components/BrandMark.svelte';
  let { children } = $props();
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<main class="wrap">
  <div class="brand"><BrandMark height={28} /></div>
  {@render children()}
</main>

<style>
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; text-align: center; }
  .brand { display: flex; justify-content: center; margin-bottom: 20px; }
  .wrap :global(h1) { font-size: 1.5rem; font-weight: 900; margin: 0 0 8px; }
  .wrap :global(.lead) { color: var(--text-muted); margin: 0 0 16px; }
  .wrap :global(.btn) {
    display: inline-flex; align-items: center; justify-content: center; min-height: 48px;
    padding: 0 24px; border: 0; border-radius: 999px; background: var(--accent); color: #fff;
    font: inherit; font-weight: 800; text-decoration: none; cursor: pointer;
  }
  .wrap :global(.error) { color: var(--danger); font-weight: 700; margin: 0 0 12px; }
  .wrap :global(.note) { color: var(--text-muted); font-size: 0.9rem; margin-top: 18px; }
  .wrap :global(.steps) { text-align: start; margin: 22px 0 0; padding-inline-start: 1.2rem; line-height: 1.6; }
  .wrap :global(.room) { font-weight: 800; margin: 0 0 16px; word-break: break-all; }
</style>
