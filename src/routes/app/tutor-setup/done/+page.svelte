<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>חדר ה-Meet מוכן — מאה בקליק</title></svelte:head>

{#if data.done}
  <h1>מוכן ✓</h1>
  <p class="lead">החדר שלכם ב-Google Meet:</p>
  <p class="room" dir="ltr"><a href={data.meetUrl} target="_blank" rel="noopener">{data.meetUrl.replace('https://', '')}</a></p>
  <a class="btn" href={data.meetUrl} target="_blank" rel="noopener">פתיחת החדר</a>
  {#if data.account}
    <p class="note">החדר נפתח בחשבון <b dir="ltr">{data.account}</b>. היכנסו ל-Meet עם החשבון הזה, כדי שתוכלו להכניס משפחות שמבקשות להצטרף.</p>
  {/if}
  <p class="note">המשפחות יקבלו את הקישור הזה אוטומטית. אפשר לשמור אותו גם אצלכם.</p>
{:else}
  <h1>החיבור לא הושלם</h1>
  <p class="lead">פתחו שוב את הקישור שקיבלתם בוואטסאפ ונסו שוב.</p>
{/if}
