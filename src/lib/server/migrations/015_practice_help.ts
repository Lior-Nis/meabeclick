/**
 * Migration 015 — how much help a play needed.
 *
 * `results_v2` records score, total, tries, stars, seconds and missed. All
 * of those are outcome and speed, and Todoist id:6hRhqRvfX7VHgh9q says
 * plainly why that is not enough: «ניקוד ומהירות לבדם אינם הוכחה להבנה» —
 * score and speed alone are not proof of understanding.
 *
 * A child who answered everything correctly after revealing every hint has
 * produced a perfect score and demonstrated something quite different from
 * a child who answered the same questions cold. Nothing in the schema could
 * tell those apart, so nothing downstream could either.
 *
 * That gap has already cost something concrete: the suggestion engine in
 * #100 had to DROP the design's own rule — «≥2 plays, ≥80%, no hints on the
 * last» — because there was no hints column and `tries` is not one (on a
 * memory board it counts cards turned, which is the game working as
 * designed). This restores the input that rule needs.
 *
 * Nullable, and null for every existing row. Null means "we did not
 * measure", which is not the same as zero — a play from before this
 * migration, or from a template with no hints to offer, must not read as
 * "needed no help". The suggestion engine treats null as unknown and says
 * nothing, which is the honest outcome.
 */
export const sql = `
ALTER TABLE results_v2 ADD COLUMN hints INTEGER;
`;
