# docket

Answers, in one glance, where the queue stands and what the human still owes it. `inflight`
answers how in-flight TASKs relate to one another, as JSON for a program; `schedule` acts
on the queue and says what it found on the stderr of the pass that found it — a line that
scrolls away unwatched when several TASKs are dispatched at once. Nothing between them
gathers what a person actually wants while ten executor sessions run: each TASK's own word,
which phases it has been through and how long each stood, whether its session is still
there to attach to, how long it has stood where it stands, when it last moved, and which
rulings are still outstanding.

The pipeline this queue belongs to is named Docket (docs/design.md, "Docket"); this capability is
that word doing its most literal work — showing what is on the docket.

Every fact it answers is read fresh from where some other capability already wrote it: the
queue directory, the archive the scheduling pass keeps, the raised-relationships record
`schedule` keeps, the heartbeat `progress` refreshes, the session list of the tmux server
`startSession` runs sessions on. It reports only — it writes nothing, judges nothing,
dispatches nothing.

The same answer is served as a page a browser keeps current on its own. A person watching
the queue does not retype a command at every glance; the docket is left open on a second
screen and read sideways, and the page is the surface that takes.

### Requirement: The docket answers one row per queue entry

The docket SHALL answer one row for every TASK the conventional queue directory holds —
including one whose state word has reached `merged`, until a scheduling pass prunes its
entry — each row carrying the TASK's name, its state word exactly as its `state` file holds
it, its phase word and round exactly as its `phase` file holds them, its phase history
exactly as its `phase-history` file holds it, and the branch and base its MANIFEST records.
A TASK with no `phase` file SHALL carry the phase word and its round both as absent, never
invented, and a TASK with no `phase-history` file SHALL carry the history as absent the
same way. A `phase` file or `phase-history` file that does not hold the shape
`report_task_phase` writes — including a `phase` file written before that shape gained its
`since` — SHALL answer as absent, the same rule the docket already keeps for a file that
holds no recognizable shape. Rows SHALL come back sorted by TASK name. A queue directory
that does not exist SHALL answer an empty docket, and a TASK entry that cannot be read
SHALL answer a problem naming it, with every other TASK's row still standing.

The row's honesty is the literal word, the same literalism the graph reads a state with: a
word this capability has never met — a state word or a phase word — is shown as it stands
rather than translated, because an unknown word on a docket is a signal to look, not an
error to hide. The state word spends most of a TASK's life as `building`, and tells a
watching human nothing about where the work stands; the phase word is the executor's own
account of that — written at the executor's own pace, in the executor's own words
(`report_task_phase`, `specs/progress.md`) — and the docket carries it without judging it,
the same way it carries the state word. The phase history rides the row for the same
reason: it is that account extended backwards, one appended entry per standing the TASK
reached, and the row carries it as it stands — a file whose shape the docket cannot read
answers as absent rather than half-invented, the rule it keeps for every file it reads.
The branch and base ride along as the two facts that say which work the row stands for and
where it was built; whether that base still holds the TASK is `schedule`'s judgement to
make, and this view records it rather than deciding it. A merged TASK stays on the docket
until the pass prunes its entry, because a person asking what happened to a TASK wants the
answer `merged`, not a silent absence. Sorting by name keeps two runs over the same queue
comparable, the same reason the graph answers in one stable order.

<!-- scenarios: generated -->
- "A TASK entry that cannot be read answers a problem naming it, with every other TASK's row still standing" → tests/docket/view.test.ts
- "A TASK with no phase file carries the phase word and its round both as absent, never invented" → tests/docket/view.test.ts
- "A merged TASK stays on the docket until a pass prunes its entry" → tests/docket/view.test.ts
- "A phase word the docket has never met is shown as it stands, not translated" → tests/docket/view.test.ts
- "A queue directory that does not exist answers an empty docket" → tests/docket/view.test.ts
- "A row carries the TASK's phase word and round exactly as its phase file holds them" → tests/docket/view.test.ts
- "A state word the docket has never met is shown as it stands, not translated" → tests/docket/view.test.ts
- "Rows come back sorted by TASK name" → tests/docket/view.test.ts
<!-- /scenarios -->

### Requirement: A row carries how long the TASK has stood in its word, and when it last moved

Each row SHALL carry three numbers: how much time has passed since the TASK's `state` file
was last written, how much time has passed since the TASK's heartbeat was last refreshed —
each read from its own file's write time, tracked nowhere else — and how much time has
passed since the TASK's phase word began running: now minus the `since` the `phase` file's
content records, never the `phase` file's write time. A TASK with no heartbeat file SHALL
carry the second number as absent, never as a repeat of the first; a TASK with no `phase`
file SHALL carry the third number as absent the same way, never as a repeat of another,
and a `phase` file that does not hold the shape `report_task_phase` writes — including one
written before that shape gained its `since` — answers the third number as absent too, the
same rule the row keeps for a file that holds no recognizable shape.

The three numbers answer different questions, and none can stand in for another. Time in
word says how long the TASK has been where it is — one `blocked-on-question` for two days
has been waiting on a human for two days, whatever its session did since. Time since the
heartbeat says how long the session has been silent — a TASK `building` for two hours whose
heartbeat is five minutes old is working, and one whose heartbeat is forty minutes old has
probably stopped; the word alone cannot tell those two apart, and telling them apart is the
case this capability exists for. Time in the phase word says how long the work has stood
where it stands: the phase word moves more often than the state word does — every pipeline
step is a phase move while the state stays `building` — so a TASK showing `test-review` for
two hours is a different fact from one showing it for two minutes, and neither the state
word nor the heartbeat can tell those two apart. The third number is read from the `since`
inside the file rather than from the file's write time because the file is rewritten every
time the round moves: an age read from the write time would say how long since the last
round, and a TASK that stood four hours in one word across two hundred rounds would show
minutes. The moment the word began is a fact about the word, and holding it in the file's
own content takes it out of the writes' reach — how often the file is written can no longer
change how long the word has stood. No heartbeat is the ordinary state of a TASK with no
session — `queued` before dispatch, `merged` after a pass killed its session — so it is
answered as absent rather than dressed up as the word's own age. The state word and the
heartbeat still need no log: every word and every move was a file write, and the filesystem
already records when each happened. The phase word keeps one — the `phase-history` file
`report_task_phase` appends on every change of standing — because its own file holds only
the present, and where the time went before the present is a question only a kept record
answers. The three ages themselves are still computed on each read from recorded moments,
and nothing aggregated is stored anywhere.

<!-- scenarios: generated -->
- "A TASK with no heartbeat file carries the second number as absent, never as a repeat of the first" → tests/docket/view.test.ts
- "A TASK with no phase file carries the third number as absent, never as a repeat of another" → tests/docket/view.test.ts
- "A row carries how long it has been since the heartbeat was last refreshed" → tests/docket/view.test.ts
- "A row carries how long it has been since the phase file was last written" → tests/docket/view.test.ts
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
the command runs on. The JSON the page reads at `/docket` SHALL carry exactly the content
the one-shot JSON form carries: one row per queue entry with every fact the row holds, the
phase history and the state word with its age among them, every problem, and every
outstanding ruling with the
command that records a ruling on it. Each request the server answers SHALL compute the
docket fresh — reading the queue directory, the phase files, the phase-history files, the
heartbeat files, the raised-relationships record, and the session list as that moment
holds them — so a page
held open shows the docket as it stood at its last request, never as it stood when the
server started.

The rendered page SHALL show everything the JSON carries except the state word and the
state word's age. The phase word and its round SHALL stand where the state word stood. The
round SHALL always show beside the phase word, round 1 included. The page's two ages SHALL
be the time in the phase word and the heartbeat age, each exactly as the row carries it.
For a TASK with no phase file — queued before any
session, or anything else — the page SHALL show the word's absence as absent, the same way
it shows a missing heartbeat, and SHALL never show the state word standing in for it.

The page SHALL also show, for each TASK, an account of the phases it has been through:
every phase word in the order each first stood; the total time spent in each, the word's
separate runs summed under the one word; and for a word that looped, how many rounds it
reached — its highest round. The current phase's time SHALL be live, moving with each
answer the page receives; every closed phase's time SHALL be closed. The durations SHALL be
computed on each request from the moments the history records — each entry running from the
moment it records to the moment the next entry records, the last running to now — and
nothing aggregated SHALL be stored anywhere.

The page drops the state word because the state word is the machine's closed contract — a
few fixed words the machine acts on — and it says `building` for almost the whole life of
a TASK. The phase word is the executor's own account of where the work stands
(`report_task_phase`, `specs/progress.md`), and the page is for the human watching. The
round shows even on round 1 because some steps of the executor's work happen more than
once: a bare phase word does not say whether the work is on its first `test-review` or its
third. The account answers the question that runs backwards from there: a phase word says
where the work stands now, and a person watching also asks which phases this TASK has been
through, how long each stood, and how many rounds a looping one reached — questions the
`phase-history` file already holds every fact for. Nothing is stored to answer them: the
account is computed fresh on each answer from the recorded moments, which is what makes the
current phase live and the closed phases closed — the last entry runs to now because the
standing it records is still the standing the `phase` file holds.

The state word stays in the JSON because the page's JSON is the same read the one-shot
command makes, not a second answer — and so the history travels in the JSON the same way.
The server owns no facts of its own; it makes that
read again each time it is asked, and a queue that has not moved between two requests
answers those two requests identically — which is the honesty this page is built on:
nothing on it is a cache, a prediction, or the residue of an earlier glance. Serving a
page is not a second capability beside the view; it is the view, asked more than once.

<!-- scenarios: generated -->
- "A queue that has not moved between two requests answers those two requests identically" → tests/docket/serve.test.ts
- "Each request answers the docket computed fresh, as that moment holds it" → tests/docket/serve.test.ts
- "Every column the header names is a cell every row carries" → tests/docket/page.test.ts
- "The JSON answered at /docket is the same content the one-shot JSON form gives" → tests/docket/serve.test.ts
- "The page a request answers carries the docket's facts as visible content" → tests/docket/page.test.ts
- "The page answered at / carries the docket computed at that moment" → tests/docket/serve.test.ts
- "The page ships the same shape for an empty docket, its absences spelled as absences" → tests/docket/page.test.ts
- "The page shows the TASK's phase word, its round, and how long it has stood there" → tests/docket/page.test.ts
- "The rows the page ships and the rows its script renders are the same HTML for the same answer" → tests/docket/page.test.ts
<!-- /scenarios -->

### Requirement: The page refreshes itself, and its numbers move only when an answer does

The page SHALL ask the server for the docket again on its own, on a short interval of its
own, and SHALL show the phase age and the heartbeat age exactly as the answer it last
received held them — never advancing a number in the browser between answers.

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

### Requirement: The page answers the archive of completed TASKs

The server SHALL answer a second read — a JSON answer at `/archive` — beside the docket's
own answer, computed fresh on each request from the archive directory
`.proofspec/archive/`. It SHALL carry one record per archived TASK, each holding: the
TASK's name; the branch and base its MANIFEST records; when it was enqueued, read from its
MANIFEST file's write time; when it was settled, read from its `state` file's write time;
how long it lived, the difference between those two times, computed on each request and
tracked nowhere else; and its phase history, read from the `phase-history` file the
archived entry carries — a file that needs no move of its own, because the archive move
takes the whole entry directory and the history rides along with the MANIFEST and the
`state` file. Records SHALL come back ordered by each TASK's start time — the enqueued
moment — earliest first; the live rows keep their own name sort. The page SHALL render the
records as a completed section beside its live rows, each record showing the same phase
account a live row shows: every phase word in the order each first stood, the total time
spent in each, and for a word that looped, how many rounds it reached. Every phase in an
archived account SHALL be closed — the TASK is finished — and the last entry's time SHALL
end at the TASK's settled moment, the moment the record already reads. An archived TASK
with no `phase-history` file SHALL carry the history as absent, never invented. An empty
archive SHALL be shown as an absence.

The docket's own answer is untouched by this read: the rows, one-shot and at `/docket`,
still carry exactly what they carried. What stands on the queue now and what has finished
are two questions, and the archive is the second one — not more rows of the first, because
a completed TASK is no longer in flight and standing it among the live rows would say it
was. Ordering by start time rather than by name makes the completed section a chronology:
the work shows in the order it began, earliest first, and the live rows keep their own name
sort because theirs is a different read serving a different question. The phase account
belongs in the completed section for the same reason it belongs on a live row: where a
finished TASK's time went is part of what finished means, and the archived `phase-history`
file already holds every fact of it — the prune archived the entry whole, and this read
only reads what stands there. Every number the record carries is computed on the request
that asks for it, the same way a live row's ages are: how long a TASK lived is the
difference between two write times, each phase's time is read from the moments the history
records, and no log of durations is kept anywhere. An empty archive shows as an absence
rather than a hidden section, the same honesty an empty docket already keeps: nothing
finished is a fact the page says plainly.

<!-- scenarios: generated -->
- "An archive that holds no TASK answers an empty list of records" → tests/docket/serve.test.ts
- "An empty archive is shown as an absence" → tests/docket/page.test.ts
- "The archive answer carries one record per archived TASK, each holding the fields read from its own files" → tests/docket/serve.test.ts
- "The archive answer is computed fresh on each request" → tests/docket/serve.test.ts
- "The completed rows the page ships and the rows its script renders are the same HTML for the same answer" → tests/docket/page.test.ts
- "The docket's own answer is unchanged by the archive's presence" → tests/docket/serve.test.ts
- "The page renders the archive's records as a completed section beside its live rows" → tests/docket/page.test.ts
- "The records come back ordered by start time, earliest first" → tests/docket/serve.test.ts
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
- "A live text selection inside the rows holds the refresh's swap, so a copy in progress survives" → tests/docket/page.test.ts
- "No control on the page attaches, rules, holds, or starts anything" → tests/docket/page.test.ts
- "The attach command of a listed session and the ruling command of an outstanding relationship are shown as copyable text" → tests/docket/page.test.ts
<!-- /scenarios -->
