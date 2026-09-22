# schedule

`inflight` answers what is in flight; this capability is the one that acts on the answer —
the one with permission to write into the queue directory — releasing a TASK held on one
that is no longer live, pruning a queue entry nothing points at any more, judging a
relationship before a human ever sees it, and starting the one executor session a ready TASK
is owed, within the live-session bound this document sets.

It reads `inflight`'s answer the way `cli` reads a TASK's own MANIFEST and state file: as
something to act on, not something to recompute. `specs/inflight.md` is not touched by this
capability — the graph still only reports.

### Requirement: A TASK held on another is released once the held-on TASK is no longer live

A TASK whose MANIFEST's `base` names another TASK of kind `task` SHALL be held until that
named TASK is no longer live, and released the moment it is not — whether because the named
TASK's own state has reached merged, or because the queue holds no record of it at all.

There is exactly one graph of what is in flight, and both the hold and the graph read it
the same way. A hold with its own notion of "still live" could disagree with it: held past
the moment the graph would call the block gone, or released while the graph still reports it
live.

<!-- scenarios: generated -->
- "A TASK based on main carries no hold status at all" → tests/schedule/holds.test.ts
- "A TASK held on a TASK that has since merged is dispatched" → tests/schedule/end-to-end.test.ts
- "A TASK held on a still in-flight TASK is not dispatched" → tests/schedule/end-to-end.test.ts
- "A TASK whose base names a TASK absent from the queue entirely is released" → tests/schedule/holds.test.ts
- "A TASK whose base names a merged TASK is released" → tests/schedule/holds.test.ts
- "A TASK whose base names a still in-flight TASK is held" → tests/schedule/holds.test.ts
- "A held TASK is never ready to dispatch, however queued its own word is" → tests/schedule/lease.test.ts
<!-- /scenarios -->

### Requirement: A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main

A scheduling pass SHALL settle a TASK when both conditions hold: the TASK's current state
word is `mergeable`, and its MANIFEST's `branch` is an ancestor of `main`. A settle SHALL
rewrite the TASK's state file to `merged`, remove its worktree at its conventional path,
and kill its same-named tmux session on the dedicated server, in that order — so a TASK the
queue has settled leaves nothing checked out behind it. Both conditions SHALL be checked
fresh from git at the moment of the settle, never from bookkeeping. A TASK failing either
condition SHALL keep its state word exactly as it stands, with nothing removed and nothing
killed. The settle has two callers: a scheduling pass runs it for every TASK it visits, and
the `settle_task` tool (`specs/progress.md`) runs the same settle from inside the executor
session that just merged — the pass is the backstop, not the only hand. The session kill
SHALL go through a detached reaper process with a short delay, so the settle answers its
caller before the host session dies.

The executor is the one party that knows the moment its merge lands; a pass is not,
because a pass wakes only on events, and the merge lands inside the TASK's own worktree,
where the queue directory does not live — the event a merge raises fires where nothing
that could settle is listening. The executor therefore triggers the settle itself, through
`settle_task`, and the pass keeps running the same check so that a TASK the tool never
settles — a session that died mid-merge, a merge landed by hand — is settled the next
time a pass runs. Neither caller is trusted on its word: the settle verifies both
conditions from git itself.

Both conditions are required because each covers the other's blind spot. A branch is an
ancestor of `main` from the moment it is cut, so ancestry alone would mark a freshly
queued TASK `merged` before any work happened; the `mergeable` word is the executor's own
claim the work is done. And `mergeable` alone is only a claim — the landing in git is
the proof, which is exactly what the ancestor check supplies.

The state word is written first because it is the fact the rest of the queue keys on: a
hold releases on `merged`, and the pruner below waits for it. The worktree and the session
are residue, and they go after. Killing the session is the one act here that can bite the
hand calling it: the caller of `settle_task` is usually the very session being killed, and
the executor's session lives inside the worktree being removed. Handing the kill to a
detached reaper process with a short delay is what makes an executor-triggered teardown
safe — the settle answers its caller first, and the host session dies a moment later, once
the answer is already out. A worktree left behind is not harmless litter, either: it keeps
the TASK's branch checked out under its own name, which is exactly the collision a later
dispatch of that name stumbles over. Settling a TASK's residue is mechanics, not judgment,
and asks nothing of a human.

<!-- scenarios: generated -->
- "A TASK held on a mergeable TASK whose branch has landed is dispatched by the same pass that settles it" → tests/schedule/end-to-end.test.ts
- "A TASK whose branch has landed but whose word is not mergeable keeps its state word exactly as it stands" → tests/schedule/end-to-end.test.ts
- "A landed branch alone does not settle a TASK whose word is not mergeable" → tests/schedule/merge.test.ts
- "A mergeable TASK whose branch has landed in main is named for settling" → tests/schedule/merge.test.ts
- "A mergeable TASK whose branch has not landed in main is not named for settling" → tests/schedule/merge.test.ts
- "A mergeable TASK whose branch has not landed in main keeps its state word exactly as it stands" → tests/schedule/end-to-end.test.ts
- "A scheduling pass rewrites a mergeable TASK's state to merged once its branch has landed in main" → tests/schedule/end-to-end.test.ts
- "The landed-in-main check is made fresh from git on each pass, never from bookkeeping" → tests/schedule/end-to-end.test.ts
- "The pass's settle kills the TASK's session through the reaper, so the pass has already answered when the kill lands" → tests/schedule/end-to-end.test.ts
- "The settled TASK's tmux session is killed on the dedicated server" → tests/schedule/session.test.ts
- "The settled TASK's worktree is removed from its conventional path, freeing its branch for a later dispatch" → tests/schedule/session.test.ts
<!-- /scenarios -->

### Requirement: A merged TASK's queue entry is pruned once nothing still names it

A queue entry whose TASK's state has reached merged SHALL be pruned by a scheduling pass
once no in-flight TASK's `base.task` still names it, and SHALL NOT be pruned before that.
Pruning SHALL move the entry whole into the archive directory `.proofspec/archive/<task>/`
rather than delete it: every file the entry held — its MANIFEST, its `state` file, its LEASE,
its `INTENT` and `acceptance.md`, its `heartbeat`, its `phase` — arrives in the archive
exactly as it stood, and nothing of the entry remains in the queue directory. Nothing SHALL
rewrite an archived entry afterwards.

The timing criterion is unchanged. A merged entry has to keep standing for as long as some
other TASK's basedOn claim might still ask about it: pruning early is exactly what would
flip a graceful "based on a TASK that merged" into a false "based on a TASK the queue holds
no record of at all," naming a TASK that in fact finished cleanly. Once no in-flight TASK
names it any more, that risk is gone, and the entry leaves the queue for the archive. The
criterion reads every in-flight TASK's `base`, so pruning needs no bookkeeping of its own
to decide when a name has gone quiet.

The archive is the record of finished work, and it is kept rather than cleaned: completed
TASKs stay readable so the work can be read and analyzed later. Deleting a pruned entry
would be cleaner, and would leave nothing to analyze. The entry moves as it stands and is
never rewritten afterwards, so an archived entry is what the TASK's entry held at the
moment it finished, not a summary written for a later reader. Listing the archive directory
alone answers which TASKs are done. The word prune keeps its meaning — removal from the
queue directory — and what changed is where the removed entry goes.

<!-- scenarios: generated -->
- "A merged TASK an in-flight TASK still names is kept" → tests/schedule/end-to-end.test.ts
- "A merged TASK an in-flight TASK's base still names is not pruned" → tests/schedule/prune.test.ts
- "A merged TASK no in-flight TASK's base names is pruned" → tests/schedule/prune.test.ts
- "A merged TASK nothing still names is pruned from the queue directory" → tests/schedule/end-to-end.test.ts
- "A merged TASK only a merged TASK's base still names is pruned" → tests/schedule/prune.test.ts
- "An in-flight TASK is never pruned" → tests/schedule/prune.test.ts
- "The pruned entry stands in the archive whole, exactly as it stood" → tests/schedule/end-to-end.test.ts
<!-- /scenarios -->

### Requirement: Dispatching a ready TASK starts exactly one executor session

Dispatching a TASK ready to build SHALL start exactly one headed, interactive executor
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

### Requirement: No executor session starts once the live-session bound is reached

A scheduling pass SHALL count the executor sessions live on the dedicated tmux server — the
same server `startSession` starts them on, reached through `PROOFSPEC_TMUX_SOCKET` — fresh
at each dispatch decision, from the server itself and never from bookkeeping of its own,
and SHALL start no executor session once that count has reached the bound. The bound SHALL
be four by default, overridable through the `PROOFSPEC_MAX_SESSIONS` environment variable,
with a malformed override falling back to four rather than silently disabling the bound. A
TASK the bound leaves undispatched SHALL keep its state word `queued` exactly as it stands;
a later pass dispatches it once a session has gone.

Counting sessions on that server is counting exactly the executor sessions this tool started
and has not itself killed, and a session that dies — executor finished, machine rebooted,
tmux killed by hand — shortens the list on its own, so the pass keeps no count of its own to
drift. A TASK's state word is the wrong measure: a session is alive through its whole
start-to-`building` window and past `mergeable` while it still merges, and a pass counting
words would overshoot the bound in exactly those windows. A TASK left undispatched keeps
`queued` because nothing about the TASK changed — only the machine's capacity did, and
capacity freeing is no state of the TASK's own: a freed slot is there for the next pass to
see, with no producer of its own to build. The bound is what a single pass can see: two
passes triggered at the same instant can each see three live sessions and each start one —
five, briefly — and closing that window would take a lock over the whole queue, which this
design declines to build. The `PROOFSPEC_MAX_SESSIONS` override lets a test exercising the
bound point at a throwaway socket and a bound of one, rather than start four real sessions
on the production server.

<!-- scenarios: generated -->
- "A TASK the bound leaves undispatched keeps its state word queued exactly as it stands" → tests/schedule/end-to-end.test.ts
- "A later pass dispatches a TASK the bound deferred once a session has gone" → tests/schedule/end-to-end.test.ts
- "A malformed PROOFSPEC_MAX_SESSIONS override falls back to four rather than silently disabling the bound" → tests/schedule/bound.test.ts
- "A ready TASK with no countSessions action given cannot run the pass" → tests/schedule/end-to-end.test.ts
- "A scheduling pass starts no session once the live count has reached the bound" → tests/schedule/end-to-end.test.ts
- "A well-formed PROOFSPEC_MAX_SESSIONS override replaces the default bound" → tests/schedule/bound.test.ts
- "The live count is asked of the dedicated server by its own -L socket, never the default server" → tests/schedule/session.test.ts
- "The live count is taken fresh at each dispatch decision, so one pass fills the bound TASK by TASK" → tests/schedule/end-to-end.test.ts
- "The live count reads the sessions standing on the server itself, answering zero when none stand" → tests/schedule/session.test.ts
- "The live-session bound is four by default" → tests/schedule/bound.test.ts
<!-- /scenarios -->

### Requirement: The bare CLI's startSession opens the TASK's own worktree and starts the harness `PROOFSPEC_EXECUTOR` names there, headed

The bare CLI's `startSession` action SHALL read the ready TASK's own MANIFEST for its
`branch`, ensure a worktree for that branch exists at the conventional path
`.proofspec/worktrees/<task>` — creating one with `git worktree add` whenever that path
is not itself a worktree, reusing it unchanged only when it is — and start the executor
agent there in a detached tmux session named for the TASK, first killing any same-named
session already there. A creation that fails SHALL throw an error carrying git's own
stderr in its message, never a bare "could not create" summary in stderr's place. Which
agent the invocation runs SHALL be named by the `PROOFSPEC_EXECUTOR` environment
variable — `pi` or `claude`, defaulting to `pi`. Whatever the choice, the invocation
SHALL carry `-e PROOFSPEC_QUEUE_ROOT=<cwd>` and `-e PROOFSPEC_TASK=<task>` as environment
variables on the tmux `new-session` command, and SHALL be handed one initial user message
as the agent's positional prompt argument — a message telling the session to begin working
its TASK, whose exact words are the implementation's to choose. The `pi` invocation SHALL
be run with `--approve`, `--no-extensions`, and `--extension
<cwd>/.pi/extensions/progress.ts`. The `claude` invocation SHALL be run with
`--append-system-prompt` carrying the executor's own system prompt, with
`--dangerously-skip-permissions`, and with a generated MCP config naming the queue root's
own MCP server (`specs/mcp.md`); where that generated config file is written is the
implementation's choice, and which server it names is not. Every tmux command this action
runs SHALL reach tmux through a dedicated, isolated server, named by tmux's own `-L
<socket>` flag rather than the default server — never the user's own default tmux server,
and never any other named server — with a default socket name derived from the queue
root's absolute path: `proofspec-` followed by the first 8 hex digits of that path's
SHA-256 digest, overridable through the `PROOFSPEC_TMUX_SOCKET` environment variable.

A ready TASK may reach this action with no worktree ever opened for it, or with one torn
down independently of its queue entry — nothing about a queue entry standing guarantees a
worktree behind it. A creation that fails partway can leave an empty directory behind, and
a session started in whatever merely sits at the path could do no work and report no
failure, on every retry — so the path is reused only when it is itself a worktree. A
creation that fails throws carrying git's own stderr, because a bare "could not create"
names no cause.

The same-named session is killed first so a TASK whose first session attempt died gets a
working session on retry. Every tmux command reaches the dedicated server so a TASK's name
can never collide with a session it did not create, and `PROOFSPEC_TMUX_SOCKET` lets a test
or an acceptance run point at a throwaway, per-run socket. The dedicated server keeps this
tool's sessions off the user's own tmux server, and a fixed default name made every repo
on the machine share that one server: one repo's sessions counted against another's
live-session bound, and a same-named TASK in two repos killed each other's session.
Deriving the name from the queue root gives each repo its own server, with no
configuration. There is no special case for the single-repo user; everyone gets the
derived name.

The choice is one environment variable because everything else about starting a session
is the same act either way, and the default stays `pi` so a queue that never names a
harness runs exactly as it ran before.

The session starts inside the TASK's own worktree and needs both facts — where the queue
lives, and which TASK it is — which this action already holds at the moment it starts the
session, so it hands them down as the two environment variables. The tool that reports
state must load in a freshly created worktree, and the copy it loads must be the current
one. On the `pi` side, `--approve` is what lets the tool load there, the pinned
`--extension` points at this tool's own checkout rather than whatever the TASK's branch
carries, and `--no-extensions` keeps the worktree's own copy of the extension from loading
beside the pinned one. On the `claude` side, the generated config carries the same
freshness reasoning for the MCP server (`specs/mcp.md`), and `--dangerously-skip-permissions`
stands because an unattended session has nobody attached to answer an approval.

A session handed no first message never begins working its TASK, so the invocation carries
one kickoff message.

<!-- scenarios: generated -->
- "A directory merely sitting at the TASK's conventional path is not reused, a worktree is created instead" → tests/schedule/session.test.ts
- "A ready TASK whose worktree already exists at its conventional path has it reused, not recreated" → tests/schedule/session.test.ts
- "A ready TASK whose worktree has never been checked out gets one created at its conventional path" → tests/schedule/session.test.ts
- "A worktree creation that fails throws an error carrying git's own stderr" → tests/schedule/session.test.ts
- "PROOFSPEC_TMUX_SOCKET overrides which dedicated server the tmux commands target" → tests/schedule/session.test.ts
- "The pi invocation carries --approve and --extension pinned to this checkout's own progress extension" → tests/schedule/session.test.ts
- "The pi invocation disables extension auto-discovery, so the worktree's own copy of progress.ts never loads alongside the pinned one" → tests/schedule/session.test.ts
- "The pi invocation is handed one initial user message as its positional prompt argument, telling the session to begin working its TASK" → tests/schedule/session.test.ts
- "The tmux commands kill any stale session by the TASK's name before starting a fresh one running pi" → tests/schedule/session.test.ts
- "The tmux commands run against a dedicated server, never the user's default or any other named one" → tests/schedule/session.test.ts
- "The tmux start command carries PROOFSPEC_QUEUE_ROOT and PROOFSPEC_TASK as environment variables naming the main checkout and the TASK" → tests/schedule/session.test.ts
- "startSession's own cwd becomes the SessionStart's queueRoot, distinct from the TASK's worktree" → tests/schedule/session.test.ts
<!-- /scenarios -->

### Requirement: startSession seeds the executor session with the executor's own system prompt

The bare CLI's `startSession` action SHALL use `.pi/agents/executor.md` — its YAML
frontmatter stripped — as the executor session's system prompt.

The session must know it is the executor, that its scope starts only after the disposition
review, and that a wrong judged standard — never a wrong implementation — is the one thing
it should park on and ask about. `.pi/agents/executor.md` carries that persona; its
frontmatter is metadata for a spawner, not prompt prose, so it is stripped before the body
is handed over. The persona is read from this tool's own checkout, never the TASK's
worktree: the executor's instructions are an operational convention this checkout keeps,
not something a TASK's own branch — cut from `main` at some earlier, possibly stale, point
— gets to redefine for itself.

<!-- scenarios: generated -->
- "A persona file with no frontmatter passes through unchanged" → tests/schedule/session.test.ts
- "The executor persona's YAML frontmatter is stripped before it is used as a system prompt" → tests/schedule/session.test.ts
<!-- /scenarios -->

### Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang

The bare CLI's `judge` action SHALL run a fresh, one-shot process for every relationship
it is handed — never a saved session, never reused across relationships — closing that
process's stdin the instant it starts, and SHALL bound its wait for an answer with a
timeout, so that one relationship's process can never hang the scheduling pass that
awaits it. The process's binary SHALL be named by the `PROOFSPEC_JUDGE_BIN` environment
variable, defaulting to `pi`, and the argv SHALL be built for the binary it names:
`claude` runs as one headless one-shot process, `pi` as the one-shot process the
requirements above pin. Which binary runs changes nothing about what is asked or how the
answer is read.

The bare CLI supplies a real `judge` action for every relationship the graph finds; what
the fresh agent is asked, and how its answer is read, belong to the requirements above,
and this one is about the choice of process. The process's stdin is closed the instant it
starts, so it cannot hang waiting for input that will never arrive. The timeout exists
because nothing else stops one bad run from hanging everything behind it: `judge` is
awaited one relationship at a time, so one hang would hang the whole pass. The binary is
an environment variable's choice because which process asks is an operational fact, not a
rule: the question and the reading stay the one shared thing.

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

Nothing clears a LEASE on its own if the executor session it started never comes up, or
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

For every relationship the graph reports, a scheduling pass SHALL hand a fresh agent —
one that authored neither TASK's work, and that runs as a single tool-less,
session-less process naming the model it answers as — both TASKs' intent, each read by
the one rule its own MANIFEST's `intentRef` sets: the reserved name `INTENT` from the
TASK's own queue entry, and any other value from the TASK's `branch` — and ask it
whether the relationship is a real conflict, before any human is asked anything about
it. A TASK whose intent could not be read SHALL be named as missing in that ask, not
silently dropped, and the same relationship SHALL ask the same question however its two
TASKs arrive.

Most shared ground between two TASKs is coincidence, not conflict, and reading both
intents is cheap enough to run on every relationship the graph finds, which is what keeps
a human's attention for the ones that actually need it. A process with no tools and no
saved session is what makes "authored
neither TASK's work" a fact about the call, not an assumption about who happens to be
running it — it cannot have touched either TASK's branch, and it remembers nothing from
one relationship to the next, so the same two TASKs get the same question wherever in
the queue's pass order they happen to fall. The reserved name exists because a TASK
whose intent document is its queue entry's `INTENT` file may carry zero commits on its
branch, so no file on that branch can hold its intent; the queue entry's own directory
is the one place left to read, and `INTENT` sits there in the family of `MANIFEST`,
`state`, `LEASE`, and `heartbeat`. One rule covers both shapes so every reader — the
judge here, an executor cold-reading its own TASK — resolves the same `intentRef` the
same way.

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
- "The reserved INTENT name reads the TASK's intent from its own queue entry, a path value from the branch" → tests/schedule/end-to-end.test.ts
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

An orchestrator able to generate its own authority is the single most dangerous component a
design like this one can have. "The human has ruled" has to trace to a record a later reader
can go and check — a notification may be relayed on the human's behalf, but a verdict may
not.

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

stdout carries the one line a program parses, and a finding written there would corrupt it.
stderr carries a human-facing message without touching that line, and it reaches exactly one
kind of human: whoever is already watching the process that ran the scheduling pass. This is
deliberately the minimal version — no paging, no proactive alert — and a finding nobody is
watching for goes unheard until the next time someone looks.

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

The write puts exactly the word in without judging it. Validating a transition — that only a
TASK already `building` may be marked `merged`, say — is a question about what the words
mean and which orders make sense, and that question belongs entirely to whatever future
caller writes a specific verb like `markMerged`. No caller needs more than the primitive
yet, so no verb is built.

<!-- scenarios: generated -->
- "writeState overwrites an existing state file with the word it is given, whatever it is" → tests/schedule/queue.test.ts
<!-- /scenarios -->

### Requirement: enqueue creates a queue entry once, and refuses rather than overwrite one already there

`enqueue(cwd, task, manifest)` (`src/cli/queue.ts`) SHALL create a TASK's queue entry — its
directory, its `MANIFEST`, and an initial state of `queued` written through `writeState` —
only when no entry of that TASK's name stands in the queue directory and none stands in the
archive directory `.proofspec/archive/`, and SHALL refuse, touching nothing, when either
does, answering `{ok: false, reason}` rather than overwriting anything. A refusal because
of the archive SHALL name the archive in its reason.

A TASK name is spent once. A name a finished TASK already used stays with that TASK in the
archive, and is never handed to a new one: two TASKs of one name — one finished in the
archive, one in flight in the queue — would leave every reader that names TASKs unable to
say which TASK a name means. Two callers racing to enqueue the same TASK name still end
with exactly one entry, the winner's and not a mix: the create is exclusive, so the loser
refuses rather than overwrites. There is deliberately no new CLI verb for this — nothing
calls `proofspec enqueue` from a command line, and none is being added here — `enqueue`
ships as a plain exported function for a future caller, an "investigator" capability not
yet built, to use.

<!-- scenarios: generated -->
- "A TASK name already standing in the archive is refused, naming the archive" → tests/schedule/queue.test.ts
- "A TASK name no archived entry holds enqueues while the archive stands" → tests/schedule/queue.test.ts
- "Two racing enqueue calls on the same TASK name still create exactly one entry" → tests/schedule/queue.test.ts
- "enqueue creates a new TASK's MANIFEST and initial queued state" → tests/schedule/queue.test.ts
- "enqueue refuses a TASK name already in the queue, without touching its existing entry" → tests/schedule/queue.test.ts
<!-- /scenarios -->
