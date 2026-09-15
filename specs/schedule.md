# schedule

Reads the graph `inflight` computes and acts on it. `inflight`'s own charter says plainly
that it "holds no queue and dispatches nothing" — it answers a question about work already
in flight, and "deciding what to do with the answer belongs to something else." This is that
something else: the one capability with permission to write into the queue directory —
releasing a TASK held on one that is no longer live, pruning a queue entry nothing points at
any more, judging a relationship before a human ever sees it, and starting the one work-agent
session a ready TASK is owed.

It reads `inflight`'s answer the way `cli` reads a TASK's own MANIFEST and state file: as
something to act on, not something to recompute. `specs/inflight.md` is not touched by this
capability — the graph still only reports, and this is the orchestrator its own text names
but declines to build.

### Requirement: A TASK held on another is released once the held-on TASK is no longer live

A TASK whose MANIFEST's `base` names another TASK of kind `task` SHALL be held until that
named TASK is no longer live, and released the moment it is not — whether because the named
TASK's own state has reached merged, or because the queue holds no record of it at all.

`inflight` already draws exactly this line for its own basedOn edges: a `base` naming a
merged TASK is read from `main` instead of the old branch, and a `base` naming a TASK the
queue holds no record of at all is a claim, not a default — both mean the work behind that
name is settled. A hold with its own separate notion of "still live" could disagree with
`inflight`'s: held past the moment the graph would already call the block gone, or released
while the graph still reports it live. There is exactly one graph of what is in flight, and
both this capability and `inflight` read it the same way.

<!-- scenarios: generated -->
- "A TASK based on main carries no hold status at all" → tests/schedule/holds.test.ts
- "A TASK held on a TASK that has since merged is dispatched" → tests/schedule/end-to-end.test.ts
- "A TASK held on a still in-flight TASK is not dispatched" → tests/schedule/end-to-end.test.ts
- "A TASK whose base names a TASK absent from the queue entirely is released" → tests/schedule/holds.test.ts
- "A TASK whose base names a merged TASK is released" → tests/schedule/holds.test.ts
- "A TASK whose base names a still in-flight TASK is held" → tests/schedule/holds.test.ts
- "A held TASK is never ready to dispatch, however queued its own word is" → tests/schedule/lease.test.ts
<!-- /scenarios -->

### Requirement: A merged TASK's queue entry is pruned once nothing still names it

A queue entry whose TASK's state has reached merged SHALL be removed by a scheduling pass
once no in-flight TASK's `base.task` still names it, and SHALL NOT be removed before that.

A merged entry has to keep standing for as long as some other TASK's basedOn claim might
still ask about it: deleting it early is exactly what would flip a graceful "based on a TASK
that merged" into a false "based on a TASK the queue holds no record of at all," naming a
TASK that in fact finished cleanly. Once no in-flight TASK names it any more, that risk is
gone and nothing is served by keeping it. The criterion is answerable from the same graph
`inflight` already computes — every in-flight TASK's `base` — so pruning needs no bookkeeping
of its own to decide when a name has gone quiet.

<!-- scenarios: generated -->
- "A merged TASK an in-flight TASK still names is kept" → tests/schedule/end-to-end.test.ts
- "A merged TASK an in-flight TASK's base still names is not pruned" → tests/schedule/prune.test.ts
- "A merged TASK no in-flight TASK's base names is pruned" → tests/schedule/prune.test.ts
- "A merged TASK nothing still names is pruned from the queue directory" → tests/schedule/end-to-end.test.ts
- "An in-flight TASK is never pruned" → tests/schedule/prune.test.ts
<!-- /scenarios -->

### Requirement: Dispatching a ready TASK starts exactly one work-agent session

Dispatching a TASK ready to build SHALL start exactly one headed, interactive work-agent
session for it — never zero, never two — by first taking a LEASE scoped to that TASK alone,
and starting the session only once the LEASE is held.

Two scheduling passes finding the same ready TASK is the ordinary case this design expects,
not a rare race to guard against after the fact — nothing here promises only one pass will
ever run. A LEASE scoped to the one TASK, rather than a lock over the whole queue, is what
keeps two agreeing passes from starting two sessions for it, without holding every other
TASK's dispatch hostage to the LEASE on one.

<!-- scenarios: generated -->
- "A TASK already building is not ready to dispatch again" → tests/schedule/lease.test.ts
- "A queued, unheld TASK is ready" → tests/schedule/lease.test.ts
- "A ready TASK starts a session and takes a LEASE" → tests/schedule/end-to-end.test.ts
- "A ready TASK with no LEASE decides to take one" → tests/schedule/lease.test.ts
- "A ready TASK with no startSession action given cannot run" → tests/schedule/end-to-end.test.ts
- "A second pass finding an unexpired LEASE decides to block" → tests/schedule/lease.test.ts
- "The real command blocks a second pass from starting a second session for a ready TASK" → tests/schedule/end-to-end.test.ts
- "Two passes racing at the same instant still start exactly one session" → tests/schedule/end-to-end.test.ts
<!-- /scenarios -->

### Requirement: A stale LEASE is told apart from a live one by elapsed time, not by probing a process

A LEASE on a TASK SHALL be treated as stale, and reclaimed, once a short grace period has
passed since it was taken without the TASK's state having advanced to the literal word
`building`. Before that grace period elapses, an existing LEASE SHALL block a second session
from starting.

Nothing clears a LEASE on its own if the work-agent session it started never comes up, or
dies before it can write `building` — something has to reclaim it, or one dead session's
LEASE holds its TASK forever. Checking whether the process behind a LEASE is still alive is
exactly the check this design keeps refusing to build: a PID means something only on the
machine that started it, and every other judgement this tool makes already reads state from
files rather than from what happens to still be running. Elapsed time against the one state
change a real session makes almost immediately works the same way whether the session died,
never started, or is running on a machine nobody watching has ever heard of.

<!-- scenarios: generated -->
- "A LEASE outliving the grace period without the state advancing is reclaimed" → tests/schedule/lease.test.ts
- "A LEASE whose TASK has advanced to building is never reclaimed by elapsed time alone" → tests/schedule/lease.test.ts
- "A pass after the grace period reclaims a LEASE nothing advanced past" → tests/schedule/end-to-end.test.ts
- "Two passes racing to reclaim the same stale LEASE still start exactly one session" → tests/schedule/end-to-end.test.ts
<!-- /scenarios -->

### Requirement: A relationship is judged by a fresh agent before a human is asked

For every relationship the graph reports, a scheduling pass SHALL hand a fresh agent — one
that authored neither TASK's work, and that runs as a single tool-less, session-less process
naming the model it answers as — both TASKs' intent, read from each MANIFEST's `intentRef`,
and ask it whether the relationship is a real conflict, before any human is asked anything
about it. A TASK whose intent could not be read SHALL be named as missing in that ask, not
silently dropped, and the same relationship SHALL ask the same question however its two
TASKs arrive.

`inflight` reports a relationship without judging it by design — it never reads intent, only
edges over files a graph can see. Most shared ground between two TASKs is coincidence, not
conflict, and reading both intents is cheap enough to run on every relationship the graph
finds, which is what keeps a human's attention for the ones that actually need it. A process
with no tools and no saved session is what makes "authored neither TASK's work" a fact about
the call, not an assumption about who happens to be running it — it cannot have touched
either TASK's branch, and it remembers nothing from one relationship to the next, so the
same two TASKs get the same question wherever in the queue's pass order they happen to fall.

<!-- scenarios: generated -->
- "A TASK whose intent could not be read is named as missing in the question, not silently dropped" → tests/schedule/judge.test.ts
- "A fresh agent is asked in one tool-less, session-less process, naming the model it runs as" → tests/schedule/judge.test.ts
- "A relationship the fresh agent resolved is never raised" → tests/schedule/relationships.test.ts
- "A relationship the fresh agent resolves is never raised" → tests/schedule/end-to-end.test.ts
- "A relationship's key names the same node and TASK regardless of the order they arrive in" → tests/schedule/relationships.test.ts
- "A scheduling pass built from the composed judge factory raises what it judges unresolved" → tests/schedule/end-to-end.test.ts
- "An intent past the length cap is truncated rather than left to overflow the process's argument list" → tests/schedule/judge.test.ts
- "The composed judge factory hands its runner the real process and reads its answer through the real parser" → tests/schedule/judge.test.ts
- "The fresh agent is handed both TASKs' real intent" → tests/schedule/end-to-end.test.ts
- "The same relationship asks the same question regardless of which TASK's intent arrived first" → tests/schedule/judge.test.ts
<!-- /scenarios -->

### Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case

A fresh agent's answer SHALL be read as `resolved` only when its reply's last line, trimmed
and case-folded, is exactly `RESOLVED`. A process that never ran, exited with a non-zero
code, produced no answer, or answered anything else at all — including a reply that
discusses both words but ends in neither, or ends in `UNRESOLVED` — SHALL be read as
`unresolved`.

There is no third value for a judgement to reach, and there should not be one: `unresolved`
is already this domain's safe default — a relationship read as unresolved still reaches a
human, the same as one the fresh agent frankly could not decide — so every hazard this ask
can produce collapses onto the value that costs a human one glance, never onto the one that
would bury a real conflict. The prompt that puts this to the agent necessarily contains both
words, since it has to say what each one means, so a parser that scanned the whole reply for
either word could never tell the discussion from the verdict; requiring an exact match on the
last line only is what keeps a reply that reasons its way past `UNRESOLVED` on the way to
`RESOLVED` — or the reverse — from being misread by a substring.

<!-- scenarios: generated -->
- "A non-zero exit is never read as an answer, whatever stdout says" → tests/schedule/judge.test.ts
- "A plain RESOLVED last line resolves the judgement" → tests/schedule/judge.test.ts
- "A plain UNRESOLVED last line leaves the judgement unresolved" → tests/schedule/judge.test.ts
- "A process that never ran leaves the judgement unresolved" → tests/schedule/judge.test.ts
- "A reply that discusses both words but ends in RESOLVED still resolves the judgement" → tests/schedule/judge.test.ts
- "Casing and punctuation around the last line do not change the verdict" → tests/schedule/judge.test.ts
- "Empty output leaves the judgement unresolved" → tests/schedule/judge.test.ts
- "Prose ending in neither word leaves the judgement unresolved" → tests/schedule/judge.test.ts
<!-- /scenarios -->

### Requirement: A judgement the fresh agent cannot resolve reaches a human, traceably

A relationship the fresh agent could not resolve SHALL be put in front of a human, and the
ruling recorded for it SHALL trace to what the human actually wrote — never synthesized or
paraphrased as if the human had said it.

A dispatcher able to generate its own authority is the single most dangerous component a
design like this one can have. "The human has ruled" has to trace to a record a later reader
can go and check, the same way a review's verdict traces to a line in the LEDGER — a
notification may be relayed on the human's behalf, but a verdict may not.

<!-- scenarios: generated -->
- "A recorded ruling traces to exactly the text given" → tests/schedule/end-to-end.test.ts
- "A relationship the fresh agent could not resolve is raised to a human" → tests/schedule/end-to-end.test.ts
- "A relationship the fresh agent could not resolve, never raised before, is raised" → tests/schedule/relationships.test.ts
- "A ruled entry read back from the ledger carries the exact text the human wrote" → tests/schedule/raised.test.ts
- "The real command line records a ruling through its one positional and --ruling" → tests/schedule/end-to-end.test.ts
<!-- /scenarios -->

### Requirement: The same finding is not raised to a human twice

Before putting a relationship in front of a human, a scheduling pass SHALL check a durable
record of relationships already raised, and SHALL raise a given relationship only once,
regardless of how many passes recompute the same graph.

This concerns only the relationships the requirement above already decided need a human — the
ones the fresh agent could not resolve. The graph is computed fresh from git on every run and
stores nothing, so a relationship a human has already ruled on does not stop existing on the
next pass; without a record of what has already been raised, the same unresolved finding
would be put in front of the human again every time the TASK sits in the queue. This raised
record is a deliberate, narrow exception to this tool's habit of computing fresh and storing
nothing: the first thing this capability needs to remember across runs, and the reason it is
allowed to.

<!-- scenarios: generated -->
- "A damaged ledger line is skipped rather than refused" → tests/schedule/raised.test.ts
- "A raised entry read back from the ledger is the same entry that was written" → tests/schedule/raised.test.ts
- "A relationship already raised is not raised again by a later pass" → tests/schedule/end-to-end.test.ts
- "A relationship already raised is not raised again, however many passes recompute it" → tests/schedule/relationships.test.ts
- "A relationship already ruled on still counts as already raised" → tests/schedule/raised.test.ts
<!-- /scenarios -->

### Requirement: A scheduling pass is triggered by events, not a resident process or a timer

A scheduling pass SHALL run in response to an event — a TASK enqueued, a TASK merged, a
session starting up — and SHALL NOT run inside a resident process or on a timer. Two passes
triggered close together, computing from the same underlying state, SHALL reach the same
decision, regardless of which one goes on to act on it.

A resident scheduler is one more process this tool would need to keep alive, restart, and
trust; an event is a fact that already happened, and reacting to it needs nothing standing
in the background between events. Reaching the same decision from the same state is what
lets a LEASE, rather than an assumption that only one pass ever runs, be the thing that
keeps two triggered-together passes from acting twice.

<!-- scenarios: generated -->
- "A later pass does not repeat work an earlier pass already did" → tests/schedule/end-to-end.test.ts
- "A pass over an empty queue answers with nothing to do, needing no actions at all" → tests/schedule/end-to-end.test.ts
<!-- /scenarios -->
