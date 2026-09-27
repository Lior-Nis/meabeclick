<script lang="ts">
  /**
   * Shared shell for the two legal pages (/terms, /privacy).
   *
   * ## Why a component rather than styling each page
   *
   * Both pages are nothing but long-form Hebrew prose, and prose needs a
   * reading column, a heading scale and list spacing that the rest of the
   * site — built out of cards, sheets and hero blocks — never needed. Putting
   * that typography in one place means the pages themselves contain only
   * their text, so a clause can be edited without anyone touching CSS, and
   * the two pages cannot drift apart the way five surfaces drifted apart
   * over the brand mark (see BrandMark.svelte).
   *
   * Headings, paragraphs and lists are styled with `:global` because the
   * prose arrives through `{@render children()}` — Svelte's scoping stops at
   * that boundary, so scoped selectors would match nothing.
   */
  import BrandMark from '$lib/components/BrandMark.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let {
    title,
    updated,
    intro,
    children,
  }: {
    /** Page heading, also used verbatim as the document title. */
    title: string;
    /** Human-readable "last updated" date, e.g. '10 בספטמבר 2026'. */
    updated: string;
    /** One-line summary under the heading, before the first section. */
    intro?: string;
    children: import('svelte').Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{title} — מאה בקליק</title>
</svelte:head>

<header>
  <BrandMark height={28} />
  <a class="home-link" href="/">→ חזרה לאתר</a>
</header>

<main>
  <h1>{title}</h1>
  <p class="updated">עודכן לאחרונה: {updated}</p>
  {#if intro}<p class="intro">{intro}</p>{/if}

  <div class="prose">
    {@render children()}
  </div>
</main>

<Footer />

<style>
  header {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    padding: 0.9rem 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .home-link {
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text-muted);
  }
  .home-link:hover { color: var(--accent); }

  main {
    max-width: 46rem;
    margin: 0 auto;
    padding: 2.5rem 1.5rem 3rem;
  }

  h1 {
    font-size: clamp(1.6rem, 5vw, 2.1rem);
    font-weight: 800;
    color: var(--text-primary);
    line-height: 1.25;
  }
  .updated {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-faint);
  }
  .intro {
    margin-top: 1.25rem;
    padding: 1rem 1.1rem;
    background: var(--bg-surface);
    border-radius: var(--r-md);
    color: var(--text-muted-strong);
    line-height: 1.7;
  }

  .prose { margin-top: 2rem; }

  /* The prose comes through a snippet, so these must be :global. */
  .prose :global(h2) {
    margin-top: 2.25rem;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--accent-deep);
    line-height: 1.4;
  }
  .prose :global(h3) {
    margin-top: 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .prose :global(p) {
    margin-top: 0.85rem;
    line-height: 1.8;
    color: var(--text-muted-strong);
  }
  .prose :global(ul) {
    margin-top: 0.85rem;
    /* Base resets `list-style: none` on every ul; prose wants markers back,
       and in RTL the marker sits on the right, so the indent is padding-right
       via the logical property. */
    list-style: disc;
    padding-inline-start: 1.35rem;
  }
  .prose :global(li) {
    margin-top: 0.5rem;
    line-height: 1.8;
    color: var(--text-muted-strong);
  }
  .prose :global(strong) { color: var(--text-primary); font-weight: 600; }
  .prose :global(a) { text-decoration: underline; }

  .prose :global(.contact) {
    margin-top: 1.5rem;
    padding: 1.1rem 1.2rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
  }
</style>
