<script lang="ts">
  import BrandMark from '$lib/components/BrandMark.svelte';
</script>

<section id="footer">
  <div class="footer-inner">
    <BrandMark height={26} href={null} label={null} />
    <span class="footer-text">מאה בקליק © 2026</span>
    <nav class="footer-links" aria-label="מסמכים משפטיים">
      <a href="/terms">תקנון</a>
      <a href="/privacy">מדיניות פרטיות</a>
    </nav>
  </div>
</section>

<style>
  /* ── FOOTER ────────────────────────────────────────────────── */
  #footer {
    border-top: 1px solid var(--border);
    padding: 2rem 1.5rem 7rem;
  }
  .footer-inner {
    max-width: 1080px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  /* The footer deliberately dims its mark. `:global` because the <img> now
     lives inside BrandMark, and Svelte's scoping stops at that boundary —
     the footer's own treatment stays here rather than becoming a prop only
     one caller would ever pass. */
  .footer-inner :global(.brand-mark) { border-radius: 6px; opacity: 0.6; }
  .footer-text { color: var(--text-faint); font-size: 0.88rem; }

  /* Pushed to the far edge by `margin-inline-start: auto` rather than given
     its own flex row, so on a narrow phone the links wrap under the mark
     instead of being squeezed against the © line. */
  .footer-links {
    margin-inline-start: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 1.1rem;
  }
  .footer-links a { color: var(--text-faint); font-size: 0.88rem; }
  .footer-links a:hover { color: var(--accent); }
</style>
