# dispatch-intent — the dedicated intent document lives in the TASK's queue entry

## The problem

A TASK's MANIFEST names its intent with an `intentRef`, and today that name is always a
file on the TASK's branch. For the normal TASK — whose intent is the settled spec file
itself — that is exactly right. For a TASK whose intent does not fit in `specs/*.md` — a
persona rewrite, a docs page, a change spanning several files — the intent has to travel
as a dedicated document committed to the branch, at `docs/intent/<task>.md`.

That document is a construction drawing for one TASK. It is written once, read cold by
the executor, and worth nothing once the TASK merges. The human's ruling on it is plain:
it does not need git tracking — it can sit as one file in the TASK's own directory under
`dispatch`. And the reference itself was never the problem: the dedicated class already
has an intent document, so `intentRef` keeps pointing at one — it just points into the
queue entry instead of onto the branch.

## The change

1. **`intentRef` stays a required field, read by one rule with two shapes.** The reserved
   name `INTENT` resolves against the TASK's own queue entry directory:
   `.proofspec/dispatch/<task>/INTENT`, a conventional file name in the family of
   `MANIFEST`, `state`, `LEASE`, and `heartbeat`. Any other value resolves against the
   TASK's branch, exactly as today.

2. **The spec class writes no extra document.** A TASK whose intent is the settled spec
   file keeps its `intentRef` naming that file on the branch. Nothing changes for that
   class.

3. **The dedicated-doc class writes its intent document as the queue entry's `INTENT`
   file.** The intent writer drafts it there; the investigator reads it back from there
   and presents it in the disposition review; nothing is committed for it. A
   dedicated-doc TASK's branch may reach `enqueue_task` carrying zero commits — there is
   nothing left that has to be committed before the work starts.

4. **Two trade-offs, accepted as design decisions.** First, the judged intent document is
   no longer pinned to a commit: a file in the queue entry can be rewritten with no
   trace, so the executor cold-reads what the file says now, not the hash the human
   judged. Accepted for this single-machine tool. Second, after merge the per-TASK record
   of what was settled vanishes when the queue entry is pruned (docs/design.md §39);
   `docs/design.md` keeps the mechanism's principles, not the per-TASK decisions.
   Accepted.

5. **This TASK is the transition.** It ships the mechanism, so at its own enqueue time
   the new rule does not exist yet: its own intent document is committed to its branch as
   `docs/intent/dispatch-intent.md`, under the rules in force now. TASKs after it use the
   `INTENT` file. Past `docs/intent/*.md` on `main` stay untouched.

## The settled disposition

Two rows rewrite; the ripple keeps. The two rewrites' judged prose lives in the spec
files themselves, committed on this branch — the executor never transcribes it.

| Row | Disposition |
| --- | --- |
| `specs/glossary.md`, the `### Term: MANIFEST` section | rewrite — written in place, committed on this branch |
| `specs/schedule.md`, the requirement "A relationship is judged by a fresh agent before a human is asked" | rewrite — written in place, committed on this branch |
| every requirement whose STANDARD uses MANIFEST | keep |

The rewritten requirement's existing scenario block stands; scenarios covering the
resolution path are the executor's tests-red to add.

The kept rows: `specs/schedule.md` ×4 (held-until-base, merge settle, startSession,
enqueue), `specs/handoff.md` ×2 (flattening, answers-result), `specs/inflight.md` ×4
(refused, census-absent, problem report, the "never reads intent" passage),
`specs/cli.md` ×1, `specs/docket.md` ×1, `specs/progress.md` ×1. No prose of theirs
moves.

## The build, after hand-off

- `src/cli/run.ts` (`intentsFor`) — the two-shape resolution, one function, used by the
  judge path.
- `src/cli/session.ts` (`kickoffFor`) — the initial message's wording; the spec leaves
  the exact words to the implementation.
- `.pi/agents/investigator.md` — the `intentRef` field description and the "Draft the
  intent doc" section: the dedicated doc is written to the queue entry's `INTENT` file,
  read back from there, never committed; a dedicated-doc TASK's branch may carry zero
  commits at enqueue.
- `.pi/agents/executor.md` — the cold-read instruction carries the same resolution rule.
- `.pi/agents/intent-writer.md` — the intent doc's destination becomes the queue entry's
  `INTENT` file for dedicated-doc TASKs.
- `docs/design.md` — a section recording the mechanism and both accepted trade-offs.
- Tests for all of the above; the suite stays green.

## Acceptance

This TASK's acceptance script sits at `.proofspec/dispatch/dispatch-intent/acceptance.md`
in the main checkout, untracked. The executor runs it through the acceptance checker
before `mergeable`, as the gate prescribes. Its steps check: the rewritten TERM and
requirement standing in the spec files; the ripple files byte-identical; the suite
green; a real end-to-end drive of the resolution through the bare CLI — a throwaway
repo holding two TASKs, one with its intent committed on its branch and one with its
intent in its queue entry's `INTENT` file, judged through a stand-in judge binary that
captures what it was asked; the kickoff message; the three personas; `docs/design.md`'s
record; and the past intent docs untouched.

## Done means

- The rewritten TERM and requirement stand in `specs/*.md` as this branch already
  holds them, and every ripple file is byte-identical to this TASK's base.
- The judge path resolves both shapes, and the end-to-end drive shows the fresh agent
  receiving both intents — the branch file's and the queue entry's.
- The kickoff message, the three personas, and `docs/design.md` carry the mechanism and
  both accepted trade-offs.
- Past `docs/intent/*.md` on `main` stay untouched, and no new one is committed after
  this TASK.
- `pnpm test` green; the docket reports this TASK mergeable.
