<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  /**
   * The app-wide error page. Before this file existed, ANY `error(...)`
   * thrown anywhere in the app — not just /app/play/[template] — fell
   * through to SvelteKit's built-in default error page: unstyled, English,
   * LTR. Placed at the routes root (not under /app/play) so it covers
   * every route, since nothing here is play-specific; it renders inside
   * the root +layout.svelte (src/routes/+layout.svelte), which has no
   * `load` of its own to fail, so it always gets tokens.css and the Heebo
   * font for free regardless of which route errored. app.html's
   * `<html lang="he" dir="rtl">` covers the rest.
   *
   * The two real cases this exists for both come from
   * /app/play/[template]/+page.server.ts, and are exactly the
   * stale-WhatsApp-link scenario: a child opens homework from an old
   * message after the tutor issued a new one, or after the underlying
   * game data was replaced/removed.
   *   - 403: a missing/tampered/expired `&t=` signature (verifyGameSignature)
   *   - 404: an unknown template, or a data file that no longer exists
   * Copy for both is adapted from games/game.js's own Hebrew messages
   * (`חסר מזהה משחק בכתובת`, `לא נמצא קובץ המשחק ...`) rather than
   * invented fresh — same audience, same tone, just reframed for a child/
   * parent reader instead of echoing a status code or a filesystem path.
   */
  import { page } from '$app/state';

  const status = $derived(page.status);
  const detail = $derived(page.error?.message ?? '');
</script>

<svelte:head>
  <title>שגיאה — מאה בקליק</title>
</svelte:head>

<div class="error-wrap">
  <div class="error-card">
    <div class="page-brand"><BrandMark height={28} /></div>
    {#if status === 403}
      <div class="error-emoji" aria-hidden="true"><Icon name="key" size={40} /></div>
      <h1>הקישור הזה כבר לא בתוקף</h1>
      <p>ייתכן שזה קישור ישן מהודעה קודמת. בקשו מהמורה או מההורה קישור מעודכן למשחק.</p>
    {:else if status === 404}
      <div class="error-emoji" aria-hidden="true"><Icon name="faq" size={40} /></div>
      <h1>לא מצאנו את המשחק הזה</h1>
      <p>ייתכן שהקישור שגוי, או שהמשחק כבר לא קיים. בקשו קישור מעודכן.</p>
    {:else}
      <div class="error-emoji" aria-hidden="true"><Icon name="warning" size={40} /></div>
      <h1>משהו השתבש</h1>
      <p>{detail || 'אירעה שגיאה בלתי צפויה. נסו לרענן את הדף.'}</p>
    {/if}
    <a class="error-home" href="/">חזרה לעמוד הבית</a>
  </div>
</div>

<style>
  .error-wrap {
    min-height: 70vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .error-card {
    max-width: 420px;
    width: 100%;
    text-align: center;
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: var(--r-xl);
    padding: 2.5rem 1.6rem;
  }
  .page-brand { display: flex; justify-content: center; margin-bottom: 1.4rem; }
  .error-emoji { font-size: 2.6rem; margin-bottom: 0.6rem; }
  h1 { font-size: 1.35rem; font-weight: 900; margin-bottom: 0.6rem; }
  p { color: var(--text-muted); line-height: 1.7; }
  .error-home {
    display: inline-block;
    margin-top: 1.4rem;
    background: var(--accent2);
    color: var(--btn-text);
    font-weight: 800;
    font-size: 0.95rem;
    border-radius: 999px;
    padding: 0.7rem 1.8rem;
    min-height: 44px;
    text-decoration: none;
  }
  .error-home:hover { opacity: 0.9; }
</style>
