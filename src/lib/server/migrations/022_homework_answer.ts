/**
 * Migration 022 — an answer key per homework task, for the tutor only.
 *
 * Both generators write it: the lesson generated at booking (prep.ts) and
 * the homework generated from what was taught (lesson/homework.ts). It
 * reaches the tutor's dashboard (TutorHomework) and no family route: those
 * map homework fields one by one, and tests/unit/homework-answer-key.test.mjs
 * fails if one names it. NULL for every task older than this, for tasks the
 * tutor typed herself, and when a generator gave none.
 */
export const sql = `
ALTER TABLE homework ADD COLUMN answer TEXT;
`;
