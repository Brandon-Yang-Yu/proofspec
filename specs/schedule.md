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

### Requirement: The bare CLI's startSession opens the TASK's own worktree and runs pi there, headed

The bare CLI's `startSession` action SHALL read the ready TASK's own MANIFEST for its
`branch`, ensure a worktree for that branch exists at the conventional path
`.proofspec/worktrees/<task>` — creating one with `git worktree add` if none is checked
out, reusing it unchanged if one already is — and start `pi` there in a detached tmux
session named for the TASK, first killing any same-named session already there. Every tmux
command this action runs SHALL reach tmux through a dedicated, isolated server, named by
tmux's own `-L <socket>` flag rather than the default server — never the user's own default
tmux server, and never any other named server — with a default socket name of `proofspec`,
overridable through the `PROOFSPEC_TMUX_SOCKET` environment variable.

`.proofspec/` is already this tool's own root for exactly this kind of on-disk convention —
`.proofspec/dispatch/` for the queue, `.proofspec/reviews.jsonl` for the review LEDGER — and
a worktree `startSession` opens is the same kind of thing: state this repo's own tooling
keeps, so it belongs there too. A ready TASK can reach this action having had no worktree
ever opened for it at all, or having had one opened and since torn down independently of
its queue entry — nothing about a queue entry standing guarantees a worktree still sits
behind it. Checking the conventional path first and creating on demand covers both without
needing to ask `git worktree list` a question the path convention already answers. tmux,
not a bare spawn, is what lets the session stay headed and interactive — something a human
may need to sit at — without the scheduling pass itself holding a terminal open to keep it
alive; killing a same-named session before creating a fresh one is what lets a TASK whose
first session attempt died or never came up get a working session on retry instead of
colliding with a dead one of the same name.

A tmux session name is global to the whole machine, not scoped to any directory or project —
`kill-session -t <name>` and `new-session -d -s <name>` on tmux's default server name and act
on any session with that name, whatever created it. A TASK happening to share a name with a
session the human already had open, entirely unrelated to this tool, would be silently killed
and replaced with no warning at all — this is not a hypothetical the way probing a LEASE's
process is; it is the same shape of real failure this document already declines to risk
elsewhere. Reaching tmux only through a dedicated server, `-L proofspec` by default, is what
keeps every session `startSession` ever starts on a server nothing else — not the human's own
terminal, not any other tool — is using, so a TASK's name can never collide with a session it
did not create. `PROOFSPEC_TMUX_SOCKET` overrides that socket the same way `PROOFSPEC_JUDGE_BIN`
already overrides `judge`'s own process (below): so a test, or a future acceptance check that
runs the real bare CLI against a real tmux binary, can point at a throwaway, per-run socket
instead of ever touching the real `proofspec` production socket, let alone the user's own
default one.

<!-- scenarios: generated -->
- "A ready TASK whose worktree already exists at its conventional path has it reused, not recreated" → tests/schedule/session.test.ts
- "A ready TASK whose worktree has never been checked out gets one created at its conventional path" → tests/schedule/session.test.ts
- "PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target" → tests/schedule/session.test.ts
- "The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi" → tests/schedule/session.test.ts
- "The tmux commands run against a dedicated server, never the user's default or any other named one" → tests/schedule/session.test.ts
<!-- /scenarios -->

### Requirement: startSession seeds the executor session with the executor's own system prompt

The bare CLI's `startSession` action SHALL read `.pi/agents/executor.md` from this tool's own
checkout — never from the TASK's own worktree or branch — strip its YAML frontmatter, and
pass the remaining prose to `pi` as `--append-system-prompt`, alongside the worktree and
tmux-socket handling above.

`pi` without a seeded prompt is just the generic coding-assistant default; nothing tells the
session it is the executor, that its scope starts only after the disposition review, or that
a wrong judged standard — never a wrong implementation — is the one thing it should park on
and ask about (docs/design.md §37, §49). `.pi/agents/executor.md` already carries that persona
in the same shape as this tool's other agent files, written for the `subagent` dispatch
mechanism's own frontmatter convention; a session `startSession` opens is never dispatched
that way; it is the top-level `pi` process tmux starts directly. Stripping the frontmatter
before handing the body to `--append-system-prompt` keeps `name:`/`tools:` — metadata for a
dispatcher that never runs here — out of the literal prompt text a model would otherwise have
to read as prose.

Reading the persona from `cwd`, not from the worktree, is the same choice `DEFAULT_JUDGE_AGENT`
and `PROOFSPEC_JUDGE_BIN` already make for `judge`: the executor's own instructions are an
operational convention this tool's checkout keeps, not something a TASK's own branch — cut
from `main` at some earlier, possibly stale, point — gets to redefine for itself.

<!-- scenarios: generated -->
- "A persona file with no frontmatter passes through unchanged" → tests/schedule/session.test.ts
- "The executor persona's YAML frontmatter is stripped before it is used as a system prompt" → tests/schedule/session.test.ts
<!-- /scenarios -->

### Requirement: The bare CLI's judge asks a fresh pi process per relationship, its stdin closed so it cannot hang

The bare CLI's `judge` action SHALL run a fresh, one-shot `pi` process for every relationship
it is handed — never a saved session, never reused across relationships — closing that
process's stdin the instant it starts, and SHALL bound its wait for an answer with a
timeout, so that one relationship's process can never hang the scheduling pass that awaits
it.

`piJudge()` (`src/cli/judge.ts`) is the real action `startSession` already has a twin of: it
was written complete but left unwired, so a real run of the bare CLI reached every
relationship the graph found with no `judge` action at all, refused as cannot-run before a
fresh agent was ever asked anything. Wiring it into the same object literal that already
supplies `startSession` — `schedule: { startSession: ..., judge: piJudge() }` — closes that
gap without touching the domain rules a relationship is judged by: what the fresh agent is
asked, and how its last line is read, are exactly what the requirements above already say,
and this one is only about the bare CLI's own choice of process. `pi` reads its stdin when it
is not a TTY, so a process left connected to nothing blocks waiting for input that will never
arrive; closing it the instant the process starts is what lets a real run answer instead of
burning its whole timeout every single time. The timeout itself exists for the same reason a
LEASE's grace period does — nothing else stops one bad run from hanging everything behind it
— and `judge` is awaited one relationship at a time, so one hang is enough to hang the whole
pass without it.

<!-- scenarios: generated -->
- "A malformed timeout override falls back to the default, rather than silently disabling the timeout" → tests/schedule/judge-cli.test.ts
- "A process that never answers is not waited on past the configured timeout" → tests/schedule/judge-cli.test.ts
- "A process that never closes its own stdin still returns instead of hanging, because judge closes it first" → tests/schedule/judge-cli.test.ts
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

### Requirement: The bare CLI's notifyHuman writes the finding to stderr, and nothing more

The bare CLI's `notifyHuman` action SHALL write one line to stderr — never stdout — for every
relationship it is given, naming the shared CAPABILITY_FILE or TERM the relationship reports,
both TASKs it names, and the relationship's own key exactly as `relationshipKey()`
(`src/schedule/relationships.ts`) computes it — the same key `schedule --ruling "<ruling>"
"<key>"` takes to answer it. It SHALL do nothing else: no paging, no proactive alert reaching
anyone who is not already watching the process a scheduling pass is running in.

`main.ts`'s own comment on `--pretty` already draws the line this has to respect: stdout
carries "the one line a program parses," unchanged by anything else a command might want to
say, so a finding written there would corrupt the one answer whatever invoked `schedule` is
trying to read. stderr is the only channel left that can carry a human-facing message without
touching that contract, and it reaches exactly one kind of human: whoever is already watching
the process that ran the scheduling pass — a human sitting at the interactive `pi` session
that triggered it, say. Actually paging, or proactively alerting a human who is not currently
watching, is an explicit non-goal of this change, left for later — the same honest limit this
document already keeps around what it declines to build, like refusing to probe whether a
LEASE's process is still alive rather than trusting elapsed time instead. This is deliberately
the minimal version: a finding nobody is watching for goes unheard until the next time someone
looks, and that is the plain cost of building only as much of `notifyHuman` as this change
needs.

<!-- scenarios: generated -->
- "An unresolved relationship's finding is written to stderr, not stdout" → tests/schedule/notify.test.ts
- "The stderr message names both TASKs, the shared node, and the relationship's own key" → tests/schedule/notify.test.ts
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

### Requirement: writeState overwrites a TASK's state file with exactly the word it is given

`writeState(cwd, task, word)` (`src/cli/queue.ts`) SHALL overwrite a TASK's `state` file with
exactly the `word` given, replacing whatever word the file held before. It SHALL NOT read the
file's previous word first, and SHALL NOT judge whether `word` is one any caller has ever used
before, or a valid step from wherever the state currently stands.

This is the write-side mirror of the same literalism `inflight`'s own requirement already
keeps on the read side: "A TASK's state is read literally" reads whatever word sits in the
file without judging it, defaulting an unrecognized one to still in flight rather than
refusing it — `writeState` writes whatever word it is given without judging that either.
Validating a transition — that only a TASK already `building` may be marked `merged`, say — is
a question about what the words mean and which orders make sense, and that question belongs
entirely to whatever future caller writes a specific verb like `markMerged`. None of those
verbs are built in this change; only the dumb primitive underneath them is, because nothing
yet needs more than that.

<!-- scenarios: generated -->
- "writeState overwrites an existing state file with the word it is given, whatever it is" → tests/schedule/queue.test.ts
<!-- /scenarios -->

### Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there

`enqueue(cwd, task, manifest)` (`src/cli/queue.ts`) SHALL create a TASK's queue entry — its
directory, its `MANIFEST`, and an initial state of `queued` written through `writeState` —
only when no queue entry of that TASK's name already exists, and SHALL refuse, touching
nothing, when one does, answering `{ok: false, reason}` rather than overwriting it.

Two callers racing to enqueue the same TASK name is the same shape of problem two scheduling
passes racing to take the same LEASE already is, and `enqueue` is built on the same answer:
the same `wx`-flag atomic-write idiom `takeLease` already uses elsewhere in this file, so the
check-then-create step two racing calls could otherwise land inside of is collapsed to the one
filesystem call the OS already makes atomic. There is deliberately no new CLI verb for this —
nothing calls `proofspec enqueue` from a command line, and none is being added here — `enqueue`
ships as a plain exported function for a future caller, an "investigator" capability not yet
built, to use.

<!-- scenarios: generated -->
- "Two racing enqueue calls on the same TASK name still create exactly one entry" → tests/schedule/queue.test.ts
- "enqueue creates a new TASK's MANIFEST and initial queued state" → tests/schedule/queue.test.ts
- "enqueue refuses a TASK name already in the queue, without touching its existing entry" → tests/schedule/queue.test.ts
<!-- /scenarios -->
