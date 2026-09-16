# docket

Answers, in one glance, where the queue stands and what the human still owes it. `inflight`
answers how in-flight TASKs relate to one another, as JSON for a program; `schedule` acts
on the queue and says what it found on the stderr of the pass that found it — a line that
scrolls away unwatched when several TASKs are dispatched at once. Nothing between them
gathers what a person actually wants while ten executor sessions run: each TASK's own word,
whether its session is still there to attach to, how long it has stood where it stands,
when it last moved, and which rulings are still outstanding.

The pipeline this queue belongs to is named Docket (docs/design.md §53); this capability is
that word doing its most literal work — showing what is on the docket.

Every fact it answers is read fresh from where some other capability already wrote it: the
queue directory, the raised-relationships record `schedule` keeps, the heartbeat `progress`
refreshes, the session list of the tmux server `startSession` runs sessions on. It reports
only — it writes nothing, judges nothing, dispatches nothing.

### Requirement: The docket answers one row per queue entry

The docket SHALL answer one row for every TASK the conventional queue directory holds —
including one whose state word has reached `merged`, until a scheduling pass prunes its
entry — each row carrying the TASK's name, its state word exactly as its `state` file holds
it, and the branch and base its MANIFEST records. Rows SHALL come back sorted by TASK name.
A queue directory that does not exist SHALL answer an empty docket, and a TASK entry that
cannot be read SHALL answer a problem naming it, with every other TASK's row still standing.

The row's honesty is the literal word, the same literalism the graph reads a state with: a
word this capability has never met is shown as it stands rather than translated, because an
unknown word on a docket is a signal to look, not an error to hide. The branch and base ride
along as the two facts that say which work the row stands for and where it was built;
whether that base still holds the TASK is `schedule`'s judgement to make, and this view
records it rather than deciding it. A merged TASK stays on the docket until the pass prunes
its entry, because a person asking what happened to a TASK wants the answer `merged`, not a
silent absence. Sorting by name keeps two runs over the same queue comparable, the same
reason the graph answers in one stable order.

### Requirement: A row carries how long the TASK has stood in its word, and when it last moved

Each row SHALL carry two numbers: how much time has passed since the TASK's `state` file was
last written, and how much time has passed since the TASK's heartbeat was last refreshed —
each read from its own file's write time, tracked nowhere else. A TASK with no heartbeat
file SHALL carry the second number as absent, never as a repeat of the first.

The two numbers answer different questions, and neither can stand in for the other. Time in
word says how long the TASK has been where it is — one `blocked-on-question` for two days
has been waiting on a human for two days, whatever its session did since. Time since the
heartbeat says how long the session has been silent — a TASK `building` for two hours whose
heartbeat is five minutes old is working, and one whose heartbeat is forty minutes old has
probably stopped; the word alone cannot tell those two apart, and telling them apart is the
case this capability exists for. No heartbeat is the ordinary state of a TASK with no
session — `queued` before dispatch, `merged` after a pass killed its session — so it is
answered as absent rather than dressed up as the word's own age. No log is kept and none is
needed: every word and every move was a file write, and the filesystem already records when
each happened.

### Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server

Each row SHALL say whether the dedicated tmux server — the one `startSession` runs executor
sessions on, reached through the same `PROOFSPEC_TMUX_SOCKET` override with the same default
(`specs/schedule.md`) — holds a session named for the TASK, by asking that server for its
session list once and matching names, and a session that is listed SHALL have its exact
attach command carried on the row. A session not listed SHALL be marked absent, and nothing
further asked about it.

"Which of these can I still attach to" is half of what a person watching the queue wants,
and no state word answers it: a session can die leaving `building` behind, never come up
leaving `queued` behind, or be killed by a settling pass leaving `merged` behind. The
server owns the fact, and asking it for its own session list is the same kind of read as
asking the queue directory for its entries — not the process-probe this design refuses
(`specs/schedule.md`): a PID is a claim about one machine's memory, a session list is the
server's own answer about what it holds. Absent is answered as absent and never interpreted;
deciding what an absent session means belongs to the capabilities that already decide such
things.

### Requirement: The answer names every relationship raised but not yet ruled

The docket SHALL read the raised-relationships record `schedule` keeps and name every entry
in it that carries no ruling yet — each with both TASKs it names, the CAPABILITY_FILE or
TERM they share, the relationship's key, and the exact command line that records a ruling
on it. An entry already ruled SHALL be absent from the answer.

A ruling is the one debt the queue cannot pay itself: `schedule` raises an unresolved
relationship once, on the stderr of the pass that found it, and with several TASKs running
that one line is gone before anyone looks. Gathering what the human still owes is the
difference between a view of the queue and a view of the docket. An entry drops out of the
answer the moment it is ruled, because the debt is paid — the record keeps the ruling, the
view keeps the outstanding. Reading `schedule`'s record does not make this capability an
orchestrator: it reads a fact another capability wrote to disk, exactly the way it reads the
queue directory.

### Requirement: The docket reports, and judges nothing

The docket SHALL write nothing anywhere, SHALL exit its ok code whatever it finds, and
SHALL not order TASKs beyond their name sort, rank what needs attention, decide a hold, or
start, restart, or kill any session.

Every judgement a docket row might tempt already belongs to a capability that makes it —
holds and releases to `schedule`, relationships to `inflight`, the meaning of a state word
to whoever wrote it. A view that began deciding would be a second scheduler liable to
disagree with the first, and a person reading it wants the queue's facts, not a second
opinion about them.
