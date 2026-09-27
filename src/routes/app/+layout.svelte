<script lang="ts">
  /**
   * The app shell for everything under /app/*.
   *
   * IMPORTANT — do not add auth here. `/app/` is a PWA-scope and
   * in-app-navigation boundary, not an authentication boundary (spec §6):
   * /app/dashboard and /app/games require a tutor session, but
   * /app/parent, /app/student and /app/play/* are public (PIN-checked
   * client-side against /api/portal/:code). A blanket guard in
   * +layout.server.ts — or here — would lock children out of their own
   * homework. Each page that needs a session calls requireAuth(event) in
   * its own +page.server.ts instead. Do not "tidy" this upward.
   *
   * There is deliberately no shared nav chrome here: the four pages kept
   * their own very different chrome (dashboard's nav bar, the parent
   * portal's top-nav, the student page's hero, the games catalog's plain
   * header) exactly as pages/app/*.html had them. This layout's job is
   * routing — one entry point for the /app subtree — plus turning the
   * single hop between two of these pages (dashboard → parent portal) that
   * used to open `target="_blank"` into a same-tab in-app link, now that
   * they share this layout (sub-project #4). That is the one deliberate
   * UX change in this task.
   */
  let { children } = $props();
</script>

{@render children()}
