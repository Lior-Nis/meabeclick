/**
 * Migration 004 — the learning plan.
 *
 * A plan is one student's copy of a reviewed skill-tree template, for one
 * enrollment (student + subject). The copy is deliberate: editing a template
 * must never reshape a plan a tutor has already been marking against. Nodes
 * keep the template's stable `key` so a future opt-in re-sync can match them.
 *
 * `plan_events` is the history for EVERYTHING — status, hiding, pausing,
 * reordering and goal edits — because a status change is only trustworthy
 * next to the structure changes around it. Current status is NOT stored on
 * plan_nodes: it is the latest status event (see plans/view.ts), so the log
 * and the display cannot disagree.
 *
 * `source` is CHECKed to 'teacher' alone today. The lesson-report spec adds
 * 'report' and the evidence spec adds 'game'/'homework'; each is a one-line
 * migration that touches no other table. That is the point of the shape.
 */
export const sql = `
CREATE TABLE plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id       INTEGER NOT NULL REFERENCES students_v2(id),
  enrollment_id    INTEGER NOT NULL UNIQUE REFERENCES enrollments(id),
  template_id      TEXT    NOT NULL,
  template_version INTEGER NOT NULL,
  goal             TEXT    NOT NULL,
  exam_date        TEXT,
  focus            TEXT,
  created_at       TEXT    NOT NULL
);

CREATE TABLE plan_nodes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  key        TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES plan_nodes(id),
  kind       TEXT    NOT NULL CHECK (kind IN ('topic', 'branch', 'skill')),
  title      TEXT    NOT NULL,
  position   INTEGER NOT NULL,
  visibility TEXT    NOT NULL DEFAULT 'active'
             CHECK (visibility IN ('active', 'paused', 'hidden')),
  UNIQUE (plan_id, key)
);

CREATE INDEX plan_nodes_plan ON plan_nodes (plan_id, parent_id, position);

CREATE TABLE plan_prereqs (
  skill_id    INTEGER NOT NULL REFERENCES plan_nodes(id),
  requires_id INTEGER NOT NULL REFERENCES plan_nodes(id),
  PRIMARY KEY (skill_id, requires_id)
);

CREATE TABLE plan_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  node_id    INTEGER REFERENCES plan_nodes(id),
  type       TEXT    NOT NULL
             CHECK (type IN ('created', 'status', 'visibility', 'move', 'goal')),
  status     TEXT    CHECK (status IN ('not_checked', 'started', 'guided', 'with_help', 'independent', 'needs_review')),
  visibility TEXT    CHECK (visibility IN ('active', 'paused', 'hidden')),
  note       TEXT,
  evidence   TEXT    CHECK (evidence IN ('lesson', 'homework', 'game', 'test', 'other')),
  source     TEXT    NOT NULL DEFAULT 'teacher' CHECK (source IN ('teacher')),
  at         TEXT    NOT NULL
);

CREATE INDEX plan_events_node ON plan_events (node_id, id);
`;
