<script lang="ts">
  /**
   * The student board's primary navigation, fixed to the bottom of the
   * viewport.
   *
   * It replaces a horizontally-scrolling row of pills that sat in the middle
   * of the page. That row did not merely look dated — on a 1080px-wide phone
   * the fourth destination ("שאלה") was CLIPPED AT THE SCREEN EDGE, so the
   * question box was invisible to anyone who did not discover that a row
   * which gives no scroll affordance could be scrolled. A whole feature was
   * hidden on the device the board is mostly used on.
   *
   * Fixed rather than sticky so it never scrolls away, and laid out as equal
   * fractions so four destinations always fit whatever their labels say.
   *
   * ## The bottom inset
   *
   * `env(safe-area-inset-bottom)` is what keeps this above the iPhone home
   * indicator. It resolves to 0 unless the document opts in with
   * `viewport-fit=cover` — see src/app.html. Without both halves the bar
   * renders under the indicator and its labels are unreadable on exactly the
   * phones this is designed for.
   */
  import Icon from '$lib/icons/Icon.svelte';
  import type { IconName } from '$lib/icons/registry.ts';

  export interface NavItem {
    id: string;
    label: string;
    icon: IconName;
  }

  interface Props {
    items: NavItem[];
    active: string;
    onselect: (id: string) => void;
    /** Hidden while a text composer has focus, so the on-screen keyboard and
     *  the bar do not stack and eat half a phone screen. */
    hidden?: boolean;
  }

  let { items, active, onselect, hidden = false }: Props = $props();
</script>

<nav class="bottom-nav" class:hidden aria-label="ניווט ראשי">
  {#each items as item (item.id)}
    <button
      class="nav-item"
      class:active={item.id === active}
      aria-current={item.id === active ? 'page' : undefined}
      onclick={() => onselect(item.id)}
    >
      <Icon name={item.icon} size={22} />
      <span class="nav-label">{item.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    inset-inline: 0;
    bottom: 0;
    z-index: 40;
    display: grid;
    /* Equal fractions, so a longer label never squeezes its neighbours and
       nothing can be pushed off-screen the way the old pill row was. */
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    background: var(--bg-card);
    border-top: 1px solid var(--border);
    padding-bottom: env(safe-area-inset-bottom);
    transition: transform 0.22s ease;
  }
  .hidden { transform: translateY(100%); }

  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    /* 56px of tappable bar, before the safe-area padding underneath it. */
    min-block-size: 56px;
    padding: 6px 4px;
    border: 0;
    background: none;
    font-family: inherit;
    color: var(--text-muted);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s ease;
  }
  .nav-item.active { color: var(--accent); }
  .nav-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }

  .nav-label { font-size: 0.72rem; font-weight: 700; line-height: 1; }

  /* Above ~640px the board is not a phone and the bar becomes a wide strip of
     nothing, so it centres to the same measure as the content. */
  @media (min-width: 640px) {
    .bottom-nav {
      inset-inline: 50%;
      transform: translateX(50%);
      max-inline-size: 820px;
      inline-size: 100%;
      border-inline: 1px solid var(--border);
      border-start-start-radius: 14px;
      border-start-end-radius: 14px;
    }
    .hidden { transform: translateX(50%) translateY(100%); }
  }
</style>
