import { sql as sql001 } from './001_entities.ts';
import { sql as sql002 } from './002_family_access.ts';
import { sql as sql003 } from './003_payment_kinds.ts';
import { sql as sql004 } from './004_learning_plans.ts';
import { sql as sql005 } from './005_lesson_reports.ts';
import { sql as sql006 } from './006_backfill_booking_enrollment.ts';
import { sql as sql007 } from './007_nullable_report_enrollment.ts';
import { sql as sql008 } from './008_results_identity.ts';
import { sql as sql009 } from './009_lesson_requests.ts';
import { sql as sql010 } from './010_student_profile.ts';
import { sql as sql011 } from './011_covered_and_corrections.ts';
import { sql as sql012 } from './012_lesson_materials.ts';
import { sql as sql013 } from './013_homework_two_stages.ts';
import { sql as sql014 } from './014_homework_skill_link.ts';
import { sql as sql015 } from './015_practice_help.ts';
import { sql as sql016 } from './016_marketing_events.ts';
import { sql as sql017 } from './017_lesson_reminders.ts';
import { sql as sql018 } from './018_homework_held.ts';
import { sql as sql019 } from './019_drive_items.ts';
import { sql as sql020 } from './020_drive_sync_baseline.ts';
import { sql as sql021 } from './021_pending_bookings.ts';
import { sql as sql022 } from './022_homework_answer.ts';
import { sql as sql023 } from './023_library_items.ts';
import { sql as sql024 } from './024_library_uses.ts';
import { sql as sql025 } from './025_lesson_engines.ts';
import { sql as sql026 } from './026_engine_status.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Applied in ascending version order. Add new migrations here — the
 *  registry is explicit rather than discovered from disk (see 001_entities.ts). */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: '001_entities', sql: sql001 },
  { version: 2, name: '002_family_access', sql: sql002 },
  { version: 3, name: '003_payment_kinds', sql: sql003 },
  { version: 4, name: '004_learning_plans', sql: sql004 },
  { version: 5, name: '005_lesson_reports', sql: sql005 },
  { version: 6, name: '006_backfill_booking_enrollment', sql: sql006 },
  { version: 7, name: '007_nullable_report_enrollment', sql: sql007 },
  { version: 8, name: '008_results_identity', sql: sql008 },
  { version: 9, name: '009_lesson_requests', sql: sql009 },
  { version: 10, name: '010_student_profile', sql: sql010 },
  { version: 11, name: '011_covered_and_corrections', sql: sql011 },
  { version: 12, name: '012_lesson_materials', sql: sql012 },
  { version: 13, name: '013_homework_two_stages', sql: sql013 },
  { version: 14, name: '014_homework_skill_link', sql: sql014 },
  { version: 15, name: '015_practice_help', sql: sql015 },
  /* 016 lands after 017 in production (017 merged first); pending() applies
     every missing version regardless of order, and the two touch disjoint
     tables, so the gap is safe. */
  { version: 16, name: '016_marketing_events', sql: sql016 },
  { version: 17, name: '017_lesson_reminders', sql: sql017 },
  { version: 18, name: '018_homework_held', sql: sql018 },
  { version: 19, name: '019_drive_items', sql: sql019 },
  { version: 20, name: '020_drive_sync_baseline', sql: sql020 },
  { version: 21, name: '021_pending_bookings', sql: sql021 },
  { version: 22, name: '022_homework_answer', sql: sql022 },
  { version: 23, name: '023_library_items', sql: sql023 },
  { version: 24, name: '024_library_uses', sql: sql024 },
  { version: 25, name: '025_lesson_engines', sql: sql025 },
  { version: 26, name: '026_engine_status', sql: sql026 },
];
