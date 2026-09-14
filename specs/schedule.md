# schedule

Reads the graph `dispatch` computes and acts on it. `dispatch`'s own charter says plainly
that it "holds no queue and dispatches nothing" — it answers a question about work already
in flight, and "deciding what to do with the answer belongs to something else." This is that
something else: the one capability with permission to write into the queue directory —
releasing a TASK held on one that is no longer live, pruning a queue entry nothing points at
any more, judging a relationship before a human ever sees it, and starting the one work-agent
session a ready TASK is owed.

It reads `dispatch`'s answer the way `cli` reads a TASK's own MANIFEST and state file: as
something to act on, not something to recompute. `specs/dispatch.md` is not touched by this
capability — the graph still only reports, and this is the orchestrator its own text names
but declines to build.

### Requirement: A TASK held on another is released once the held-on TASK is no longer live

A TASK whose MANIFEST's `base` names another TASK of kind `task` SHALL be held until that
named TASK is no longer live, and released the moment it is not — whether because the named
TASK's own state has reached merged, or because the queue holds no record of it at all.

`dispatch` already draws exactly this line for its own basedOn edges: a `base` naming a
merged TASK is read from `main` instead of the old branch, and a `base` naming a TASK the
queue holds no record of at all is a claim, not a default — both mean the work behind that
name is settled. A hold with its own separate notion of "still live" could disagree with
`dispatch`'s: held past the moment the graph would already call the block gone, or released
while the graph still reports it live. There is exactly one graph of what is in flight, and
both this capability and `dispatch` read it the same way.

<!-- scenarios: generated -->
<!-- /scenarios -->

### Requirement: A merged TASK's queue entry is pruned once nothing still names it

A queue entry whose TASK's state has reached merged SHALL be removed by a scheduling pass
once no in-flight TASK's `base.task` still names it, and SHALL NOT be removed before that.

A merged entry has to keep standing for as long as some other TASK's basedOn claim might
still ask about it: deleting it early is exactly what would flip a graceful "based on a TASK
that merged" into a false "based on a TASK the queue holds no record of at all," naming a
TASK that in fact finished cleanly. Once no in-flight TASK names it any more, that risk is
gone and nothing is served by keeping it. The criterion is answerable from the same graph
`dispatch` already computes — every in-flight TASK's `base` — so pruning needs no bookkeeping
of its own to decide when a name has gone quiet.

<!-- scenarios: generated -->
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
<!-- /scenarios -->

### Requirement: A relationship is judged by a fresh agent before a human is asked

For every relationship the graph reports, a scheduling pass SHALL hand a fresh agent —  one
that authored neither TASK's work — both TASKs' intent, read from each MANIFEST's
`intentRef`, and ask it whether the relationship is a real conflict, before any human is
asked anything about it.

`dispatch` reports a relationship without judging it by design — it never reads intent, only
edges over files a graph can see. Most shared ground between two TASKs is coincidence, not
conflict, and reading both intents is cheap enough to run on every relationship the graph
finds, which is what keeps a human's attention for the ones that actually need it.

<!-- scenarios: generated -->
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
<!-- /scenarios -->
