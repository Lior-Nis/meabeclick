<script lang="ts">
  import { onMount } from 'svelte';

  type Kind = 'subject' | 'topic' | 'subtopic' | 'goal';
  type Activity = { id: string; title: string; url: string | null; source: string; type: 'משחק' | 'תרגול'; dataId: string | null; completed: boolean; score: number | null; total: number | null; lastPlayedAt: string | null };
  type Lesson = {
    slug: string; title: string | null; topic: string | null; context: string | null;
    homework: unknown[]; games: { title: string; url: string | null; dataId?: string | null; completed?: boolean; score?: number | null; total?: number | null; lastPlayedAt?: string | null; broken: boolean }[];
  };
  type Progress = { total: number; completed: number; mastered: number; percent: number };
  type CurriculumSkill = { id: number; title: string; status: string; visibility: string };
  type CurriculumBranch = { id: number; title: string; visibility: string; progress: Progress; skills: CurriculumSkill[] };
  type CurriculumTopic = { id: number; title: string; visibility: string; progress: Progress; branches: CurriculumBranch[] };
  type Student = { id: string; name: string; subject: string; goals: string; level: string; progress: number };
  type Node = {
    id: string; sourceId?: number; sourceStatus?: string; kind: Kind; title: string; subtitle: string; status: string; progress: Progress;
    children: Node[]; activities: Activity[];
  };
  type FlatNode = Node & { depth: number; hasChildren: boolean };

  let { student, lessons = [], topics = [], onstatus }: { student: Student; lessons?: Lesson[]; topics?: CurriculumTopic[]; onstatus?: (nodeId: number, status: string) => void | Promise<void> } = $props();
  let expanded = $state<string[]>([]);
  let selected = $state<Node | null>(null);
  let manualAssignments = $state<Record<string, Activity[]>>({});
  let editingStatus = $state<string | null>(null);
  const statusOptions = [
    ['not_checked', 'לא נבדק'], ['started', 'התחלה'], ['guided', 'בתרגול מודרך'],
    ['with_help', 'בוצע עם עזרה'], ['independent', 'בוצע עצמאית'], ['needs_review', 'דורש חזרה'],
  ] as const;

  const statusLabels = ['טרם התחלנו', 'בתהליך', 'נדרש חיזוק', 'הושלם'];
  const statusClass: Record<string, string> = {
    'טרם התחלנו': 'status-not-started', 'בתהליך': 'status-progress',
    'נדרש חיזוק': 'status-needs-help', 'הושלם': 'status-done',
  };

  function slug(value: string): string {
    return value.toLocaleLowerCase('he').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '') || 'item';
  }

  function activityFor(lesson: Lesson, game: Lesson['games'][number], index: number): Activity {
    return { id: `${lesson.slug}:${game.dataId || game.title}:${index}`, title: game.title, url: game.url, source: lesson.title || lesson.topic || lesson.slug, type: 'משחק', dataId: game.dataId ?? null, completed: !!game.completed, score: game.score ?? null, total: game.total ?? null, lastPlayedAt: game.lastPlayedAt ?? null };
  }

  function statusFor(status: string): string {
    if (status === 'independent') return 'הושלם';
    if (status === 'guided' || status === 'with_help') return 'בתהליך';
    if (status === 'needs_review' || status === 'blocked') return 'נדרש חיזוק';
    return 'טרם התחלנו';
  }

  function skillProgress(status: string): Progress {
    const completed = status === 'independent' || status === 'with_help' ? 1 : 0;
    return { total: 1, completed, mastered: status === 'independent' ? 1 : 0, percent: completed ? 100 : 0 };
  }

  function aggregateProgress(items: Progress[]): Progress {
    const total = items.reduce((n, p) => n + p.total, 0);
    const completed = items.reduce((n, p) => n + p.completed, 0);
    const mastered = items.reduce((n, p) => n + p.mastered, 0);
    return { total, completed, mastered, percent: total ? Math.round((completed / total) * 100) : 0 };
  }

  function activitiesFor(title: string): Activity[] {
    return lessons
      .filter(lesson => lesson.topic === title || lesson.title === title)
      .flatMap(lesson => lesson.games.map((game, index) => activityFor(lesson, game, index)));
  }

  function buildCurriculumTopics(): Node[] {
    return topics.filter(topic => topic.visibility !== 'hidden').map(topic => {
      const topicActivities = activitiesFor(topic.title);
      const branches = topic.branches.filter(branch => branch.visibility !== 'hidden').map(branch => {
        const branchActivities = activitiesFor(branch.title);
        const skills = branch.skills
          .filter(skill => skill.visibility !== 'hidden')
          .map(skill => ({
            id: `goal:${skill.id}`, sourceId: skill.id, sourceStatus: skill.status, kind: 'goal' as const, title: skill.title,
            subtitle: 'יכולת מתוך תכנית הלימודים', status: statusFor(skill.status),
            progress: skillProgress(skill.status),
            activities: [...branchActivities, ...topicActivities], children: [],
          }));
        return {
          id: `subtopic:${branch.id}`, kind: 'subtopic' as const, title: branch.title,
          subtitle: `${branch.progress.completed} מתוך ${branch.progress.total} יעדים הושלמו`, status: skills.some(skill => skill.status === 'נדרש חיזוק') ? 'נדרש חיזוק' : branch.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: branch.progress,
          activities: [...branchActivities, ...topicActivities], children: skills,
        };
      });
      return {
        id: `topic:${topic.id}`, kind: 'topic' as const, title: topic.title,
        subtitle: `${topic.progress.completed} מתוך ${topic.progress.total} יעדים הושלמו · ${topicActivities.length} פעילויות`,
        status: topic.progress.completed ? 'בתהליך' : 'טרם התחלנו', progress: topic.progress,
        activities: topicActivities, children: branches,
      };
    });
  }

  function buildTree(): Node {
    if (topics.length) {
      const curriculumTopics = buildCurriculumTopics();
      return {
        id: `subject:${student.id}`, kind: 'subject', title: student.subject || 'תכנית אישית',
        subtitle: `${student.level || 'לפי רמת התלמיד'} · ${curriculumTopics.length} נושאים · ${curriculumTopics.reduce((n, t) => n + t.progress.completed, 0)} יעדים הושלמו`,
        status: curriculumTopics.some(t => t.progress.completed) ? 'בתהליך' : 'טרם התחלנו', progress: aggregateProgress(curriculumTopics.map(t => t.progress)),
        activities: curriculumTopics.flatMap(t => collectActivities(t)), children: curriculumTopics,
      };
    }
    const relevant = lessons;
    const lessonTopics = relevant.length
      ? relevant.map((lesson, i) => {
          const topicTitle = lesson.topic || lesson.title || `נושא ${i + 1}`;
          const activities = lesson.games.map((game, j) => activityFor(lesson, game, j));
          const subtopic: Node = {
            id: `subtopic:${lesson.slug}`, kind: 'subtopic', title: 'תרגול והעמקה',
            subtitle: lesson.context || 'התרגול שנוצר עבור השיעור הזה', status: 'בתהליך', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
            activities, children: [{
              id: `goal:${lesson.slug}`, kind: 'goal', title: `יעד: ${topicTitle}`,
              subtitle: lesson.context || 'ממשיכים לפי מה שנלמד בפועל', status: 'בתהליך', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
              activities, children: [],
            }],
          };
          return {
            id: `topic:${lesson.slug}`, kind: 'topic', title: topicTitle,
            subtitle: `${activities.length} פעילויות מחוברות`, status: lesson.games.length ? 'בתהליך' : 'נדרש חיזוק', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
            activities, children: [subtopic],
          } satisfies Node;
        })
      : [{
          id: 'topic:start', kind: 'topic', title: 'מיפוי והתחלה',
          subtitle: student.goals || 'נוסיף כאן את הנושא הראשון לאחר השיעור', status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 },
          activities: [], children: [{
            id: 'subtopic:start', kind: 'subtopic', title: 'אבחון קצר', subtitle: 'ניסיון ראשון לפני בחירת תרגול',
            status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, activities: [], children: [{
              id: 'goal:start', kind: 'goal', title: 'להגדיר יעד ראשון', subtitle: 'היעד יתעדכן לאחר דיווח השיעור',
              status: 'טרם התחלנו', progress: { total: 1, completed: 0, mastered: 0, percent: 0 }, activities: [], children: [],
            }],
          }],
        } satisfies Node];

    return {
      id: `subject:${student.id}`, kind: 'subject', title: student.subject || 'תכנית אישית',
      subtitle: `${student.level || 'רמה לא הוגדרה'} · ${topics.length} נושאים`,
      status: student.progress >= 100 ? 'הושלם' : student.progress > 0 ? 'בתהליך' : 'טרם התחלנו', progress: { total: lessonTopics.length, completed: 0, mastered: 0, percent: 0 },
        activities: lessonTopics.flatMap(t => collectActivities(t)), children: lessonTopics,
    };
  }

  function collectActivities(node: Node): Activity[] {
    return [...node.activities, ...node.children.flatMap(collectActivities)];
  }

  const tree = $derived(buildTree());
  const allActivities = $derived(Array.from(new Map(collectActivities(tree).map(a => [a.id, a])).values()));
  const visibleNodes = $derived.by(() => {
    const output: FlatNode[] = [];
    function visit(node: Node, depth: number) {
      output.push({ ...node, depth, hasChildren: node.children.length > 0 });
      if (expanded.includes(node.id)) node.children.forEach(child => visit(child, depth + 1));
    }
    visit(tree, 0);
    return output;
  });

  onMount(() => {
    try {
      const raw = localStorage.getItem(`learning-plan-assignments:${student.id}`);
      if (raw) manualAssignments = JSON.parse(raw);
    } catch { /* local assignments are an enhancement, not a blocker */ }
  });

  function toggle(node: Node) {
    const index = expanded.indexOf(node.id);
    if (index >= 0) expanded = expanded.slice(0, index);
    else expanded = [...expanded, node.id];
  }

  async function updateStatus(node: Node, status: string, event: MouseEvent) {
    event.stopPropagation();
    if (!node.sourceId || !onstatus) return;
    editingStatus = null;
    await onstatus(node.sourceId, status);
  }

  function openActivities(node: Node) { selected = node; }
  function closeActivities() { selected = null; }

  function assignedFor(node: Node): Activity[] {
    return [...collectActivities(node), ...(manualAssignments[node.id] ?? [])]
      .filter((a, i, arr) => arr.findIndex(x => x.id === a.id) === i);
  }

  function assignActivity(node: Node, activity: Activity) {
    const current = manualAssignments[node.id] ?? [];
    if (current.some(a => a.id === activity.id)) return;
    manualAssignments = { ...manualAssignments, [node.id]: [...current, activity] };
    localStorage.setItem(`learning-plan-assignments:${student.id}`, JSON.stringify(manualAssignments));
  }

  function activityCount(node: Node): number { return assignedFor(node).length; }
</script>

<section class="learning-tree" dir="rtl" aria-label={`תכנית הלמידה של ${student.name}`}>
  <div class="tree-intro">
    <div>
      <span class="tree-kicker">מפת הלמידה</span>
      <h3>מתקדמים בצעד שאפשר לראות</h3>
      <p>לחצו על ענף כדי לפתוח רק את הרמה הבאה. כך נשארים בתוך ההקשר ולא הולכים לאיבוד ברשימות.</p>
    </div>
    <div class="tree-legend" aria-label="מקרא צבעים">
      <span><i class="legend-dot subject-dot"></i>מקצוע</span>
      <span><i class="legend-dot topic-dot"></i>נושא</span>
      <span><i class="legend-dot subtopic-dot"></i>תת־נושא</span>
      <span><i class="legend-dot goal-dot"></i>יעד</span>
    </div>
  </div>

  <div class="tree-path" aria-live="polite">
    <span>תכנית אישית</span>
    {#each visibleNodes.filter(n => expanded.includes(n.id)).slice(-3) as n}
      <span class="path-separator">›</span><strong>{n.title}</strong>
    {/each}
  </div>

  <div class="tree-canvas" class:has-drawer={selected !== null}>
    <div class="tree-branches">
      {#each visibleNodes as node (node.id)}
        <div class="tree-row" style={`--depth:${node.depth}`}>
          {#if node.depth > 0}<span class="connector" aria-hidden="true"></span>{/if}
          <button class={`tree-node ${node.kind}`} class:selected={expanded.includes(node.id)} onclick={() => toggle(node)} aria-expanded={node.hasChildren ? expanded.includes(node.id) : undefined}>
            <span class="node-icon" aria-hidden="true">{node.kind === 'subject' ? '◈' : node.kind === 'topic' ? '◇' : node.kind === 'subtopic' ? '✦' : '●'}</span>
            <span class="node-copy"><strong>{node.title}</strong><small>{node.subtitle}</small></span>
            <span class={`status ${statusClass[node.status]}`}>{node.status}</span>
            <span class="node-progress" aria-label={`${node.progress.percent}% התקדמות, ${node.progress.completed} מתוך ${node.progress.total} יעדים`}>
              <span class="progress-track"><span style={`width:${node.progress.percent}%`}></span></span><small>{node.progress.percent}%</small>
            </span>
            {#if node.hasChildren}<span class="node-chevron" aria-hidden="true">{expanded.includes(node.id) ? '⌃' : '⌄'}</span>{/if}
          </button>
          {#if node.kind === 'goal' && onstatus}
            <div class="status-editor-wrap">
              <button class="status-edit" aria-label={`עדכון סטטוס עבור ${node.title}`} aria-expanded={editingStatus === node.id} onclick={(e) => { e.stopPropagation(); editingStatus = editingStatus === node.id ? null : node.id; }}>עדכון</button>
              {#if editingStatus === node.id}
                <div class="status-editor" role="group" aria-label={`סטטוס עבור ${node.title}`}>
                  {#each statusOptions as [value, label]}
                    <button class:active={node.sourceStatus === value} onclick={(e) => updateStatus(node, value, e)}>{label}</button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          <button class="activity-trigger" onclick={() => openActivities(node)} aria-label={`משחקים ותרגולים עבור ${node.title}`}>
            <span>☷</span><b>{activityCount(node)}</b><small>פעילויות</small>
          </button>
        </div>
      {/each}
    </div>

    {#if selected}
      <aside class="activity-drawer" aria-label={`פעילויות עבור ${selected.title}`}>
        <button class="drawer-close" onclick={closeActivities} aria-label="סגירת חלונית">×</button>
        <span class="drawer-kicker">פעילויות מחוברות</span>
        <h4>{selected.title}</h4>
        <p class="drawer-path">{student.subject} › {selected.title}</p>
        {#if assignedFor(selected).length}
          <div class="activity-list">
            {#each assignedFor(selected) as activity (activity.id)}
              {#if activity.url}
                <a class="activity-card" href={activity.url} target="_blank" rel="noopener">
                  <span class="activity-icon">🎮</span><span><strong>{activity.title}</strong><small>{activity.type} · {activity.source} · {activity.completed ? `בוצע${activity.score != null && activity.total != null ? ` (${activity.score}/${activity.total})` : ''}` : 'טרם בוצע'}</small></span><span class="open-arrow">↗</span>
                </a>
              {:else}
                <div class="activity-card unavailable"><span class="activity-icon">📝</span><span><strong>{activity.title}</strong><small>{activity.type} · ממתין לקישור</small></span></div>
              {/if}
            {/each}
          </div>
        {:else}
          <div class="drawer-empty"><span>◌</span><strong>עדיין אין פעילות בענף הזה</strong><p>אפשר לבחור פעילות קיימת או לפתוח את מאגר המשחקים כדי לבחור תבנית.</p></div>
        {/if}
        {#if allActivities.length}
          <label class="assign-label" for={`assign-${selected.id}`}>הוספת פעילות קיימת לענף</label>
          <select id={`assign-${selected.id}`} onchange={(e) => { const id = e.currentTarget.value; const a = allActivities.find(x => x.id === id); if (a) assignActivity(selected!, a); e.currentTarget.value = ''; }}>
            <option value="">בחרו משחק או תרגול…</option>
            {#each allActivities.filter(a => !assignedFor(selected!).some(x => x.id === a.id)) as activity (activity.id)}
              <option value={activity.id}>{activity.title} · {activity.source}</option>
            {/each}
          </select>
        {/if}
        <a class="catalog-link" href="/app/games">פתיחת מאגר המשחקים ↗</a>
      </aside>
    {/if}
  </div>
</section>

<style>
  .learning-tree { --tree-ink:#102a43; --tree-muted:#60758a; --tree-line:#cbd5e1; --tree-blue:#1e3a8a; --tree-blue-soft:#dbeafe; --tree-purple:#ede9fe; --tree-teal:#ccfbf1; background:#f8fafc; border:1px solid #d9e2ec; border-radius:20px; overflow:hidden; color:var(--tree-ink); }
  .tree-intro { display:flex; justify-content:space-between; gap:1rem; padding:1.25rem 1.35rem 1rem; background:linear-gradient(135deg,#f8fafc,#eef6ff); border-bottom:1px solid #dce7f2; }
  .tree-kicker,.drawer-kicker { color:#2563eb; font-size:.7rem; font-weight:900; letter-spacing:.08em; text-transform:uppercase; }
  .tree-intro h3 { margin:.25rem 0 .35rem; font-size:1.2rem; }
  .tree-intro p { margin:0; color:var(--tree-muted); font-size:.82rem; line-height:1.55; max-width:38rem; }
  .tree-legend { display:flex; flex-wrap:wrap; align-content:center; gap:.55rem .8rem; color:var(--tree-muted); font-size:.7rem; min-width:190px; }
  .tree-legend span { display:flex; align-items:center; gap:.3rem; white-space:nowrap; }
  .legend-dot { width:9px; height:9px; border-radius:50%; display:inline-block; }.subject-dot{background:#1e3a8a}.topic-dot{background:#93c5fd}.subtopic-dot{background:#a78bfa}.goal-dot{background:#2dd4bf}
  .tree-path { display:flex; align-items:center; gap:.4rem; padding:.75rem 1.35rem; color:var(--tree-muted); font-size:.75rem; min-height:42px; background:white; }.tree-path strong{color:var(--tree-ink)}.path-separator{color:#94a3b8;font-size:1rem}
  .tree-canvas { display:grid; grid-template-columns:minmax(0,1fr); position:relative; min-height:170px; }.tree-canvas.has-drawer{grid-template-columns:minmax(0,1fr) minmax(250px,34%)}
  .tree-branches { padding:1rem 1.35rem 1.35rem; min-width:0; }.tree-row { display:flex; align-items:center; gap:.55rem; position:relative; margin-top:.55rem; padding-right:calc(var(--depth) * 1.25rem); }.tree-row:first-child{margin-top:0}.connector{position:absolute; right:calc(var(--depth) * 1.25rem - .55rem); top:-.55rem; bottom:-.55rem; width:1px;background:var(--tree-line)}.connector:after{content:'';position:absolute;right:0;top:50%;width:.55rem;height:1px;background:var(--tree-line)}
  .tree-node { flex:1; min-width:0; display:flex; align-items:center; gap:.7rem; text-align:right; border:1px solid transparent; border-radius:14px; padding:.75rem .85rem; cursor:pointer; transition:border-color .18s,transform .18s,box-shadow .18s; }.tree-node:hover,.tree-node:focus-visible{transform:translateY(-1px);box-shadow:0 5px 16px #1e3a8a12;outline:none}.tree-node.subject{background:var(--tree-blue);color:#fff}.tree-node.topic{background:var(--tree-blue-soft);color:var(--tree-ink)}.tree-node.subtopic{background:var(--tree-purple);color:var(--tree-ink)}.tree-node.goal{background:var(--tree-teal);color:var(--tree-ink)}.tree-node.selected{border-color:#2563eb;box-shadow:0 0 0 3px #2563eb22}.node-icon{font-size:1.1rem;width:1.4rem;text-align:center;flex:none}.node-copy{display:flex;flex-direction:column;gap:.18rem;min-width:0;flex:1}.node-copy strong{font-size:.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node-copy small{font-size:.7rem;opacity:.78;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{font-size:.62rem;font-weight:800;border-radius:99px;padding:.25rem .45rem;white-space:nowrap;background:#ffffffaa;color:var(--tree-ink)}.tree-node.subject .status{background:#ffffff20;color:#fff}.status-progress{color:#1d4ed8}.status-needs-help{color:#c2410c}.status-done{color:#047857}.node-chevron{font-size:1.1rem;line-height:1;width:1rem;flex:none}.activity-trigger{display:flex;align-items:center;gap:.18rem;min-width:74px;justify-content:center;border:1px solid #d7e1eb;background:#fff;color:#2563eb;border-radius:12px;padding:.4rem .45rem;cursor:pointer;min-height:44px}.activity-trigger:hover,.activity-trigger:focus-visible{border-color:#2563eb;outline:3px solid #2563eb22}.activity-trigger span{font-size:1rem}.activity-trigger b{font-size:.76rem}.activity-trigger small{font-size:.62rem;color:var(--tree-muted)}
  .activity-drawer{border-right:1px solid #dce7f2;background:#fff;padding:1.1rem;position:relative;min-width:0;animation:drawer-in .2s ease-out}.drawer-close{position:absolute;left:.8rem;top:.65rem;border:0;background:transparent;color:var(--tree-muted);font-size:1.5rem;line-height:1;cursor:pointer;min-width:44px;min-height:44px}.activity-drawer h4{font-size:1.1rem;margin:.3rem 2rem .2rem 0}.drawer-path{color:var(--tree-muted);font-size:.72rem;margin:0 0 1rem}.activity-list{display:flex;flex-direction:column;gap:.5rem}.activity-card{display:flex;align-items:center;gap:.55rem;padding:.65rem;border:1px solid #e2e8f0;border-radius:12px;text-decoration:none;color:var(--tree-ink);background:#f8fafc;min-height:52px}.activity-card:hover{border-color:#2563eb;background:#eff6ff}.activity-card span:nth-child(2){display:flex;flex-direction:column;gap:.16rem;min-width:0;flex:1}.activity-card strong{font-size:.78rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-card small{font-size:.65rem;color:var(--tree-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.activity-icon{font-size:1.15rem}.open-arrow{color:#2563eb;font-size:1rem}.unavailable{opacity:.7}.drawer-empty{padding:1.4rem .6rem;text-align:center;color:var(--tree-muted)}.drawer-empty span{font-size:2rem;color:#94a3b8}.drawer-empty strong{display:block;color:var(--tree-ink);font-size:.84rem;margin-top:.4rem}.drawer-empty p{font-size:.72rem;line-height:1.5}.assign-label{display:block;font-size:.7rem;font-weight:800;margin:1rem 0 .35rem}.activity-drawer select{width:100%;border:1px solid #cbd5e1;border-radius:9px;background:white;padding:.6rem;font:inherit;font-size:.75rem;color:var(--tree-ink)}.catalog-link{display:block;margin-top:1rem;color:#2563eb;font-size:.75rem;font-weight:800;text-decoration:none}.catalog-link:hover{text-decoration:underline}
  @keyframes drawer-in{from{opacity:0;transform:translateX(-8px)}to{opacity:1;transform:translateX(0)}}
  @media (prefers-reduced-motion:reduce){.activity-drawer{animation:none}.tree-node{transition:none}}
  .node-progress{display:flex;align-items:center;gap:.3rem;min-width:52px;color:var(--tree-muted);font-size:.62rem}.progress-track{display:block;width:34px;height:5px;border-radius:99px;background:#dbe5ef;overflow:hidden}.progress-track span{display:block;height:100%;border-radius:inherit;background:#2563eb;transition:width .2s ease}.tree-node.subject .progress-track{background:#ffffff44}.tree-node.subject .progress-track span{background:#ffffff}
  .status-editor-wrap{position:relative;flex:none}.status-edit{min-height:44px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#2563eb;font:inherit;font-size:.68rem;font-weight:800;padding:.3rem .55rem;cursor:pointer}.status-editor{position:absolute;z-index:5;right:0;top:48px;display:flex;flex-direction:column;gap:4px;min-width:145px;padding:6px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 8px 24px #102a4320}.status-editor button{border:0;background:transparent;border-radius:8px;padding:8px;text-align:right;font:inherit;font-size:.7rem;cursor:pointer;color:var(--tree-ink)}.status-editor button:hover,.status-editor button.active{background:#eff6ff;color:#2563eb;font-weight:800}
  @media (max-width:700px){.tree-intro{display:block}.tree-legend{margin-top:.9rem}.tree-canvas.has-drawer{grid-template-columns:1fr}.activity-drawer{border-right:0;border-top:1px solid #dce7f2}.tree-branches{padding:.8rem}.tree-row{padding-right:calc(var(--depth) * .7rem);gap:.35rem}.connector{right:calc(var(--depth) * .7rem - .35rem)}.activity-trigger{min-width:62px}.activity-trigger small{display:none}.status{display:none}.tree-node{padding:.65rem}.node-copy small{font-size:.65rem}}
</style>
