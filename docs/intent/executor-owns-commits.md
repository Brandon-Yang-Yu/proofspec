# executor-owns-commits — the persona owns its own commit rule

## The problem

`CLAUDE.md` Rule 6 ("The executor commits without waiting to be asked") restates, at
repo level, behavior that already lives where it belongs:

- its first bullet (commit as you go, merge once every gate is clean) is `executor.md`'s
  own Do list and design.md §37's "unattended, all the way to merge";
- its third bullet (a proven-wrong standard parks and asks) is `executor.md`'s own
  "The one exception: ask, then park" — the rule itself says so ("the exception
  `executor.md` already names");
- its second bullet (everyone else still asks before committing) restates the harness
  default for sessions the rule does not concern.

The one real function the rule ever performed — resolving "the default habit is ask
first" against "executor.md instructs committing" — belongs at the persona's own level:
a persona instruction *is* the explicit instruction the default asks for. A repo-level
rule read by every session (investigator, coordinator, a human's interactive session)
is noise for all of them and a second copy that silently drifts the moment
`executor.md` moves. Nothing else references Rule 6 (checked: no other file mentions
it).

## The change

1. `CLAUDE.md`: delete Rule 6 entirely. It is the last numbered rule; nothing after it
   renumbers.
2. `.pi/agents/executor.md`: add the section below, placed right after "What
   'unattended' actually means"; the existing Do-list bullet ("Commit as you go; merge
   once every gate the branch touches is clean") stays as the one-line form. Proposed
   wording in this file's register — adjust register if the surrounding text has
   moved, keep the content:

   > ## Commit on your own schedule
   >
   > Committing is this session's act at this session's timing: commit whenever work
   > stands — the red tests in place, the build green, a finding fixed — without waiting
   > for a human to say commit. The usual ask-before-committing habit does not apply to
   > this session, and the `/ship` pipeline's "wait for the human to say commit" step
   > is superseded — every other part of that pipeline's discipline stands, as the Do
   > list says.
   >
   > The one act that waits is merge, and it waits for gates, not for permission:
   > merge once every gate the branch touches is clean. Commit records progress; gates
   > judge the branch.

   The one exception stays exactly where the file already states it — this section
   adds the override and the timing, it does not touch the exception or duplicate
   anything from CLAUDE.md.
3. `docs/design.md`: record the why in a short passage near §49 (placement is yours to
   judge, ship step 8 discipline): a persona's pipeline behavior is owned by the
   persona's own file plus this design; repo-level project instructions are not a
   second source of pipeline truth. Include the timing principle in the same passage:
   committing is continuous at the executor's own discretion, and merge is the only act
   that waits — for every gate the branch touches to be clean.

This is a docs-only TASK: nothing in it asks for a test, so the tests-red round is
empty, the suite stays green throughout, and `touched` holds no gate over a change that
touches no test, TERM, or description.

## Done means

- CLAUDE.md carries no Rule 6 and no other commit-permission text.
- executor.md alone names the duty, the override of the ask-first habit, and the one
  exception — readable as a whole without CLAUDE.md.
- design.md carries the ownership rationale.
- `pnpm test` green; the docket reports this TASK mergeable.
