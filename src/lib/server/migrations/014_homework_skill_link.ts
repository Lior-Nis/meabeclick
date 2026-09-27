/**
 * Migration 014 — a homework task knows which skill it practises.
 *
 * From docs/superpowers/specs/2026-09-21-progress-from-evidence-design.md
 * §2: the evidence a skill assessment wants already exists — `results_v2`
 * carries score, tries, hints and seconds per play; `homework` carries the
 * task and its game — and **neither is connected to a skill**. Every
 * evidence-based suggestion in §3.2 dies on that missing link.
 *
 * ## Two links, because there are two kinds of practice
 *
 * My first draft put the link only on `homework`, reasoning that a game
 * play reaches a skill through `results_v2 → (student_id, data_id) →
 * homework`. That is wrong here, and the code says so: generated homework
 * is written with `dataId: null` on purpose (see appendToPortal — every
 * task used to be handed the lesson's first game, so finishing one quiz
 * ticked four pen-and-paper exercises). Generated homework is OFFLINE work.
 * A lesson's games are published separately and are not homework rows at
 * all, so that chain reaches nothing.
 *
 * So:
 *
 *   - `homework.node_id` — the written work the tutor grades.
 *   - `game_skills` — which skill a published game practises, for one
 *     student. `results_v2` then reaches a skill by (student_id, data_id).
 *
 * These are two different objects, not one fact stored twice.
 *
 * `game_skills` is keyed on **(student_id, data_id)** and not on `data_id`
 * alone. A data id is shared across every child assigned the same game —
 * that is why homeworkForStudent already matches `r.student_id =
 * h.student_id` — and a bare data_id key would make one child's play into
 * evidence about another child's skill.
 *
 * ## Nullable, and mostly null
 *
 * A lesson generated for a student with no plan, or whose plan has nothing
 * left to teach, tags nothing. Null means "this practice is not evidence
 * about any skill", which is the honest reading and the one the suggestion
 * engine must treat as silence rather than as a zero.
 *
 * Existing rows stay null. There is no backfill and there should not be:
 * attributing past homework to a skill would be a guess, and a guess
 * recorded as evidence is worse than no evidence.
 *
 * ## Why ALTER rather than a rebuild
 *
 * 013 rebuilt this table to change its columns' meaning. This only adds
 * one, so `ALTER TABLE ... ADD COLUMN` is exact and cheap. The reference to
 * plan_nodes is a real foreign key — unlike 013's `lesson_id`, which
 * pointed at an unadopted table — because plan_nodes is written on every
 * plan the tutor creates.
 */
export const sql = `
ALTER TABLE homework ADD COLUMN node_id INTEGER REFERENCES plan_nodes(id);

CREATE INDEX IF NOT EXISTS homework_node ON homework (node_id);

CREATE TABLE IF NOT EXISTS game_skills (
  student_id INTEGER NOT NULL REFERENCES students_v2(id),
  data_id    TEXT    NOT NULL,
  node_id    INTEGER NOT NULL REFERENCES plan_nodes(id),
  at         TEXT    NOT NULL,
  PRIMARY KEY (student_id, data_id)
);

CREATE INDEX IF NOT EXISTS game_skills_node ON game_skills (node_id);
`;
