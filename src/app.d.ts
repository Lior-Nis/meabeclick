import type { FamilyIdentity } from '$server/family-auth.ts';

declare global {
  namespace App {
    interface Locals {
      /** True when a valid tutor session cookie was presented. */
      authenticated: boolean;
      /**
       * The account or student a valid family cookie names, or null.
       *
       * Deliberately separate from `authenticated`: a family session must
       * never satisfy a tutor-only guard, and the tutor's session must never
       * be mistaken for a particular family. They are different audiences
       * with different cookies, and collapsing them into one boolean is how
       * a parent ends up reading the dashboard.
       */
      family: FamilyIdentity | null;
    }
  }
}
export {};
