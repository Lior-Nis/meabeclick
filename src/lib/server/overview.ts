/**
 * The family overview: every child on the account with the facts a card
 * shows, plus the family's own totals.
 *
 * Assembled here rather than in the route so the page's server load can
 * render it directly — the overview is the landing view for a parent with
 * siblings, and fetching it after mount would put a spinner in front of the
 * first thing they see.
 */
import type { FamilyAccess } from './family.ts';
import { readPortalSummary } from './portal-file.ts';
import { balanceForAccount, balanceForStudent, type AccountBalance } from './payments.ts';
import { nextBookingForStudent } from './entities.ts';
import { homeworkForStudent } from './lessons.ts';
import { lessonWhen } from '../dates.ts';
import { homeworkState } from '../family-homework.ts';

/** The next booked lesson, at its Israel date and time. */
function nextLessonFor(studentId: number): { date: string; time: string } | null {
  const next = nextBookingForStudent(studentId);
  return next ? lessonWhen(next.start) : null;
}

export interface OverviewChild {
  code: string;
  name: string;
  emoji: string;
  subject: string;
  level: string;
  nextLesson: { date: string; time: string } | null;
  openHomework: number;
  lessonCount: number;
  dueAgorot: number;
  upcomingAgorot: number;
  paidAgorot: number;
}

export interface FamilyOverview {
  accountName: string;
  isSelf: boolean;
  family: AccountBalance;
  children: OverviewChild[];
}

/**
 * @param asOf `YYYY-MM-DD`. One notion of "today" for every figure on the
 *             page, so the family total and each child's card cannot
 *             disagree about whether a lesson has happened.
 */
export function buildOverview(access: FamilyAccess, asOf: string): FamilyOverview {
  return {
    accountName: access.account.name,
    isSelf: access.isSelf,
    family: balanceForAccount(access.account.id, asOf),
    children: access.students.map(s => {
      const summary = readPortalSummary(s.code);
      const balance = balanceForStudent(s.id, asOf);
      return {
        code: s.code,
        name: s.name,
        emoji: s.emoji ?? '🎓',
        // A missing or corrupt portal file thins this one card rather than
        // blanking the page for the child's siblings.
        subject: summary?.subject ?? '',
        level: summary?.level ?? '',
        /* Both from the database, like the child's own board. The file's
           next lesson was frozen at booking time, and its homework list is
           no longer written — so the overview said 0 open tasks while the
           child's board showed several. */
        nextLesson: nextLessonFor(s.id),
        openHomework: homeworkForStudent(s.id).filter(h => homeworkState(h) === 'open').length,
        lessonCount: summary?.lessonCount ?? 0,
        dueAgorot: balance.dueAgorot,
        upcomingAgorot: balance.upcomingAgorot,
        paidAgorot: balance.paidAgorot,
      };
    }),
  };
}
