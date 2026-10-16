<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>חיבור חדר Meet — מאה בקליק</title></svelte:head>

{#if data.state === 'ready'}
  <h1>היי {data.name} 👋</h1>
  <p class="lead">צעד אחד, ונפתח לכם חדר שיעורים קבוע ב-<bdi>Google Meet</bdi>. משפחות שבוחרות שיעור אונליין יקבלו אליו קישור אוטומטית.</p>
  {#if data.problem === 'denied'}<p class="error" role="alert">לא אישרתם את הגישה ב-Google. אפשר לנסות שוב.</p>{/if}
  {#if data.problem === 'google'}<p class="error" role="alert">משהו השתבש מול Google. נסו שוב בעוד רגע.</p>{/if}
  {#if data.problem === 'scope'}<p class="error" role="alert">החדר לא נפתח, כי ההרשאה ל-<bdi>Google Meet</bdi> לא סומנה. נסו שוב, וסמנו את התיבה של Google Meet לפני האישור.</p>{/if}
  <a class="btn" href={data.start}>התחברות עם Google</a>
  <ol class="steps">
    <li>בחרו את חשבון ה-<bdi>Google</bdi> שאיתו אתם נכנסים לשיעורים.</li>
    <li>אם <bdi>Google</bdi> מזהיר שהאפליקציה לא אומתה, זה צפוי: לחצו <b>מתקדם</b> (<bdi dir="ltr">Advanced</bdi>), ואז <b>מעבר אל…</b> (<bdi dir="ltr">Go to…</bdi>).</li>
    <li>אם מופיעות תיבות סימון, סמנו את כולן. אחר כך לחצו <b>המשך</b> או <b>אישור</b>. זהו.</li>
  </ol>
  {#if data.hasRoom}
    <p class="note">כבר יש לכם חדר. חיבור מחדש יפתח חדר חדש במקומו. שיעורים שכבר נקבעו ישמרו את הקישור הקודם, והוא ימשיך לעבוד.</p>
  {/if}
{:else if data.state === 'off'}
  <h1>היי {data.name}</h1>
  <p class="lead">החיבור ל-Google עוד לא הוגדר באתר. נסו שוב מאוחר יותר.</p>
{:else}
  <h1>הקישור לא תקף</h1>
  <p class="lead">הקישור פג תוקף או שכבר השתמשו בו. בקשו קישור חדש ממי ששלח לכם אותו.</p>
{/if}
