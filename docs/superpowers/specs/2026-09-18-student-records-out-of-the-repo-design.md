# Student and payment records out of the code repo

Todoist `id:6hMjCvfjpp2Vm5hq`. Design only — nothing is moved or deleted by
this document, and the steps that would are called out as needing a decision
and a word with Nicole first.

## 1. What is actually there

Assessed structurally, without opening any of it (CLAUDE.md: never read
`mea-beclick-kb/students/` or `mea-beclick-kb/pricing/`).

| | |
|---|---|
| Tracked files under `mea-beclick-kb/students/` | 8 — 4 `.md`, 3 `.pdf`, 1 `.html` |
| Tracked files under `mea-beclick-kb/pricing/` | 2 |
| In `.gitignore`? | No |
| Repo visibility | **Private** |

Two facts shape everything below.

**It is not only notes.** Three PDFs and an HTML file sit alongside the
Markdown. Structured facts about a student — who they are, what they owe,
what was booked — already live in SQLite (`students_v2`, `accounts`,
`enrollments`, `payments`), which is backed up nightly and now
restore-proven from Drive. The documents are not in SQLite and have nowhere
else to be. So "the database is the source of truth" is a true statement
that does not, by itself, finish this task.

**The repo is private.** That is the difference between a live incident and
a standing risk. It bounds the urgency, not the requirement: the records are
in git history, replicated to every clone and to GitHub, and they are read
by an AI agent on every session that greps the tree.

## 2. What "authorized storage" should mean here

Three candidates, judged against the fact that this is one tutor with a
handful of students, not an institution.

**Google Drive on the business account — recommended.** Already integrated
(`server/drive/`), already the backup target, already owned by
`mea.beclick@gmail.com` rather than by a personal account. There is an open
task, `id:6hRQQVWxcCgrjRCq`, to connect Drive to the student folder so
prepared lessons save and sync there — the same store, arrived at from the
other direction. Choosing Drive here makes those one piece of work instead
of two.

**A second private repo.** Cheap and familiar, and wrong for this content: it
keeps documents in version control, where deletion is not deletion, and it
puts PII one `git clone` from anyone who gets read access for an unrelated
reason.

**SQLite only, documents discarded.** Honest about the structured half and
lossy about the rest. The PDFs presumably exist because someone needed them.

## 3. The shape of the change

1. **Stop the bleeding.** `mea-beclick-kb/students/` and
   `mea-beclick-kb/pricing/` go into `.gitignore`, so nothing new is
   committed while the rest is decided.
2. **Move the content** to the Drive folder, under the business account,
   with the vault keeping a pointer note rather than the records.
3. **Untrack** the files (`git rm --cached`), which leaves them on disk
   locally and removes them from future commits.
4. **Purge history** — only if the decision in §4 says so.
5. **Teach the agent.** `CLAUDE.md` already says never to read those
   directories. Once they are gone it should say where the records now live
   and that the repo is not it.

## 4. The two decisions this needs, and why they are not mine

**Does history get rewritten?** Untracking stops the files changing from now
on; it does not remove them from the commits that already exist. Purging
means `git filter-repo` and a force-push, which:

- rewrites every commit hash from the first touch onward;
- breaks every existing clone — **Nicole is actively committing to `main`**,
  and her clone would need re-cloning, mid-work;
- does not reach copies GitHub has already served, so it is mitigation
  rather than erasure.

For a private repo with a handful of records, my recommendation is to
untrack and ignore now, and schedule a purge for a moment when nobody is
mid-branch — not to force-push under someone's feet.

**Who owns the Drive folder, and who may read it?** The backup folder is
owned by the business account. Student documents want the same owner and a
narrower share list than "anyone with the link". That is Nicole's call about
her own students' records.

## 5. What would be true when this is done

- `git ls-files mea-beclick-kb/students mea-beclick-kb/pricing` returns
  nothing.
- Both paths are in `.gitignore`.
- A pointer note in the vault names the Drive location and its owner, and no
  record content.
- `CLAUDE.md` tells the next agent where the records are and that the repo
  is not it.
- No student name, phone, address or payment figure appears in any file this
  repo tracks — checked, not assumed.

## 5.1 That check, run — 20.9.2026

It had not been run. Running it found PII outside `students/` and
`pricing/` entirely, in application source:
`src/routes/api/availability/+server.ts` carried six of Nicole's own
calendar identifiers as literals — her personal Gmail, her university
address, and four private calendar ids.

Measured on the box the same day: `CALENDAR_ICS_URLS` is set and
`GOOGLE_API_KEY` is not, so `/api/availability` returns before that list is
ever read. Six personal identifiers in source, for no behaviour at all.
They now come from `AVAILABILITY_CALENDAR_IDS`.

Everything else the scan turned up across the other 509 tracked files was a
fixture (`0501234567`, `@example.com`) or the tutor's published business
number, which is on the booking page by design.

Two things this changes about the rest of this document:

- **The scope was wrong.** §6 put the database out of scope and §1 framed
  the problem as the vault's `students/` and `pricing/` directories. The
  first PII actually found was in neither. A done-condition that says
  "checked" has to name the check.
- **The history argument gets stronger, not weaker.** These identifiers are
  in every commit that touched that file, so untracking does nothing for
  them. That is the same §4 decision — still the user's, still best taken
  when nobody is mid-branch.

## 6. Deliberately not in scope

Removing PII from the **database** — that is where it belongs, and where the
app reads it. This is about the code repo only.

## 7. The purge, run — 22.9.2026

§4 left the history rewrite as the user's decision and recommended waiting
for a moment when nobody was mid-branch. The user took it, in coordination
with Nicole: force-pushing `main` is authorized and she rebases once.

What ran, on a repo backed up first to `~/mea-beclick-purge-backup-*`
(`full-history.bundle` from `--all`, plus a copy of the records, `chmod 700`):

```
git filter-repo --invert-paths \
  --path mea-beclick-kb/students --path mea-beclick-kb/pricing \
  --replace-text  <9 rules> \
  --replace-message <9 rules>
```

Nine rules: the six identifiers from §5.1, plus three domain patterns added
after a trial run showed the university domain surviving in 38 commit
messages — my own prose about the leak, which the literal-identifier rules
did not match. Prose is part of history too.

Verified after the rewrite, across every ref:

| | |
|---|---|
| Blobs under the two purged paths | 0 |
| The six identifiers, in file content | 0 |
| The six identifiers, in commit messages | 0 |
| Commits reachable | 505 |
| `HEAD^{tree}` vs. before the rewrite | **identical** |

That last row is the one worth keeping. The purge was trialled on a scratch
clone until the working tree it produced was byte-identical to the real one,
which proves the rewrite changes history and nothing else. The first trial
was *not* identical: it surfaced `scripts/connect-calendar.sh`, which
defaulted to one of Nicole's private calendar ids. The §5.1 audit had missed
it because that audit filtered `@gmail.com` as a fixture domain. A tree diff
finds what a grep with an exclusion list does not — so the diff was fixed at
HEAD first (`b1ae35b`), and only then did the trial come back identical.

### What this does not do

**All 44 branches are done** — the other 43 were force-pushed after `main`.
Verified against a fresh `--mirror` clone of the remote rather than the local
copy: 511 commits reachable from branches, **0** touching the purged paths,
**0** occurrences of any of the six identifiers in file content or commit
messages.

**It does not reach GitHub's pull-request refs, and those are the bulk of
what is left.** `refs/pull/*` is served read-only by GitHub and preserves
every commit a PR ever had. Measured on that same mirror:

| | |
|---|---|
| Pull refs | 93 |
| Pre-rewrite commits reachable *only* through them | 528 |
| Of those, commits touching the purged paths | 1 |
| Blobs containing each identifier | 412, except one at 1446 |

So the pre-rewrite history is still fully fetchable by anyone who can clone
the repo, via `git fetch origin 'refs/pull/*:refs/pull/*'`. A force-push
cannot remove them; nothing a repo owner can do from a client can. The
documented route is to ask GitHub Support to purge the cached views and PR
references after a history rewrite. The alternative — delete and recreate
the repository — takes the PRs, issues and review history with it.

What this means honestly: **the branch purge narrows the surface, it does
not close it.** The repo is private, so the audience is unchanged — anyone
with read access could always see the records.

**Decided 22.9.2026: accepted, not escalated.** The owner is the only
maintainer, so the population that can reach `refs/pull/*` is one person who
already has every record anyway. Neither remaining route is worth its cost
against that: a Support request buys nothing the private flag does not
already give, and deleting the repository would trade the whole review
history for it.

This is a standing decision, not an oversight. Do not reopen it on the
strength of the numbers above — they were known when it was made. It changes
only if the repo gains a second maintainer, goes public, or is forked, and
any of those is the moment to reread this paragraph. Rotating the four
calendar ids remains cheap and worth doing whenever convenient.

**It does not reach what GitHub has already served.** Orphaned objects stay
fetchable by SHA until GitHub garbage-collects; forks and caches are outside
this repo's reach entirely. This was true in §4 and is still true. The
identifiers should be treated as disclosed, and the calendar ids rotated if
that is cheap.

**It does not move anything to Drive.** §3 step 2 and the §4 ownership
decision are untouched — the records now live only on the user's disk and in
the backup, ignored by git and named nowhere.
