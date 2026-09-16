# progress

Lets a running executor session report its own state word back into
`.proofspec/dispatch/<task>/`, the one act `docs/design.md` §49 named as an open gap when it
split personas: `startSession` (`specs/schedule.md`) starts a headed `pi` process in the
TASK's own worktree, and nothing after that point ever writes back to the queue entry that
started it. `writeState(cwd, task, word)` (`src/cli/queue.ts`) already overwrites a TASK's
`state` file with exactly the word it is given, with no notion of who is calling it or from
where; this capability is the one hop in front of that write a running session can actually
take — a `pi` extension tool, `report_task_state`, that resolves where the queue lives and
which TASK it is reporting for from the environment `startSession` hands it, rather than from
`ExtensionContext.cwd`, which names the session's own worktree, not the main checkout the
queue lives under.

`leaseDecision` (`src/schedule/lease.ts`) already treats the literal word `building` as proof
a session is live; before this capability, nothing running inside a session ever produced that
word. `report_task_state` closes exactly that gap: it does not decide when a TASK is actually
done, does not carry the text of a parked question, and does not add a `merged` state — those
remain other capabilities', or a future round's, to build. The capability carries a second
limb, the heartbeat: the same extension refreshes a timestamp in the same queue entry on
every move the session makes, so that a view reading the entry can tell a working session
from a silent one without asking either. Neither limb decides anything — the words and the
timestamps are facts a session leaves behind, and what anything makes of them belongs to
whoever reads them.

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
`merged` is left out on purpose too: §39's "a merged entry is rewritten to `merged`, never
removed" still has no producer, and building one is next round's work, not this one's.
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
never from `ExtensionContext.cwd` — and SHALL refuse, naming whichever variable is missing,
when either is unset, without writing anything.

An extension's `ExtensionContext` gives it only `cwd`, and `cwd` for a session `startSession`
opens is the TASK's own worktree (`.proofspec/worktrees/<task>`), not the main checkout
`.proofspec/dispatch/` actually lives under — the two are different directories by
construction, so no path an extension can compute from `cwd` alone ever names the queue. The
main checkout's path and the TASK's own name are both facts the scheduler already holds at the
moment it starts the session — it is the one that wrote the queue entry in the first place —
so `startSession` hands them down explicitly as environment variables (the amended requirement
in `specs/schedule.md`) rather than asking the worktree to infer them, say, from its own
directory name or `git rev-parse --git-common-dir`: a statement from the party that already
knows cannot be wrong the way an inference can. Refusing outright when either is absent, rather
than falling back to `cwd` or guessing, keeps a session started outside this convention from
silently writing into the wrong place, or into no place a scheduling pass will ever read.

<!-- scenarios: generated -->
- "A report with no PROOFSPEC_QUEUE_ROOT set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "A report with no PROOFSPEC_TASK set is refused, naming the missing variable, and nothing is written" → tests/progress/extension.test.ts
- "The registered tool reports into PROOFSPEC_QUEUE_ROOT even when ExtensionContext.cwd names a different directory" → tests/progress/extension.test.ts
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

### Requirement: The extension refreshes a heartbeat on every move the session makes

The session's extension SHALL refresh a `heartbeat` file in its TASK's queue entry whenever
the session makes any observable move — starting or ending a turn, starting, updating, or
ending a tool call, or streaming part of a reply — resolving the entry the same way
`report_task_state` does, from `PROOFSPEC_QUEUE_ROOT` and `PROOFSPEC_TASK`, and writing
nothing when either is unset. It SHALL NOT touch the `state` file or any other file in the
entry.

The heartbeat is a fact, not a word, and the difference is who can lie: a state word is a
claim that stays put until something rewrites it, while a heartbeat refreshed on every move
goes stale on its own the moment the moves stop — nobody has to remember to say so. That is
what lets it carry "how long since the last move" honestly where a `running` state word
would go silently false the moment the session hung after writing it (docs/design.md §55).
A subagent is a tool call on this session's own surface: its steps arrive as tool updates,
so a subagent at work refreshes the heartbeat and one that has stopped does not — while the
refresh grain stays per move, not per token, because a session cannot observe inside a child
process's token stream, and a requirement promising more than the process can observe would
be lying about its own facts. The heartbeat feeds the docket view (`specs/docket.md`) and
nothing else: LEASE staleness keeps measuring elapsed time against the `building` word,
exactly as it already does, untouched.

<!-- scenarios: generated -->
- "A heartbeat file is refreshed in the TASK's queue entry on every observable move the session makes" → tests/progress/extension.test.ts
- "A heartbeat refresh leaves the entry's state, MANIFEST, and LEASE exactly as they were" → tests/progress/extension.test.ts
- "No heartbeat is written when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset" → tests/progress/extension.test.ts
<!-- /scenarios -->
