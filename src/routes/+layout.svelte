<script lang="ts">
  import '$lib/styles/tokens.css';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
  <link
    href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap"
    rel="stylesheet"
  />
</svelte:head>

{@render children()}
