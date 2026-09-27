<script lang="ts">
  import { page } from '$app/state';
  import BrandMark from '$lib/components/BrandMark.svelte';
  import { safeNext as checkNext } from '$lib/safe-next.ts';
  import { tutorNames } from '$lib/tutors.ts';

  let password = $state('');
  let loading = $state(false);
  let errorMsg = $state('');
  let pwEl: HTMLInputElement;

  function safeNext(raw: string | null): string {
    return checkNext(raw, location.origin);
  }

  async function login() {
    if (!password) return;
    loading = true;
    errorMsg = '';
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (r.ok) {
        location.href = safeNext(page.url.searchParams.get('next'));
        return;
      }
      const j = await r.json().catch(() => ({}));
      errorMsg = j.error || 'סיסמה שגויה';
    } catch {
      errorMsg = 'תקלה בחיבור — נסו שוב';
    } finally {
      loading = false;
      password = '';
      pwEl?.focus();
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') login();
  }
</script>

<svelte:head>
  <title>כניסה — מאה בקליק</title>
</svelte:head>

<div class="auth-page">
  <div class="box">
    <div class="logo"><BrandMark height={40} href={null} label={null} /></div>
    <h1>לוח בקרה</h1>
    <p>{tutorNames()} · שיעורים פרטיים</p>
    <input
      type="password"
      placeholder="סיסמה"
      autocomplete="current-password"
      autofocus
      bind:value={password}
      bind:this={pwEl}
      onkeydown={onKeydown}
    />
    <button disabled={loading} onclick={login}>כניסה</button>
    <div class="err">{errorMsg}</div>
    <a href="/">← חזרה לאתר</a>
  </div>
</div>

<style>
  .auth-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
  }
  .box {
    background: var(--bg-card);
    border: 1.5px solid var(--border);
    border-radius: 20px;
    padding: 2.4rem 2rem;
    width: 100%;
    max-width: 380px;
    text-align: center;
    box-shadow: 0 4px 24px rgba(30, 41, 59, 0.07);
  }
  .logo { display: flex; justify-content: center; margin-bottom: 0.6rem; }
  h1 { font-size: 1.5rem; font-weight: 900; color: var(--accent); margin-bottom: 0.2rem; }
  p { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.6rem; }
  input {
    width: 100%;
    font-family: inherit;
    font-size: 1.05rem;
    text-align: center;
    letter-spacing: 0.08em;
    padding: 0.8rem;
    min-height: 50px;
    border: 2px solid var(--border);
    border-radius: 14px;
    background: var(--bg-base);
    color: var(--text-primary);
    outline: none;
  }
  input:focus { border-color: var(--accent); }
  button {
    width: 100%;
    margin-top: 0.8rem;
    background: var(--accent);
    color: #fff;
    font-family: inherit;
    font-weight: 800;
    font-size: 1rem;
    border: none;
    border-radius: 14px;
    padding: 0.8rem;
    min-height: 50px;
    cursor: pointer;
  }
  button:hover { opacity: 0.9; }
  button:disabled { opacity: 0.55; cursor: default; }
  .err { color: var(--danger); font-size: 0.88rem; min-height: 22px; margin-top: 0.7rem; }
  a { display: inline-block; margin-top: 1.2rem; color: var(--text-muted); font-size: 0.84rem; text-decoration: none; }
  a:hover { color: var(--accent); }
</style>
