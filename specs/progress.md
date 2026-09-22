# progress

Lets a running executor session report its own state word back into
`.proofspec/dispatch/<task>/` — the one gap the persona split left open:
`startSession` (`specs/schedule.md`) starts a headed executor session in the
TASK's own worktree, and nothing after that point ever writes back to the queue entry that
started it. `writeState(cwd, task, word)` (`src/cli/queue.ts`) already overwrites a TASK's
`state` file with exactly the word it is given, with no notion of who is calling it or from
where; this capability is the one hop in front of that write a running session can actually
take — `report_task_state`, a tool that resolves where the queue lives and which TASK it is
reporting for from the environment `startSession` hands it, rather than from the session's
own working directory, which names the session's own worktree, not the main checkout the
queue lives under.

The tool surface this capability builds — `report_task_state`, `report_task_phase`,
`settle_task`, and the heartbeat — is one contract served over two transports: the
extension the `pi` harness loads, and the stdio MCP server (`specs/mcp.md`) the Claude Code
harness loads. Every call, on either transport, reaches one core, and each tool's rules
live in that core and nowhere else, so the two harnesses answer a tool the same way.

`leaseDecision` (`src/schedule/lease.ts`) already treats the literal word `building` as proof
a session is live; before this capability, nothing running inside a session ever produced that
word. `report_task_state` closes exactly that gap: it does not decide when a TASK is actually
done, and does not carry the text of a parked question. `merged` is not a word a session
reports at all — a running session is the least impartial judge of its own merge — so the
capability carries a second limb for it, the settle: `settle_task`, the tool an executor
calls the moment its own merge lands, which re-verifies the landing from git itself before
it rewrites the state word and tears the TASK's worktree and session down. The third limb
is the heartbeat: a timestamp refreshed in the same queue entry on every move the session
makes, so that a view reading the entry can tell a working session from a silent one
without asking either. The fourth limb is the pace word: `report_task_phase`, which writes
the executor's own word for where inside its
pipeline the work stands, beside a round number for the gates that loop and the moment the
word began, and it appends every change of standing to a history file, so what the TASK
has been through stays readable after the word moves on. The vocabulary is
the executor persona's own (`.pi/agents/executor.md`) — it evolves without the queue's
permission, and the queue judges none of it. The words and the timestamps are facts a
session leaves behind, and what anything makes of them belongs to whoever reads them; the
settle is the one act among the four, and every question it answers it answers from git,
never from its caller's word.

### Requirement: report_task_state accepts only a closed set of state words

`report_task_state` (`src/progress/extension.ts`) SHALL accept only `building`, `mergeable`,
or `blocked-on-question` as its `state` argument — the closed set `REPORTABLE_STATES` names —
and SHALL refuse, naming the given word, on any other value, without calling `writeState` or
otherwise touching the entry's `state` file.

`writeState` itself judges no word at all — "writeState overwrites a TASK's state file with
exactly the word it is given" (`specs/schedule.md`) — so judging which words an executor may
report has to live in the one caller that knows what an executor's own lifecycle can actually
be in: building while it works, mergeable once every gate is clean, or blocked-on-question
when it parks (`.pi/agents/executor.md`). `queued` is deliberately excluded — that word
belongs to `enqueue`'s own initial write, never to a running session reporting on itself — and
`merged` is left out on purpose too: a running session is the least impartial judge of its own
merge, and `merged` is written only by a settle that verified the landing from git itself
(`settle_task`, below; the scheduling pass's backstop, `specs/schedule.md`).
`BUILDING` (`src/schedule/types.ts`) is reused rather than copied, since `leaseDecision`
already compares a TASK's own state word against that exact constant; `mergeable` and
`blocked-on-question` join it there so the queue's vocabulary of state words keeps one home.

<!-- scenarios: generated -->
- "A state word outside the reportable set is refused, naming the word, and the entry's state is unchanged" → tests/progress/extension.test.ts
- "blocked-on-question is accepted as a reportable state" → tests/progress/extension.test.ts
<!-- /scenarios -->

### Requirement: report_task_state resolves PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK from the environment, refused when absent

`report_task_state` SHALL resolve the main checkout it writes into, and the TASK it is
reporting for, from the `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK` environment variables —
never from the session's own working directory — and SHALL refuse, naming whichever
variable is missing, when either is unset, without writing anything.

The working directory a session runs in is the TASK's own worktree
(`.proofspec/worktrees/<task>`) — the directory `startSession` opens the session in — not
the main checkout `.proofspec/dispatch/` actually lives under; the two are different
directories by construction, so no path a reporting tool can compute from the working
directory alone ever names the queue. The main checkout's path and the TASK's own name are
both facts the scheduler already holds at the moment it starts the session — it is the one
that wrote the queue entry in the first place — so `startSession` hands them down
explicitly as environment variables (`specs/schedule.md`) rather than asking the worktree
to infer them, say, from its own directory name or `git rev-parse --git-common-dir`: a
statement from the party that already knows cannot be wrong the way an inference can.
Refusing outright when either is absent, rather than falling back to the working directory
or guessing, keeps a session started outside this convention from silently writing into
the wrong place, or into no place a scheduling pass will ever read.

<!-- scenarios: generated -->
- "A report with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "A report with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "The registered tool reports into PROOFSPEC_QUEUE_ROOT even when the session's own working directory names a different directory" → tests/progress/extension.test.ts
<!-- /scenarios -->

### Requirement: report_task_state delegates to writeState and answers its outcome as a value

Once its state word and its environment have both resolved, `report_task_state` SHALL call
`writeState(queueRoot, task, state)` (`src/cli/queue.ts`) and SHALL answer `{ok: true, task,
state}` on success; a `writeState` call that fails because the TASK's queue entry no longer
exists SHALL be caught and answered as `{ok: false, reason}` rather than left to throw.

`report_task_state`'s whole job past validation is this one delegation — `writeState` already
overwrites a TASK's `state` file with exactly the word it is given, reading nothing first and
judging no transition, so there is nothing left for this tool to re-decide about the write
itself: it reaches exactly the one path `queueRoot` and `task` name, and leaves the rest of the
entry — its MANIFEST, its LEASE — exactly as it was. A queue entry can vanish between the
moment an executor is told to report and the moment it calls this tool — pruned by a scheduling
pass once nothing still names it ("A merged TASK's queue entry is pruned once nothing still
names it", `specs/schedule.md`) — and `writeState`'s own plain file write then fails `ENOENT`; a
real bug would leave that to throw and crash the extension's host process, so this catches
exactly that failure at the boundary and answers it as a value instead, the same reason
`enqueue_task` (`specs/handoff.md`) never throws either.

<!-- scenarios: generated -->
- "A reported state is written to the queue entry at the given queueRoot" → tests/progress/extension.test.ts
- "Reporting a state for a TASK whose queue entry has been pruned is refused as a value, never thrown" → tests/progress/extension.test.ts
- "Reporting a state leaves the entry's MANIFEST and LEASE exactly as they were" → tests/progress/extension.test.ts
<!-- /scenarios -->

### Requirement: settle_task settles a TASK only after re-verifying its landing from git

`settle_task` (`src/progress/extension.ts`) SHALL resolve the queue it writes into and the
TASK it settles the same way `report_task_state` does — from `PROOFSPEC_QUEUE_ROOT` and
`PROOFSPEC_TASK`, never from the session's own working directory — refusing when either is
unset. It
SHALL never take its caller's word for the settle conditions: on every call it SHALL read
the TASK's current state word from the queue, and check its MANIFEST's `branch` is an
ancestor of `main`, fresh from git. Either condition failing, it SHALL refuse as a value —
`{ok: false, reason}` naming which condition failed — touching nothing: the state word, the
worktree, and the session stand exactly as they were. Both holding, it SHALL perform the
settle in order: rewrite the state file to `merged`, remove the TASK's worktree at its
conventional path, kill its same-named tmux session on the dedicated server — the same
settle a scheduling pass runs as its backstop (`specs/schedule.md`). The session kill SHALL
go through a detached reaper process with a short delay, so the tool returns its result
before the host session dies. The tool SHALL NOT prune the TASK's queue entry: pruning
waits until no in-flight TASK's `base` still names it, a fact about the whole queue that
one session cannot answer, and it stays the scheduling pass's.

The executor is the one party that knows the moment its merge lands, so it is the one that
calls: the merge happens inside the TASK's own worktree, and the event it raises fires
there, where the queue directory does not live, so no scheduling pass reliably hears it.
But a session that just did the merging is also the least impartial judge of whether the
merge landed — the same reason `report_task_state`'s closed set has no `merged` to report —
so the tool checks git itself instead of trusting the call, the identical check the pass
runs: one settle, two callers, neither trusted. The reaper is what makes an
executor-triggered teardown safe at all. The session being killed is the very process
whose tool call this is, and a kill that took effect at once would cut the answer off
before the caller ever saw whether the settle succeeded.

<!-- scenarios: generated -->
- "A settle for a TASK whose branch has not landed in main is refused, naming the branch, and the state, the worktree, and the session stand exactly as they were" → tests/progress/settle.test.ts
- "A settle for a TASK whose state word is not mergeable is refused, naming the word, and the state, the worktree, and the session stand exactly as they were" → tests/progress/settle.test.ts
- "A settle for a mergeable TASK whose branch has landed in main rewrites the state to merged and removes the TASK's worktree" → tests/progress/settle.test.ts
- "A settle never prunes the TASK's queue entry" → tests/progress/settle.test.ts
- "A settle with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written" → tests/progress/settle.test.ts
- "A settle with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written" → tests/progress/settle.test.ts
- "The registered settle tool settles the TASK named by PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK, never the session's own working directory" → tests/progress/settle.test.ts
- "The settle's session kill is handed to a detached reaper with a short delay, so the settle answers while the session still stands and the kill lands only after the delay" → tests/progress/settle.test.ts
<!-- /scenarios -->

### Requirement: A heartbeat is refreshed on every move the session makes

The session SHALL refresh a `heartbeat` file in its TASK's queue entry whenever the session
makes any observable move — any move the harness running the session reports — resolving
the entry the same way `report_task_state` does, from `PROOFSPEC_QUEUE_ROOT` and
`PROOFSPEC_TASK`, and writing nothing when either is unset. It SHALL NOT touch the `state`
file or any other file in the entry. Each harness reports the moves its own way, and both
triggers end in the same one write: the `pi` transport subscribes its six observable-move
events — starting or ending a turn, starting, updating, or ending a tool call, or streaming
part of a reply — and the Claude Code transport fires hooks that call the heartbeat CLI
entry (`specs/mcp.md`). One write, two triggers, so the file means the same thing
whichever harness the session runs in.

The heartbeat is a fact, not a word, and the difference is who can lie: a state word is a
claim that stays put until something rewrites it, while a heartbeat refreshed on every move
goes stale on its own the moment the moves stop — nobody has to remember to say so. That is
what lets it carry "how long since the last move" honestly where a `running` state word
would go silently false the moment the session hung after writing it.
A subagent is dispatched as a tool call on the session's own surface, so a subagent at work
refreshes the heartbeat and one that has stopped does not — while the
refresh grain stays per move, not per token, because a session cannot observe inside a child
process's token stream, and a requirement promising more than the process can observe would
be lying about its own facts. The heartbeat feeds the docket view (`specs/docket.md`) and
nothing else: LEASE staleness keeps measuring elapsed time against the `building` word,
exactly as it already does, untouched.

<!-- scenarios: generated -->
- "A heartbeat file is refreshed in the TASK's queue entry on every observable move the session makes" → tests/progress/extension.test.ts
- "A heartbeat refresh leaves the entry's state, MANIFEST, and LEASE exactly as they were" → tests/progress/extension.test.ts
- "No heartbeat is written when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset" → tests/progress/extension.test.ts
- "The heartbeat is subscribed to exactly the six observable-move events, and to no others" → tests/progress/extension.test.ts
<!-- /scenarios -->

### Requirement: report_task_phase reports the executor's own pace word and round

`report_task_phase` (`src/progress/extension.ts`, the same tool surface
`report_task_state` belongs to) SHALL take a `phase` argument — any non-empty trimmed word;
the queue enforces no vocabulary of its own — and a `round` argument, an integer of 1 or
more defaulting to 1. It SHALL refuse an empty or whitespace-only `phase`, naming why,
touching nothing. It SHALL resolve the queue and the TASK exactly as `report_task_state`
does — from `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK`, never from `ExtensionContext.cwd` —
and SHALL refuse, naming the missing variable, when either is unset, without writing
anything. It SHALL write its word and round into a `phase` file in the TASK's queue entry — the
file's content recording, beside the word and the round, `since`: the moment, in epoch
milliseconds, the current word began running — and SHALL touch nothing else in the entry:
the `state` file, the MANIFEST, the LEASE, and the heartbeat stand exactly as they were.
The write itself SHALL follow what the entry already holds, in three cases. A report whose
word and round both match the standing the `phase` file records SHALL write nothing at
all — not the `phase` file, not the history. A report whose word matches and whose round
differs SHALL rewrite the `phase` file with the new round, keeping the `since` the file
records. A report whose word differs — including a report into an entry whose `phase` file
holds no standing to match, whether absent or holding a shape this tool does not write —
SHALL rewrite the `phase` file with `since` set to now. On every standing change — the
word changed, or the round changed — it SHALL append one entry to a `phase-history` file
in the same queue entry: the word, the round, and the moment, in epoch milliseconds, that
standing began. The history is appended to, never overwritten. A write that fails because
the entry no longer exists — pruned by a scheduling pass — SHALL be answered as
`{ok: false, reason}`, never thrown, the same boundary `report_task_state` already keeps.
On success it SHALL answer `{ok: true, task, phase, round}`; the report that wrote nothing
is a success, not a refusal — it changed nothing, and nothing failed.

The state word is the machine's closed vocabulary: `building` is what keeps a LEASE from
being reclaimed, and `mergeable` is what triggers the settle. It answers no human question
for most of a TASK's life — from the moment work starts to the moment every gate is clean,
the word just says `building` — and what a person watching ten sessions actually wants to
know is not that the work is building, but where inside the building it has reached. The
phase word is the executor's answer to that question, written at the executor's own pace,
in the executor's own words. The vocabulary is free on purpose: the pipeline's words belong
to the executor persona (`.pi/agents/executor.md`), which evolves without the queue's
permission, and a closed set here would freeze the persona's pipeline into the queue's
contract. The round exists because the review gates loop, and the executor that looped
is the one that knows which round of test and review it is on. Like the state word, the
phase word is a fact the session leaves behind for whoever reads
it; the docket carries it on its row (`specs/docket.md`) — the word, the round, the time in
it, and now the history behind it.

The conditional writes and the history exist because the file's content, not its write
time, is what the docket reads. The `phase` file is rewritten every time the round moves —
a gate that loops rewrites it once per round — so an age read from the file's write time
would say how long since the last round, and a TASK that stood four hours in one word
across two hundred rounds would show minutes. Recording `since` inside the file, and
moving it only when the word changes, takes the duration out of the writes' reach: how
often the file is written can no longer change how long the word has stood. The report
that changes nothing writes nothing: the history records changes of standing, not reports,
and an entry appended for a report that changed nothing would say a standing began that
never began. And the history is kept at all because a `phase` file holds only the present —
once the word moves on, where the time went goes with it — while the questions a watching
human asks run backwards: which phases this TASK has been through, how long each stood, how
many rounds a looping one reached. Those are answerable only from a record kept standing
by standing, and the docket answers them from this one (`specs/docket.md`).

<!-- scenarios: generated -->
- "A first report records the standing and opens the history" → tests/progress/extension.test.ts
- "A phase report leaves the entry's state, MANIFEST, LEASE, and heartbeat exactly as they were" → tests/progress/extension.test.ts
- "A phase report trims the word it is given" → tests/progress/extension.test.ts
- "A phase report with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "A phase report with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "A phase report with no round given defaults the round to 1" → tests/progress/extension.test.ts
- "A phase word and its round are written into the TASK's phase file, answered as a value" → tests/progress/extension.test.ts
- "A phase word that is empty or only whitespace is refused, naming why, touching nothing" → tests/progress/extension.test.ts
- "A report into an entry whose phase file holds no standing to match counts as a word change" → tests/progress/extension.test.ts
- "A report whose word and round both match the standing writes nothing at all" → tests/progress/extension.test.ts
- "A round below 1, or one that is not an integer, is refused, naming why" → tests/progress/extension.test.ts
- "A round change rewrites the round and keeps the since the file records" → tests/progress/extension.test.ts
- "A word change rewrites the phase file with the new word, round, and now, and appends the standing to the history" → tests/progress/extension.test.ts
- "Reporting a phase for a TASK whose queue entry has been pruned is refused as a value, never thrown" → tests/progress/extension.test.ts
- "The history is appended to, never overwritten — a word that returns stands as its own entry" → tests/progress/extension.test.ts
- "The registered phase tool reports into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory" → tests/progress/extension.test.ts
<!-- /scenarios -->
