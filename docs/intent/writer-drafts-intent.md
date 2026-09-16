# writer-drafts-intent — the intent writer writes intent docs too

## The problem

The investigator writes intent docs by hand, from live conversation memory. Two costs
showed this session. The prose needed repeated amends before it met the bar, because the
conversation's holder writes history narration and defense of choices the reader was
never part of. And the plain-register TASK now puts intent docs under the same bar —
with no writer between the bar and the investigator's own hand.

The handover objection does not hold: what crosses to the writer is not a finished
summary but raw decisions, as bullet points in the human's own words, plus the paths
involved. That is the same shape as a settled disposition table, and it is what the old
`/ship` steward already worked from.

The persona's name no longer fits its scope once it drafts intent docs as well as spec
prose: "spec writer" names only the second half of its work. In this design's own
vocabulary the load-bearing word is intent — the MANIFEST carries an `intentRef`, the
investigator owns a TASK's intent end to end, and spec prose is intent settled into
requirements. The persona is the **intent writer**.

## The change

1. Rename `.pi/agents/spec-writer.md` to `.pi/agents/intent-writer.md`: the frontmatter
   `name`, the description, and every self-reference in the file. Intent docs join its
   scope: "What you draft" gains a row — a `docs/intent/<task>.md` from the raw decisions
   the investigator hands over. Its write boundary changes from `specs/*.md` only to
   `specs/*.md` and `docs/intent/*.md` only.
2. `.pi/agents/investigator.md`: every mention of the spec writer becomes the intent
   writer. The drafting step for an intent doc spawns it, handed the raw decisions and
   the paths involved. The investigator reads the drafted doc back from the file,
   presents it to the human, commits once the human accepts it. A doc the human has
   accepted is final: no rewrites before enqueue, none after — amendments only when the
   human asks for them in review.
3. `docs/design.md`, in the section that records the spec writer: rename the persona
   there too, and record the decision — the intent writer drafts intent docs from raw
   decisions for the same reason it drafts spec prose from a settled table; the
   conversation's holder stays its orchestrator, never its pen. Grep the repo for
   remaining mentions of the old name and rename them all.

## Acceptance — a dry-run TASK through the new flow

The executor of this TASK does not run this. It runs after this TASK merges, in a fresh
investigator session — never the session that drafted this doc.

1. Start a fresh headed pi session carrying the investigator persona, loaded the same
   way `startSession` loads the executor persona. The human attaches to it and talks one
   small real TASK through it. The TASK: `reviewer-reads-rules` —
   `.pi/agents/guideline-reviewer.md` names "the five rules" of CLAUDE.md and enumerates
   them; rewrite that audit item to read CLAUDE.md's rules as they stand, with no count
   and no enumeration. The human may name another TASK of the same size instead.
2. That investigator spawns the intent writer for the intent doc: raw decisions in the
   human's own words in, the drafted doc out. The acceptance fails if the investigator
   drafts the doc itself — the human watches the session, and the spawn is visible.
3. The human reviews the drafted doc once, as read back from the file. Accepted means
   final: the investigator commits it, confirms the four fields, and calls
   `enqueue_task`.
4. The dry-run TASK's executor runs it to merge.
5. The acceptance passes when all of these hold: the dry-run TASK is on `main`; its
   intent doc was drafted by the intent writer; the doc reads at the plain bar; the doc
   was not rewritten after the human accepted it.

## Done means

- `.pi/agents/intent-writer.md` exists; `spec-writer.md` is gone; no mention of the old
  name remains anywhere in the repo.
- The persona drafts both spec prose and `docs/intent/*.md`, and its boundary still
  excludes everything else.
- `investigator.md` names the intent writer, and names the rule: accepted by the human
  once, final.
- `design.md` records the rename and the decision.
- `pnpm test` green; the docket reports this TASK mergeable.
