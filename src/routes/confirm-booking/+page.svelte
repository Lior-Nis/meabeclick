<script lang="ts">
  /* The confirmation email's landing page: the held booking, and one button.
     See +page.server.ts for why opening this page confirms nothing. */
  import BrandMark from '$lib/components/BrandMark.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let sending = $state(false);
  let error = $state('');

  async function confirm() {
    if (!data.valid) return;
    sending = true;
    error = '';
    try {
      const r = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: data.token }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        // Signed in by the answer: straight to the family's board.
        location.href = '/app/parent';
        return;
      }
      error = body.error || 'האישור לא הצליח. נסו שוב, או כתבו לנו בוואטסאפ.';
    } catch {
      error = 'אין חיבור כרגע. נסו שוב בעוד רגע.';
    }
    sending = false;
  }
</script>

<svelte:head>
  <title>אישור שיעור — מאה בקליק</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<main class="wrap">
  <div class="brand"><BrandMark height={28} /></div>
  {#if data.valid}
    <h1>לאשר את השיעור?</h1>
    <p class="lead">התקבלה בקשה לשיעור עם כתובת המייל שלכם:</p>
    <dl>
      <dt>תלמיד/ה</dt><dd>{data.studentName}</dd>
      <dt>מועד</dt><dd>{data.when}</dd>
      <dt>מקצוע</dt><dd>{data.subject}</dd>
    </dl>
    <button class="btn" onclick={confirm} disabled={sending}>{sending ? 'מאשרים…' : 'כן, זה אנחנו — לאשר'}</button>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <p class="note">לא הזמנתם? אין צורך לעשות דבר. בלי אישור שום דבר לא נרשם, והשעה תשתחרר.</p>
  {:else}
    <h1>הקישור לא תקף</h1>
    <p class="lead">ייתכן שעברה יממה מאז הבקשה, או שהשיעור כבר אושר.</p>
    <a class="btn" href="/booking">לקביעת שיעור</a>
  {/if}
</main>

<style>
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 16px 48px; text-align: center; }
  .brand { display: flex; justify-content: center; margin-bottom: 20px; }
  h1 { font-size: 1.5rem; font-weight: 900; margin: 0 0 8px; }
  .lead { color: var(--text-muted); margin: 0 0 16px; }
  dl {
    display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; text-align: start;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px;
    padding: 16px 18px; margin: 0 0 20px;
  }
  dt { color: var(--text-muted); font-weight: 700; }
  dd { margin: 0; font-weight: 700; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; min-height: 48px;
    padding: 0 24px; border: 0; border-radius: 999px; background: var(--accent); color: #fff;
    font: inherit; font-weight: 800; text-decoration: none; cursor: pointer;
  }
  .btn:disabled { opacity: 0.6; cursor: default; }
  .error { color: var(--danger); font-weight: 700; margin-top: 12px; }
  .note { color: var(--text-muted); font-size: 0.9rem; margin-top: 18px; }
</style>
