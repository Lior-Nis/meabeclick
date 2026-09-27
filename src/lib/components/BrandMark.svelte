<script lang="ts">
  /**
   * The brand mark — the ONLY place `/images/logos/logo-slate.svg` is
   * referenced. Every screen that shows the logo goes through here.
   *
   * ## Why a component for one `<img>`
   *
   * Because the logo had already drifted. /booking and /portal were showing
   * `logo-main.svg` — a completely different mark (teal "100" wordmark on a
   * cream plate) squeezed into a 30×30 box, while the favicon, the marketing
   * header and the footer all showed this one. /login showed a 🔐 emoji and
   * the four /app screens showed nothing at all. Five surfaces, four
   * different answers. One import is harder to get wrong than five paths.
   *
   * ## Sizing
   *
   * `height` only, never width: the source is 80×60 (4:3), and the two pages
   * that drifted had also pinned `width === height`, letterboxing a wide
   * logo into a square. Pass a number; the aspect ratio follows.
   *
   * ## Never place this on an --accent fill
   *
   * The mark's ink is #2563EB, which IS `--accent` — the logo is invisible
   * on the student hero and on the parent page's `.student-header`
   * gradient. Both keep the mark in neutral chrome above the coloured block
   * rather than inside it.
   */
  let {
    height = 28,
    href = '/',
    label = 'מאה בקליק',
  }: {
    height?: number;
    /** `null` renders the bare mark, for chrome that is already a link. */
    href?: string | null;
    /** Accessible name; the mark is decorative when some sibling names it. */
    label?: string | null;
  } = $props();
</script>

{#snippet mark()}
  <img
    class="brand-mark"
    src="/images/logos/logo-slate.svg"
    alt={label ?? ''}
    aria-hidden={label ? undefined : 'true'}
    {height}
    style="height: {height}px"
  />
{/snippet}

{#if href}
  <a class="brand-mark-link" {href}>{@render mark()}</a>
{:else}
  {@render mark()}
{/if}

<style>
  .brand-mark { width: auto; display: block; flex-shrink: 0; }
  .brand-mark-link { display: inline-flex; align-items: center; text-decoration: none; }
</style>
