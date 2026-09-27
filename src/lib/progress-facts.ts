/**
 * What a child is told about how they are doing — the shape, declared once.
 *
 * This lives in $lib rather than $lib/server because three places need to
 * agree on it and two of them are pages. It used to be declared in
 * src/lib/server/progress.ts and then hand-copied into each page, which is
 * how the parent portal came to render
 *
 *     [object Object]%
 *
 * under «רמת התקדמות כללית»: PR #93 turned `progress` from an integer into
 * this object, the student page's copy was updated, the parent page's was
 * not. Nothing caught it, because the page was type-checked against its own
 * stale copy — `progress?: number` — which agreed with the wrong code.
 *
 * Importing this type is what makes the next divergence a compile error
 * rather than something a parent notices first.
 */
export interface ProgressFacts {
  /** Which figure the page should lead with. */
  kind: 'skills' | 'homework' | 'none';
  done: number;
  total: number;
  /** Only ever derived from `done`/`total`, so it can always be checked. */
  percent: number;
  /** The tutor's own sentence, which is worth more than any of the above. */
  note: string | null;
  /** The skills behind the figure, by name. Null when the student has no
   *  plan — there is nothing to list, and two empty lists would read as
   *  "nothing covered, nothing understood". */
  seen: SkillsSeen | null;
}

/**
 * PRODUCT.md's definition of done for "Progress parents can see": what was
 * COVERED and what the child UNDERSTOOD, without having to ask the tutor.
 *
 * Statuses and names only (progress design note §3.3): no suggestions, no
 * internal notes. `covered` deliberately does not say how a covered skill
 * is going — "needs review" is a note the tutor writes to steer the next
 * lesson, not a verdict to hand a family.
 */
export interface SkillsSeen {
  /** Taught in a lesson and not yet understood, most recent first. */
  covered: string[];
  /** Understood — done with help or independently — in plan order, with
   *  the same label the tutor's plan page uses. */
  understood: Array<{ title: string; label: string }>;
}
