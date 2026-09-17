# docket

Answers, in one glance, where the queue stands and what the human still owes it. `inflight`
answers how in-flight TASKs relate to one another, as JSON for a program; `schedule` acts
on the queue and says what it found on the stderr of the pass that found it — a line that
scrolls away unwatched when several TASKs are dispatched at once. Nothing between them
gathers what a person actually wants while ten executor sessions run: each TASK's own word,
whether its session is still there to attach to, how long it has stood where it stands,
when it last moved, and which rulings are still outstanding.

The pipeline this queue belongs to is named Docket (docs/design.md, "Docket"); this capability is
that word doing its most literal work — showing what is on the docket.

Every fact it answers is read fresh from where some other capability already wrote it: the
queue directory, the raised-relationships record `schedule` keeps, the heartbeat `progress`
refreshes, the session list of the tmux server `startSession` runs sessions on. It reports
only — it writes nothing, judges nothing, dispatches nothing.

The same answer is served as a page a browser keeps current on its own. A person watching
the queue does not retype a command at every glance; the docket is left open on a second
screen and read sideways, and the page is the surface that takes.

### Requirement: The docket answers one row per queue entry

The docket SHALL answer one row for every TASK the conventional queue directory holds —
including one whose state word has reached `merged`, until a scheduling pass prunes its
entry — each row carrying the TASK's name, its state word exactly as its `state` file holds
it, its phase word and round exactly as its `phase` file holds them, and the branch and
base its MANIFEST records. A TASK with no `phase` file SHALL carry the phase word and its
round both as absent, never invented. Rows SHALL come back sorted by TASK name. A queue
directory that does not exist SHALL answer an empty docket, and a TASK entry that cannot
be read SHALL answer a problem naming it, with every other TASK's row still standing.

The row's honesty is the literal word, the same literalism the graph reads a state with: a
word this capability has never met — a state word or a phase word — is shown as it stands
rather than translated, because an unknown word on a docket is a signal to look, not an
error to hide. The state word spends most of a TASK's life as `building`, and tells a
watching human nothing about where the work stands; the phase word is the executor's own
account of that — written at the executor's own pace, in the executor's own words
(`report_task_phase`, `specs/progress.md`) — and the docket carries it without judging it,
the same way it carries the state word. The branch and base ride along as the two facts
that say which work the row stands for and where it was built; whether that base still
holds the TASK is `schedule`'s judgement to make, and this view records it rather than
deciding it. A merged TASK stays on the docket until the pass prunes its entry, because a
person asking what happened to a TASK wants the answer `merged`, not a silent absence.
Sorting by name keeps two runs over the same queue comparable, the same reason the graph
answers in one stable order.

<!-- scenarios: generated -->
- "A TASK entry that cannot be read answers a problem naming it, with every other TASK's row still standing" → tests/docket/view.test.ts
- "A merged TASK stays on the docket until a pass prunes its entry" → tests/docket/view.test.ts
- "A queue directory that does not exist answers an empty docket" → tests/docket/view.test.ts
- "A state word the docket has never met is shown as it stands, not translated" → tests/docket/view.test.ts
- "Rows come back sorted by TASK name" → tests/docket/view.test.ts
<!-- /scenarios -->

### Requirement: A row carries how long the TASK has stood in its word, and when it last moved

Each row SHALL carry three numbers: how much time has passed since the TASK's `state` file
was last written, how much time has passed since the TASK's heartbeat was last refreshed,
and how much time has passed since the TASK's `phase` file was last written — each read
from its own file's write time, tracked nowhere else. A TASK with no heartbeat file SHALL
carry the second number as absent, never as a repeat of the first; a TASK with no `phase`
file SHALL carry the third number as absent the same way, never as a repeat of another.

The three numbers answer different questions, and none can stand in for another. Time in
word says how long the TASK has been where it is — one `blocked-on-question` for two days
has been waiting on a human for two days, whatever its session did since. Time since the
heartbeat says how long the session has been silent — a TASK `building` for two hours whose
heartbeat is five minutes old is working, and one whose heartbeat is forty minutes old has
probably stopped; the word alone cannot tell those two apart, and telling them apart is the
case this capability exists for. Time since the phase was written says how long the work has
stood where it stands: the phase word moves more often than the state word does — every
pipeline step is a phase move while the state stays `building` — so a TASK showing
`test-review` for two hours is a different fact from one showing it for two minutes, and
neither the state word nor the heartbeat can tell those two apart. No heartbeat is the
ordinary state of a TASK with no session — `queued` before dispatch, `merged` after a pass
killed its session — so it is answered as absent rather than dressed up as the word's own
age. No log is kept and none is needed: every word and every move was a file write, and the
filesystem already records when each happened.

<!-- scenarios: generated -->
- "A TASK with no heartbeat file carries the second number as absent, never as a repeat of the first" → tests/docket/view.test.ts
- "A row carries how long it has been since the heartbeat was last refreshed" → tests/docket/view.test.ts
- "A row carries how long it has been since the state file was last written" → tests/docket/view.test.ts
<!-- /scenarios -->

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

<!-- scenarios: generated -->
- "A session not listed is marked absent, and nothing further asked about it" → tests/docket/sessions.test.ts
- "A session the server holds is listed on the row with its exact attach command" → tests/docket/sessions.test.ts
- "The server's session list is read from tmux's own output, one name per line" → tests/docket/sessions.test.ts
- "The session list is asked of the dedicated server through PROOFSPEC_TMUX_SOCKET, with the same default" → tests/docket/sessions.test.ts
<!-- /scenarios -->

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

<!-- scenarios: generated -->
- "A raised entry with no ruling is named with both TASKs, the shared CAPABILITY_FILE or TERM, the key, and the ruling command" → tests/docket/view.test.ts
- "An entry already ruled is absent from the answer" → tests/docket/view.test.ts
<!-- /scenarios -->

### Requirement: The docket reports, and judges nothing

The docket SHALL write nothing anywhere, SHALL exit its ok code whatever it finds, and
SHALL not order TASKs beyond their name sort, rank what needs attention, decide a hold, or
start, restart, or kill any session.

Every judgement a docket row might tempt already belongs to a capability that makes it —
holds and releases to `schedule`, relationships to `inflight`, the meaning of a state word
to whoever wrote it. A view that began deciding would be a second scheduler liable to
disagree with the first, and a person reading it wants the queue's facts, not a second
opinion about them.

<!-- scenarios: generated -->
- "The docket exits its ok code whatever it finds" → tests/docket/view.test.ts
- "The docket orders TASKs by name alone, whatever their ages or words" → tests/docket/view.test.ts
- "The docket writes nothing anywhere" → tests/docket/view.test.ts
<!-- /scenarios -->

### Requirement: The docket answers on a page

The docket SHALL be answerable as a page a browser shows, served over HTTP on the machine
the command runs on, carrying exactly the content the JSON form carries: one row per queue
entry with every fact the row holds, every problem, and every outstanding ruling with the
command that records a ruling on it. Each request the server answers SHALL compute the
docket fresh — reading the queue directory, the heartbeat files, the raised-relationships
record, and the session list as that moment holds them — so a page held open shows the
docket as it stood at its last request, never as it stood when the server started.

The server owns no facts of its own. It is the same read the one-shot command makes, made
again each time it is asked, and a queue that has not moved between two requests answers
those two requests identically — which is the honesty this page is built on: nothing on it
is a cache, a prediction, or the residue of an earlier glance. Serving a page is not a
second capability beside the view; it is the view, asked more than once.

<!-- scenarios: generated -->
- "A queue that has not moved between two requests answers those two requests identically" → tests/docket/serve.test.ts
- "Each request answers the docket computed fresh, as that moment holds it" → tests/docket/serve.test.ts
- "The JSON answered at /docket is the same content the one-shot JSON form gives" → tests/docket/serve.test.ts
<!-- /scenarios -->

### Requirement: The page refreshes itself, and its numbers move only when an answer does

The page SHALL ask the server for the docket again on its own, on a short interval of its
own, and SHALL show every age exactly as the answer it last received held it — never
advancing a number in the browser between answers.

A person watching ten executor sessions wants the page to move without being told to ask,
so the refresh is the page's job and not the reader's. The ages stand still between answers
for the same reason the view reads them from file write times rather than keeping a log:
an age is a fact about a moment, and a number the browser inflates on its own clock is a
performance of the fact rather than the fact. When the next answer arrives the numbers
move with it — and two people reading the same open page read the same numbers.

<!-- scenarios: generated -->
- "Every age is shown exactly as the last answer held it, never advanced in the browser" → tests/docket/page.test.ts
- "The page asks the server for the docket again on its own, on a short interval" → tests/docket/page.test.ts
<!-- /scenarios -->

### Requirement: The page shows commands and offers no control that runs them

The page SHALL show the attach command of a listed session and the ruling command of an
outstanding relationship as text a person can copy, and SHALL offer no control that
attaches to a session, records a ruling, holds or releases a TASK, or starts, restarts, or
kills anything.

The reports-only rule is the page's rule too, and the browser is where it is most tempting
to break: a row that names a live session invites an attach button, and an outstanding
ruling invites a form. Both would put an actor inside the view — every action the queue
knows how to take already has a command that takes it, run in a terminal where its output
and its failure are readable, and `schedule` keeps every one of those decisions its own.
The page's requests are its refreshes, nothing else.

<!-- scenarios: generated -->
- "No control on the page attaches, rules, holds, or starts anything" → tests/docket/page.test.ts
- "The attach command of a listed session and the ruling command of an outstanding relationship are shown as copyable text" → tests/docket/page.test.ts
<!-- /scenarios -->
