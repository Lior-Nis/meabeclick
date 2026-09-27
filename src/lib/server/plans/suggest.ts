/**
 * A draft opinion about a skill, from the practice evidence.
 *
 * PURE — no database, no clock, no writes. Spec §7 puts "any automatic
 * change to a plan" out of scope, and the approval gate is the feature
 * rather than an obstacle to route around; keeping this module unable to
 * write is how that stays true under later edits.
 *
 * What it is for: the tutor currently sets every skill by hand with no help
 * from evidence the system already collects. Not to decide — to offer, with
 * its workings shown.
 *
 * ## Silence is a result
 *
 * The most important rule here is the one that returns null. Below the bar
 * the engine says nothing rather than hedging: a suggestion the tutor has
 * to second-guess costs her more than no suggestion, and a wrong one shown
 * beside a child's name is worse than both.
 *
 * ## The hint clause, restored
 *
 * §3.2's rule reads "≥2 plays, ≥80% correct, **no hints on the last**".
 * When this shipped there was no hints column — `tries` is not one; on a
 * memory board it counts cards turned, which is the game working as
 * designed — so the clause was dropped rather than approximated.
 *
 * Migration 015 added the column, so the clause is back, and it guards
 * `independent` specifically: that status rests on two INDEPENDENT contexts
 * agreeing, and a play that needed hints is not a second context. It is the
 * first one again, with more support.
 *
 * `null` hints does NOT block. Most templates offer no hints at all and so
 * record none, and a child cannot use help that was never on offer —
 * treating null as "help used" would make `independent` unreachable for
 * every quiz ever played, which is a rule that exists without doing
 * anything. The honest ambiguity is a play from before migration 015, where
 * null really does mean unknown; `independent` also requires a graded piece
 * of homework, so that case still rests on a tutor's verdict rather than on
 * the gap alone.
 */
import type { SkillStatus } from '../../plan-status.ts';
import type { Play, SkillEvidence, Suggestion } from '../../skill-suggestion.ts';

/* The vocabulary lives in $lib/skill-suggestion.ts so the report form and
   this engine cannot drift apart — see that file for what drifting cost
   last time. Re-exported so existing importers of this module keep
   working. */
export type { Play, HomeworkEvidence, SkillEvidence, Suggestion } from '../../skill-suggestion.ts';

const STRONG = 80;
const WEAK = 50;
/** Three plays before a trend is a trend; two points are a line through
 *  noise. And a drop has to be big enough to mean something — teaching the
 *  tutor to ignore the flag is the way this feature dies. */
const TREND_MIN_PLAYS = 3;
const TREND_DROP = 15;

/* A date a tutor can read, from an ISO string, without Intl and without a
   clock — this module is pure and must stay so. Formatted by slicing the
   ISO prefix rather than via Date, which would apply the server's timezone
   and could move the day. Falls back to the raw value rather than throwing
   on anything unexpected: a badly shaped date should degrade the sentence,
   not lose the suggestion. */
const shortDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso ?? '');
};

const scored = (p: Play): boolean =>
  typeof p.score === 'number' && typeof p.total === 'number' && p.total > 0;

const pct = (p: Play): number => Math.round(((p.score as number) / (p.total as number)) * 100);

export function suggestStatus(evidence: SkillEvidence): Suggestion | null {
  const plays = (evidence.plays ?? []).filter(scored);

  /* One play is noise: a lucky quiz, a sibling on the tablet, a game
     replayed until it stuck. Nothing distinguishes those from learning. */
  if (plays.length < 2) return null;

  const byDate = [...plays].sort((a, b) => a.at.localeCompare(b.at));
  const accuracy = Math.round(byDate.reduce((sum, p) => sum + pct(p), 0) / byDate.length);
  const lastAt = byDate[byDate.length - 1].at;

  const base = { plays: byDate.length, accuracy, lastAt };
  const draft = (status: SkillStatus, why: string): Suggestion => ({ status, why, ...base });
  const counts = `${byDate.length} תרגולים, ${accuracy}%, אחרון ${shortDate(lastAt)}`;

  /* The one direction worth flagging on weak evidence. Being wrong about
     "she is struggling" costs a revisit; being wrong the other way costs a
     child moving on without the skill. */
  if (accuracy < WEAK) return draft('needs_review', `${counts} — מתחת לחצי`);

  if (accuracy >= STRONG) {
    /* A game is a SUPPORTED context — the options are on the screen — so
       however high the score it evidences "did it with help". independent
       needs a second, unsupported context, and it needs that context
       JUDGED: a submission is the student's claim, a grade is the tutor's
       verdict, and independent is the strongest thing the plan can say. */
    const graded = (evidence.homework ?? []).find(h => h.grade === 'ok');
    /* §3.2's hint clause: only help ACTUALLY USED blocks. See the header
       for why null does not — a child cannot use help a template never
       offered. */
    const lastHints = byDate[byDate.length - 1].hints;
    const lastUnaided = !(typeof lastHints === 'number' && lastHints > 0);

    if (graded && lastUnaided) {
      return draft('independent', `${counts}, ובנוסף שיעורי בית שנבדקו ואושרו (${shortDate(graded.at)})`);
    }
    if (graded) {
      return draft('with_help',
        `${counts} — התרגול האחרון נעזר ברמזים, ולכן לא עצמאי`);
    }
    return draft('with_help', `${counts} — במשחק, שהוא הקשר נתמך`);
  }

  /* 50-79% is exactly where a person would say "I need to watch her do it",
     so the engine says nothing — unless the direction is downward, which is
     a fact rather than an interpretation. */
  if (byDate.length >= TREND_MIN_PLAYS) {
    const earlier = byDate.slice(0, -1);
    const earlierAvg = earlier.reduce((s, p) => s + pct(p), 0) / earlier.length;
    const last = pct(byDate[byDate.length - 1]);
    if (earlierAvg - last >= TREND_DROP) {
      return draft('needs_review', `${counts} — התוצאות יורדות (${Math.round(earlierAvg)}% → ${last}%)`);
    }
  }

  return null;
}
