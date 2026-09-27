<script lang="ts">
  import Icon from '$lib/icons/Icon.svelte';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { contactTutor } from '$lib/tutors.ts';
  import { TUTOR_PHONE } from '$lib/contact.ts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  /* Two doors, not one gate. A parent who lost their link asks for a new
     one; a child who was given a code types it. Neither is a password, and
     neither requires the tutor. */
  let mode = $state<'link' | 'code'>('link');

  let email = $state('');
  let linkState = $state<'idle' | 'sending' | 'sent'>('idle');
  let linkError = $state('');

  let joinCode = $state('');
  let joinBusy = $state(false);
  let joinError = $state('');

  async function requestLink() {
    linkError = '';
    const value = email.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      linkError = 'צריך כתובת מייל תקינה';
      return;
    }

    linkState = 'sending';
    try {
      const r = await fetch('/api/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        linkError = body.error || 'משהו השתבש. נסו שוב.';
        linkState = 'idle';
        return;
      }
      /* Deliberately the same confirmation whether or not the address is on
         file. Saying "we don't know that address" would turn this box into
         a way to check which families use the tutor. */
      linkState = 'sent';
    } catch {
      linkError = 'לא הצלחנו להתחבר. נסו שוב.';
      linkState = 'idle';
    }
  }

  async function submitCode() {
    joinError = '';
    const value = joinCode.trim();
    if (!value) return;

    joinBusy = true;
    try {
      const r = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        joinError = body.error || 'הקוד לא נכון.';
        joinBusy = false;
        return;
      }
      location.href = `/app/student?s=${encodeURIComponent(body.code)}`;
    } catch {
      joinError = 'לא הצלחנו להתחבר. נסו שוב.';
      joinBusy = false;
    }
  }
</script>

<svelte:head>
  <title>כניסה לדף האישי — מאה בקליק</title>
</svelte:head>

<div class="auth-page">
  <main class="card">
    <a class="brand" href="/">
      <BrandMark height={30} href={null} label={null} />
      <span>מאה בקליק</span>
    </a>

    {#if data.expired}
      <!-- /enter sends every failure here: expired, tampered, or naming a
           record that is gone. One message, because the next step is the
           same in all three cases. -->
      <p class="notice" role="status">
        הקישור כבר לא תקף. אפשר לקבל חדש למייל — זה לוקח רגע.
      </p>
    {/if}

    <h1>כניסה לדף האישי</h1>
    <p class="sub">בלי סיסמאות. בוחרים איך להיכנס:</p>

    <!-- Each door says who it is for AND how it works, so a child holding a
         code and a parent holding nothing both pick the right one without
         reading further. Two lines per tab keeps both abreast at 320px. -->
    <div class="tabs" role="tablist" aria-label="דרכי כניסה">
      <button
        role="tab" class="tab" class:active={mode === 'link'}
        aria-selected={mode === 'link'} aria-controls="pane-link"
        onclick={() => (mode = 'link')}
      >
        <span class="tab-who"><Icon name="family" size={18} /> הורים ותלמידים בוגרים</span>
        <span class="tab-how">כניסה דרך המייל</span>
      </button>
      <button
        role="tab" class="tab" class:active={mode === 'code'}
        aria-selected={mode === 'code'} aria-controls="pane-code"
        onclick={() => (mode = 'code')}
      >
        <span class="tab-who"><Icon name="student" size={18} /> תלמידים</span>
        <span class="tab-how">כניסה עם קוד</span>
      </button>
    </div>

    {#if mode === 'link'}
      <div class="pane" id="pane-link" role="tabpanel">
        {#if linkState === 'sent'}
          <div class="done" role="status">
            <div class="done-icon"><Icon name="email" size={40} /></div>
            <p class="done-title">שלחנו קישור</p>
            <p class="done-sub">
              אם הכתובת רשומה אצלנו, הקישור בדרך אליה. בדקו גם בספאם.
            </p>
            <button class="ghost" onclick={() => { linkState = 'idle'; }}>שליחה לכתובת אחרת</button>
          </div>
        {:else}
          <label for="portal-email">המייל שאיתו הזמנתם</label>
          <input
            id="portal-email" type="email" inputmode="email" autocomplete="email"
            dir="ltr" placeholder="name@example.com" bind:value={email}
            aria-invalid={!!linkError} aria-describedby={linkError ? 'err-email' : undefined}
            onkeydown={(e) => e.key === 'Enter' && requestLink()}
          />
          <div class="live" role="alert" aria-live="assertive">
            {#if linkError}<p class="err" id="err-email">{linkError}</p>{/if}
          </div>
          <button class="go" onclick={requestLink} disabled={linkState === 'sending'}>
            {linkState === 'sending' ? '...שולח' : 'שליחת קישור למייל'}
          </button>
          <p class="hint">
            נשלח קישור שפותח את הדף — בלי סיסמה ובלי לחכות לתשובה.
          </p>
        {/if}
      </div>
    {:else}
      <div class="pane" id="pane-code" role="tabpanel">
        <label for="join-code">קוד הכניסה של התלמיד/ה</label>
        <input
          id="join-code" type="text" inputmode="text" autocomplete="one-time-code"
          dir="ltr" placeholder="K7M-2QP" maxlength="8" bind:value={joinCode}
          aria-invalid={!!joinError} aria-describedby={joinError ? 'err-code' : undefined}
          onkeydown={(e) => e.key === 'Enter' && submitCode()}
        />
        <div class="live" role="alert" aria-live="assertive">
          {#if joinError}<p class="err" id="err-code">{joinError}</p>{/if}
        </div>
        <button class="go" onclick={submitCode} disabled={joinBusy}>
          {joinBusy ? '...בודק' : 'כניסה'}
        </button>
        <!-- The parent's page titles that section "כניסה ל<שם>", so point at
             it by shape rather than by a name it does not have. -->
        <p class="hint">
          ההורה מכין את הקוד בדף שלו, בקטע «כניסה ל…» עם השם שלך.
          הקוד תקף לשבוע ולכניסה אחת.
        </p>
      </div>
    {/if}

    <div class="links">
      <a href="/booking">להזמנת שיעור</a>
      <span aria-hidden="true">·</span>
      <a href="https://wa.me/{TUTOR_PHONE}" target="_blank" rel="noopener">כתבו ל{contactTutor().name}</a>
    </div>
  </main>
</div>

<style>
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }

  .card {
    max-width: 400px;
    width: 100%;
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: var(--r-lg);
    padding: 1.8rem 1.5rem 1.5rem;
    box-shadow: 0 16px 48px var(--shadow);
  }

  .brand {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-weight: 800;
    font-size: 1.05rem;
    color: var(--text-primary);
    text-decoration: none;
    margin-bottom: 1.2rem;
  }

  .notice {
    background: var(--bg-surface);
    border: 1.5px solid var(--accent);
    color: var(--text-primary);
    border-radius: var(--r-sm);
    padding: 0.7rem 0.9rem;
    font-size: 0.88rem;
    line-height: 1.6;
    margin-bottom: 1rem;
  }

  h1 { font-size: 1.3rem; font-weight: 800; text-align: center; }
  .sub {
    color: var(--text-muted); font-size: 0.9rem;
    text-align: center; margin-top: 0.35rem; margin-bottom: 1.1rem;
  }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
    background: var(--bg-base);
    border-radius: 12px;
    padding: 0.3rem;
    margin-bottom: 1.2rem;
  }
  .tab {
    border: none;
    background: transparent;
    border-radius: 9px;
    padding: 0.6rem 0.4rem;
    min-height: 44px;
    font-family: inherit;
    font-size: 0.87rem;
    font-weight: 700;
    color: var(--text-muted);
    cursor: pointer;
  }
  .tab.active { background: var(--bg-card); color: var(--accent); box-shadow: 0 1px 4px var(--shadow); }
  /* Two lines: who the door is for, then how it opens. */
  .tab { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; line-height: 1.25; }
  .tab-who { display: inline-flex; align-items: center; gap: 0.3rem; }
  .tab-how { font-size: 0.76rem; font-weight: 500; color: var(--text-muted); }
  .tab.active .tab-how { color: var(--accent-deep); }

  .pane label {
    display: block;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.35rem;
  }

  .pane input {
    width: 100%;
    /* 1rem so iOS Safari does not zoom the viewport on focus. */
    font-size: 1rem;
    padding: 0.75rem 0.9rem;
    min-height: 50px;
    border: 1.5px solid var(--border-strong);
    border-radius: var(--r-sm);
    font-family: inherit;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
  }
  #join-code {
    text-align: center;
    letter-spacing: 0.12em;
    font-weight: 800;
    font-size: 1.2rem;
    text-transform: uppercase;
  }
  .pane input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
  .pane input[aria-invalid='true'] { border-color: var(--danger); }

  /* Reserves no space until there is something to say, so the button does
     not jump when an error appears — but the error still lands above the
     button, where the eye already is. */
  .live:empty { display: none; }
  .err { color: var(--danger); font-size: 0.85rem; font-weight: 600; margin-top: 0.4rem; }

  .go {
    width: 100%;
    margin-top: 0.8rem;
    background: var(--accent);
    color: #fff;
    border: 0;
    padding: 0.8rem;
    min-height: 52px;
    border-radius: 12px;
    font-weight: 800;
    font-size: 1rem;
    cursor: pointer;
    font-family: inherit;
  }
  .go:hover { background: var(--accent-soft); }
  .go:disabled { opacity: 0.6; cursor: default; }

  .hint {
    font-size: 0.8rem; color: var(--text-muted);
    margin-top: 0.6rem; line-height: 1.55; text-align: center;
  }

  .done { text-align: center; padding: 0.5rem 0; }
  .done-icon { font-size: 2.2rem; }
  .done-title { font-weight: 800; font-size: 1.05rem; margin-top: 0.4rem; }
  .done-sub { color: var(--text-muted); font-size: 0.88rem; margin-top: 0.35rem; line-height: 1.6; }
  .ghost {
    margin-top: 0.9rem;
    background: transparent;
    border: 1.5px solid var(--border-strong);
    border-radius: 999px;
    padding: 0.55rem 1.1rem;
    min-height: 44px;
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-muted);
    cursor: pointer;
  }
  .ghost:hover { border-color: var(--accent); color: var(--accent); }

  .links {
    margin-top: 1.4rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 0.6rem;
    justify-content: center;
    align-items: center;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .links a { font-weight: 700; text-decoration: none; color: var(--accent); padding: 0.4rem 0.2rem; }
  .links a:hover { text-decoration: underline; }
</style>
