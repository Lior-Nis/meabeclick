# mea-beclick

mea-beclick is the site and booking flow for the מאה בקליק private tutoring service.

## Knowledgebase

Product requirements, the vision, and binding decisions live in one file:
`PRODUCT.md` at the repo root. It overrides any other document that
disagrees; git is the history.

- `mea-beclick-kb/students/`, `mea-beclick-kb/pricing/` — real student and
  payment records (PII — see below). **Not in this repo.** They are
  untracked, `.gitignore`d, and purged from git history; they exist only on
  the tutor's own disk. Do not read them, do not commit them, and do not
  re-add either path to version control. If you need a fact about a student,
  the database has it (`students_v2`, `accounts`, `enrollments`,
  `payments`) — see
  `docs/superpowers/specs/2026-09-18-student-records-out-of-the-repo-design.md`.

## Company context

Business context for this project — what Nix is, who the client is, what the
current bet is — lives in the company knowledgebase at `~/Projects/nix`.

- Venture note: `ventures/MeaBeclick.md`
- Company: `company/Nix.md`, `company/Current Bet.md`

Student and payment records stay in `mea-beclick-kb/` (this repo) and never
go to `~/Projects/nix`.

Do not duplicate that context here, and do not write project research there —
see `~/Projects/nix/_meta/project-kb-boundary.md`.
