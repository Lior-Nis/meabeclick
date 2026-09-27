<script lang="ts">
  /**
   * One icon, branded if the artwork exists and the emoji it replaces if not.
   *
   * Decorative by default: most icons here sit next to their own label
   * ("📅 השיעור הבא"), so announcing them would make a screen reader read
   * every heading twice. Pass `label` for the few that carry meaning on
   * their own — a bare ✅ in a homework row, say — and it becomes an
   * `img` with that name instead.
   */
  import { iconFor, type IconName } from './registry.ts';

  interface Props {
    name: IconName;
    /** Rendered size in px. Matches the adjacent text by default. */
    size?: number;
    /** Set ONLY when the icon carries meaning no nearby text already gives. */
    label?: string;
    class?: string;
  }

  let { name, size = 20, label = '', class: cls = '' }: Props = $props();
  const icon = $derived(iconFor(name));
</script>

<span
  class="icon {cls}"
  class:is-emoji={!icon.svg}
  style="--icon-size: {size}px"
  role={label ? 'img' : undefined}
  aria-label={label || undefined}
  aria-hidden={label ? undefined : 'true'}
>
  {#if icon.svg}
    <!-- Build-time SVG from src/lib/icons/svg/, never user input — the
         registry reads the repo's own files and nothing else reaches here. -->
    {@html icon.svg}
  {:else}
    {icon.fallback}
  {/if}
</span>

<style>
  .icon {
    display: inline-flex; align-items: center; justify-content: center;
    inline-size: var(--icon-size); block-size: var(--icon-size);
    /* Keeps an icon on the text baseline it sits beside rather than
       riding above it, which is what an inline-flex box does by default. */
    vertical-align: -0.15em;
    flex: none;
  }
  /* currentColor is the contract with the artwork: an icon inherits the
     colour of the text it sits in, so the same file works on the accent
     header and on a white card without a second copy. */
  .icon :global(svg) {
    inline-size: 100%; block-size: 100%;
    fill: none; stroke: currentColor;
  }
  .icon :global(svg [fill]:not([fill='none'])) { fill: currentColor; }
  /* An emoji has no stroke to inherit, and needs its own line-height or it
     shifts the row it sits in. */
  .is-emoji { font-size: calc(var(--icon-size) * 0.95); line-height: 1; }
</style>
