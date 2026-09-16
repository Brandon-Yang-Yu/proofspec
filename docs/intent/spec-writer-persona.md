# spec-writer-persona — the spec writer drafts, the investigator never does

## The problem

The investigator drafts every die/rewrite/new row's prose itself, inside the same session
that talked the intent through. Two things follow. The conversation's holder is a poor
judge of their own fresh wording — the same reason the executor's pipeline spawns fresh
reviewers for code rather than letting its author review it. And the conversation is
where history narration lives: a drafter writing out of memory produces rationale that
tells the reader how the draft got there instead of why today's design is right.

The house prose discipline exists and is precise — a requirement's rationale states the
current, correct design and why it is correct, never the history of how the draft got
there; an alternative is worth naming only when it is a standing design principle the
design keeps re-asserting; a revision that makes earlier reasoning untrue drops that
reasoning; the register follows the surrounding spec — but it lives only in
`.claude/skills/ship/SKILL.md` step 1, a legacy skill the investigator is never pointed
at. The discipline governs exactly the prose the investigator writes, and it has no home
in the persona that writes it.

## The change

1. New `.pi/agents/spec-writer.md` — a fresh subagent persona, spawned by the
   investigator for one drafting pass:
   - Job: draft the prose of every non-keep row the disposition table settled — a
     rewritten requirement's SHALL sentences and rationale, a new requirement's whole
     prose, a rewritten or new TERM definition, a rewritten capability intro — in the
     register the surrounding spec already uses.
   - The style discipline is its own body text, ported from ship step 1, not a pointer:
     the persona is the one home of the rules it writes under.
   - Handed: the settled disposition rows, the intent in the human's own words, the
     worktree root. It never decides a disposition — the table it is handed is settled;
     it writes prose and nothing else.
   - It writes into `specs/*.md` only. Tools: read, write, edit, grep, find, ls — no
     bash, no subagent.
2. `.pi/agents/investigator.md`: drafting is no longer the investigator's own act. The
   census, the worktree, the branch, the commits, and the disposition review stay
   exactly where they are; the drafting step becomes: hand the settled rows, the
   intent, and the worktree root to the spec writer, then read the drafted prose back
   from the file and commit it. The frontmatter description moves with it (the
   investigator spawns the spec writer that drafts the prose).
3. `docs/design.md`, near §49: record the split — the conversation holder orchestrates
   intent, owns the branch, and runs the review; a fresh writer drafts, for the same
   reason fresh reviewers review; and the prose discipline's single home is the persona
   that writes under it.

## Out of scope

- No `specs/*.md` file changes — no requirement's prose moves, no disposition review.
- No code, no tests: the suite stays green; `touched` holds no gate over this change.
- The legacy `/ship` skill is left exactly as it is.
- If acceptance wiring lands later and needs prose drafted, it may reuse this writer —
  not this TASK's concern.

## Done means

- `.pi/agents/spec-writer.md` exists, carrying the discipline in its own text.
- `investigator.md` says the spec writer drafts prose and the investigator never does;
  branch, commits, and the disposition review remain the investigator's own.
- `design.md` records the split near §49.
- `pnpm test` green; the docket reports this TASK mergeable.
