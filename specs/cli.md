# cli

The commands people and CI actually run.

Everything else in this tool is a library. This is where it becomes something you can put
in a build.

### Requirement: Checking never writes

The command that checks SHALL NOT modify any file.

A check that quietly fixed what it found would report success on a repo that was wrong
until the moment it ran. The build would go green and the committed CAPABILITY_FILE would go on
disagreeing with what was reviewed.

Writing back is a separate command, run on purpose.

<!-- scenarios: generated -->
- "A check that finds drift changes no file on disk" → tests/cli/no-write.test.ts
<!-- /scenarios -->

### Requirement: The exit code says what happened

The check SHALL exit zero when the tests and the committed CAPABILITY_FILE agree, and non-zero
when they do not.

A tool that cannot be configured or cannot read its inputs SHALL exit with a different
non-zero code than a spec that has drifted. CI needs to tell "your spec is wrong" apart
from "I could not run".

<!-- scenarios: generated -->
- "A repo the check cannot run in exits with a code that is not the drift code" → tests/cli/exit-code.test.ts
- "Agreement between the tests and the committed CAPABILITY_FILE exits zero" → tests/cli/exit-code.test.ts
- "Drift between the tests and the committed CAPABILITY_FILE exits non-zero" → tests/cli/exit-code.test.ts
<!-- /scenarios -->

### Requirement: It runs in a conventional repo with no configuration

Running the check in a repo that keeps its CAPABILITY_FILE and its tests in the usual places
SHALL work with no configuration file present.

Both locations SHALL be configurable for repos that do it differently. Nothing else needs
setting: there is no compiler to point at and no project to build.

<!-- scenarios: generated -->
- "Both locations can be pointed at where a repo keeps them" → tests/cli/locations.test.ts
- "Component suites named .test.tsx are discovered like any other test" → tests/cli/locations.test.ts
- "Locations given as absolute paths are read from exactly there" → tests/cli/locations.test.ts
- "Tests given by the caller are read as they stand" → tests/cli/locations.test.ts
- "The conventional layout is checked with no locations given" → tests/cli/locations.test.ts
<!-- /scenarios -->

### Requirement: Any answer can be given in a form a program can read

Every command SHALL be able to return its answer as JSON, carrying the same content as
the form written for a person.

The tree, the positions, and the failures are all things another tool will want — an
editor, a CI annotation, and in a later version an MCP server. Each of those should read
the same answer rather than parse the one meant for a terminal.

An answer SHALL reach its reader whole, however large it is. A cut-off answer is not a
smaller answer but a broken one, and the reader is usually a program.

The JSON SHALL be given on one line unless a layout is asked for, and indented over several
lines when it is. One line is what a program parses and what a pipe carries. A person reads
the same answer too — the touched report especially, which is JSON without being asked — and
one line of it is the thing they reach for another tool to reformat. Laying it out is a
choice the caller makes, so the answer a script already reads does not change under it.

<!-- scenarios: generated -->
- "A format named on the command line is the one used" → tests/cli/touched.test.ts
- "A verdict still answers as text when no format is asked for" → tests/cli/touched.test.ts
- "An answer larger than a pipe holds reaches its reader whole" → tests/cli/e2e.test.ts
- "The JSON answer is laid out over indented lines when a person asks for it" → tests/cli/touched.test.ts
- "The JSON answer stays on one line when no layout is asked for" → tests/cli/touched.test.ts
- "The check's findings are returned as LSP diagnostics a modern editor shows inline" → tests/cli/format.test.ts
- "The check's findings are returned in quickfix form for an editor to jump to" → tests/cli/format.test.ts
- "The check's verdict is returned as JSON carrying the same findings" → tests/cli/json.test.ts
- "The touched command answers as JSON when no format is asked for" → tests/cli/touched.test.ts
- "The write's answer is returned as JSON naming the changed files" → tests/cli/json.test.ts
<!-- /scenarios -->

### Requirement: Writing back records the tests in the committed CAPABILITY_FILE

The write command SHALL update each committed CAPABILITY_FILE so its recorded scenarios
match the tests, and change nothing else.

Writing back is the separate command, run on purpose.

It touches only the generated blocks. Headings, descriptions, and every other line come
back exactly as they were, and a file already in agreement with its tests comes back byte
for byte the same.

If a test cannot be read, the write SHALL change nothing and say so. It records what the
tests prove, so a test the scan could not read is a tree it cannot trust. Unlike the check,
the write changes files, so it refuses before it acts rather than reporting after.

<!-- scenarios: generated -->
- "Writing back a repo already in agreement changes no file" → tests/cli/write.test.ts
- "Writing back a repo it cannot fully read changes nothing" → tests/cli/write.test.ts
- "Writing back leaves the other CAPABILITY_FILE untouched" → tests/cli/write.test.ts
- "Writing back records a scenario the tests prove but the file did not" → tests/cli/write.test.ts
- "Writing back through an absolute location changes the file exactly there" → tests/cli/write.test.ts
<!-- /scenarios -->

### Requirement: A command renders the spec into an output directory

The CLI SHALL provide a render command that writes the rendered pages into a directory and
reports the files it wrote.

The pages are a delivery artifact, not an input: they are regenerated from the tests on
demand and read by a person, never read back by the tool. The command writes an index, one
page per capability, and the full spec as a single page; given no directory it writes them
under `build/`, and a directory can be given for a repo that keeps the generated pages
elsewhere. The pages are a generated output a repo gitignores rather than commits. Inputs it cannot
read are refused.

A capability's requirements are headed in the order its CAPABILITY_FILE declares them, not by
name. A
description is prose the human owns, and prose refers to its neighbours: a page that sorts
the requirements makes every "the requirement below" point at one above it.

<!-- scenarios: generated -->
- "An absolute output directory is written to exactly" → tests/cli/render.test.ts
- "The render command reports it cannot run on unreadable inputs" → tests/cli/render.test.ts
- "The render command writes into a chosen directory" → tests/cli/render.test.ts
- "The render command writes to the default directory when none is given" → tests/cli/render.test.ts
- "The rendered page lists requirements in the CAPABILITY_FILE's order" → tests/cli/render.test.ts
<!-- /scenarios -->

### Requirement: A command says which scenarios a change touched

The CLI SHALL provide a command that reads the changes to the tests and says which PROMISE
they reached, in one of three shapes: the work list, one requirement in full, or the changed
lines that fall in no PROOF. Asked for nothing in particular it SHALL give the work list.

**The work list SHALL count each requirement the change reached rather than write it out**,
carrying its capability, its name, how many of its scenarios were touched, how many of its
PROOF were removed, how many of those PROMISE nobody has judged, and the address the rest of
it is fetched by. It also SHALL carry how many changed runs fall in no PROOF, as a number.

The work list is read on every turn of the review loop, so it carries counts, not contents.

**One requirement asked for by address SHALL carry everything judging it takes**: the prose
written under it, every scenario of it the change touched with the CLAIM it makes and the
lines that prove it as they are written, every PROOF of it the change removed, the KEY each of
those is judged under, whatever judgement already stands against each, and how they are to be
judged. Carrying the source is what makes one call enough — an agent asked whether a test still
does what its CLAIM says would otherwise open every file the report named. A scenario proven
inside a shared test is proven by more than one run of lines, and the answer SHALL carry every
one of them, since handing over only the first would leave an agent judging a CLAIM against
half its evidence. A sibling's lines are not among them.

Each requirement SHALL carry where it is written together with the prose written there. The
two arrive together or not at all: a requirement no CAPABILITY_FILE declares has neither, and
its scenarios are still named under it, because a PROMISE nothing declares is exactly what the
reader has to see. Judging that gap is the check's job, not this one's.

An address that names no requirement the change reached SHALL be a cannot-run rather than an
empty answer. A stale KEY handed back as "nothing to judge here" is how a reviewer works
through a list and reviews none of it.

**The changed lines that fall in no PROOF SHALL be asked for on their own**, carrying their
source, and a run of them that is nothing but whitespace SHALL not be reported at all. They are
the helper, the import and the fixture edits, and they are usually a line or two — the read
that fetches them costs a reader more than the lines are worth, so they are carried as written.
But nothing judges them, and on a change that adds tests there are more of them than there are
PROMISE, so they are not in the work list beyond their number. A blank run is worth
nothing either way: it would bury the runs worth reading. The file they are in is often
not a test, so it is read back for them; one git names as changed but that cannot be read
is a cannot-run, because reporting those lines as blank is a CLAIM about them and a wrong
one.

Requirements SHALL come back in capability then requirement order, and the scenarios under
each in file order. Git lists what it already tracks ahead of what it has never seen, so the
order a diff arrives in is not an order at all; a report that is read again on the next run
has to be comparable with the last one.

The terminal form SHALL say the same things as the JSON one in each of the three shapes. A
person reading a work list wants the address to fetch by; one reading a requirement is walking
their diff, so its scenarios stay in file order there.

It compares against the branch point with the BASE_BRANCH by default, so run inside a
task's worktree it answers "what did this branch touch"; `--since` names another revision. It
counts the work as it stands — the working tree and files not yet added to git, not only
what is committed — because in a worktree most of the work is uncommitted most of the time.

A change that removed a PROOF is read from the base revision and named too, so a PROMISE
left with nothing behind it is reported rather than silently missing.

It reports what it found and does not judge it. Whatever the change touched — including a
PROMISE nothing proves any more — that is not this command saying the build is wrong. What it
does hold a gate on is the reviewing, which is the requirement below. A repo it cannot read —
not a git repository, or a revision it cannot resolve — SHALL exit the cannot-run code.

<!-- scenarios: generated -->
- "A KEY no touched requirement carries cannot run" → tests/cli/touched.test.ts
- "A PROOF the change removed is named from the base revision" → tests/cli/touched.test.ts
- "A change committed since the branch left the BASE_BRANCH is counted" → tests/cli/touched.test.ts
- "A change inside a PROOF names the scenario and where its requirement is written" → tests/cli/touched.test.ts
- "A changed file that cannot be read back cannot run" → tests/cli/touched.test.ts
- "A changed run that is nothing but blank lines is not reported" → tests/cli/touched.test.ts
- "A directory that is not a git repository cannot run" → tests/cli/touched.test.ts
- "A main with no configured upstream measures from where origin stands" → tests/cli/touched.test.ts
- "A requirement no CAPABILITY_FILE declares carries no prose" → tests/cli/touched.test.ts
- "A revision given on the command line replaces the branch point" → tests/cli/touched.test.ts
- "A scenario proven inside a shared test carries every run of lines that prove it" → tests/cli/touched.test.ts
- "A test file not yet added to git is counted" → tests/cli/touched.test.ts
- "A touched scenario carries the source of the lines that prove it" → tests/cli/touched.test.ts
- "On main the default base is where main's upstream stands" → tests/cli/touched.test.ts
- "One requirement holds every scenario of it the change touched" → tests/cli/touched.test.ts
- "Requirements come back in capability then requirement order" → tests/cli/touched.test.ts
- "The lines that prove nothing are counted in the work list and asked for on their own" → tests/cli/touched.test.ts
- "The requirement a touched scenario proves carries the prose written under it" → tests/cli/touched.test.ts
- "The terminal form of one requirement says how to record either verdict" → tests/cli/touched.test.ts
- "The terminal form of the lines that prove nothing carries them" → tests/cli/touched.test.ts
- "The touched command answers with one entry for each requirement it reached" → tests/cli/touched.test.ts
- "Touched scenarios come back in file order" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: The touched command holds the gate until every PROMISE it reached has been judged

The work list SHALL exit non-zero while any PROMISE the change reached has no review standing
against it, and zero when none is left. Asking for one requirement, or for the lines that prove
nothing, SHALL exit zero however much is unjudged.

This is what lets a hook hold the gate: a branch cannot be pushed with a PROMISE on it nobody
has looked at. It is not the tool judging the change. It is the tool saying nobody has, which
is a fact about this branch's reviewing rather than about its code.

Only the work list SHALL hold it. Fetching one requirement is how a reviewer collects the work,
and an agent that read every fetch as a failed tool would stop partway through the very job the
gate exists to make it finish.

A PROMISE SHALL count as judged whatever the judgement said. The gate asks whether every
PROMISE was looked at, not whether every judgement was favourable. A reviewer who cannot report
a problem without blocking their own branch has a reason to write a pass instead, and what the
gate would then measure is their willingness to let themselves through.

<!-- scenarios: generated -->
- "A work list with a PROMISE left unjudged exits non-zero" → tests/cli/touched.test.ts
- "A work list with every PROMISE judged exits zero" → tests/cli/touched.test.ts
- "Asking for one requirement exits zero however much is unjudged" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: A changed TERM counts as a change the tests did not make

The work list SHALL count the PROMISE a changed TERM re-opened exactly as it counts the
PROMISE a changed test reached — the same shapes, the same gate — by reading where the
CAPABILITY_FILE live against the same base revision the tests are measured from.

The diff of the tests has one axis: a changed line reaches the PROOF that owns it. That
leaves a door open. Rewrite a definition and every PROMISE that uses the word changes what
it is claimed to prove, without a line of the tests moving, so no gate would ever sound. A
changed TERM is the second axis, and it feeds the same work list because it asks the same
question — has anybody looked at what this change means for the PROMISE it reached?

A requirement asked for by address SHALL carry, for each scenario a TERM re-opened, the TERM
and its definition as the base revision held it and as it stands now. The reviewer is judging
whether a CLAIM still reads its PROOF honestly under a meaning that moved, and the distance
it moved is the whole of what they were asked about.

<!-- scenarios: generated -->
- "A PROMISE both axes reached is gathered once, carrying the TERM changes with it" → tests/cli/touched-terms.test.ts
- "A PROMISE re-opened through another TERM's definition keys the definition it never names" → tests/cli/touched-terms.test.ts
- "A changed TERM's PROMISE are in the work list and hold the gate" → tests/cli/touched-terms.test.ts
- "A scenario re-opened by a TERM carries the definition it is now judged under" → tests/cli/touched-terms.test.ts
<!-- /scenarios -->

### Requirement: A changed description counts as a change the tests did not make

The work list SHALL count the PROMISE a changed description re-opened exactly as it counts
the PROMISE a changed test or a changed TERM reached — the same shapes, the same gate — by
comparing each requirement's description against the same base revision the tests are
measured from.

The description is the STANDARD every scenario under the requirement is judged against: a
reworded description is a different question being asked of every scenario, and every
judgement made under the old wording is worth taking again. Reading the change and not
re-opening would let a branch change what its PROMISE mean with the gate silent.

<!-- scenarios: generated -->
- "A PROMISE both a description change and a test change reached is gathered once" → tests/cli/touched-descriptions.test.ts
- "A description the change left byte for byte unchanged re-opens nothing" → tests/cli/touched-descriptions.test.ts
- "A reworded description's PROMISE are in the work list and hold the gate" → tests/cli/touched-descriptions.test.ts
- "A scenario re-opened by a description carries the wording then and now" → tests/cli/touched-descriptions.test.ts
<!-- /scenarios -->

### Requirement: touched measures the tests a caller gives it

A caller SHALL be able to hand the command the tests it has already read, with the roots they
live under, in place of the conventional discovery. The diff SHALL then be scoped to those
roots, so a change to a given test is measured wherever it lives.

A repo whose tests sit outside `tests/` — several roots, another suffix — cannot be walked by
the one conventional discovery, but its PROMISE are not worth less for that. The caller reads
its own tests its own way; this keeps the measuring — which PROMISE the change reached, and
whether anybody has looked — one implementation. The roots are given with the files because the
diff needs a place to look: a test file the branch deleted is not among the files, and its
removal is only visible when the diff is scoped to where tests live.

<!-- scenarios: generated -->
- "A test deleted from a given root is read back as no longer proven" → tests/cli/touched.test.ts
- "Tests given with their root are scanned and diffed where they live" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: A command records a review of one touched scenario

The CLI SHALL provide a command that records one reviewer's judgement of one PROMISE the change
reached, appending it to `.proofspec/reviews.jsonl`. A KEY naming no PROMISE the change reached
SHALL be a cannot-run, and a review that `review` turns away SHALL be a cannot-run that writes
nothing.

A verdict the tool does not know SHALL be a cannot-run, refused before anything is written.
It is a decision about a value rather than about what the options can represent, so it is the
command's to make and not the argument parser's — which is also what puts it somewhere a test
can reach.

The PROMISE is looked up rather than taken on trust because a pass has to be checked against
the lines it cites, and those lines are only in hand once the change has been read. A KEY
matching nothing is what a stale KEY looks like — the scenario moved out from under the
judgement — and filing it anyway would write a record nothing ever reads back.

The LEDGER is committed rather than ignored, unlike the coverage recording beside it. A page of
bare passes with nothing cited is visible in a pull request in a way no mechanical rule could
make it, and CI cannot hold a gate against a record that only ever existed on one machine.

<!-- scenarios: generated -->
- "A LEDGER that cannot be read cannot run" → tests/cli/review.test.ts
- "A pass citing a line outside the PROOF cannot run" → tests/cli/review.test.ts
- "A recorded review is appended to the LEDGER" → tests/cli/review.test.ts
- "A review of a PROMISE the change did not reach cannot run" → tests/cli/review.test.ts
- "A reviewed scenario is no longer pending in the work list" → tests/cli/review.test.ts
- "A verdict the tool does not know cannot run" → tests/cli/review.test.ts
<!-- /scenarios -->

### Requirement: The requirement asked for carries how its scenarios are to be judged

One requirement asked for in full SHALL carry the question its scenarios are to be judged by,
along with what to run to record either answer.

The asking is not incidental. A reviewer asked "is this CLAIM honest?" answers yes; one asked
to find where the CLAIM promises more than the PROOF asserts goes looking. Only one of those
two questions finds anything, and which one gets asked cannot be left to whoever remembers to
ask it.

<!-- scenarios: generated -->
- "The pass the protocol hands over is one the command line accepts" → tests/cli/review.test.ts
- "The requirement asked for carries how its scenarios are to be judged" → tests/cli/touched.test.ts
<!-- /scenarios -->

### Requirement: A command walks from changed source to the tests that reach it

The CLI SHALL provide a command that takes the source this branch changed, walks the call
graph backwards from the functions those lines fall in, and reports the tests that reach
them along with the requirements those tests prove.

The call graph is not ProofSpec's to build. It is read from the codebase-memory index the
repository already keeps, or from a file when one is named — which is also how a test hands
one over, since a test cannot index a repository. Being unable to read a graph SHALL be a
cannot-run: "nothing reaches this change" and "I could not look" must not read the same.

Changed tests are `touched`'s question, so this command reads everything except them. It only
reports, and exits zero whatever it finds.

<!-- scenarios: generated -->
- "A change to the tests is not on this tree" → tests/cli/impact.test.ts
- "A changed file the graph knows no function in is reported unmapped" → tests/cli/impact.test.ts
- "A changed function's tree names the tests that reach it and what they prove" → tests/cli/impact.test.ts
- "A graph that cannot be read is a cannot-run" → tests/cli/impact.test.ts
- "Whatever it reaches, the command exits zero" → tests/cli/impact.test.ts
<!-- /scenarios -->

### Requirement: A test run narrows the tree to the scenarios that ran the change

Given what a test run recorded, the command SHALL name only the scenarios that ran the
changed functions, in place of every scenario their files hold.

The call graph reaches a test file, never a scenario inside it: one file's tests usually call
the same entry point, so without a run the honest answer is every PROMISE that file proves. A
run says which of them executed the change, which is the answer a reviewer wanted. A recording
that cannot be read SHALL be a cannot-run rather than a silent fall back to the wide list —
asking for the exact answer and being given the wide one without being told is worse than
either.

<!-- scenarios: generated -->
- "A recording that cannot be read is a cannot-run" → tests/cli/impact.test.ts
- "Only the scenarios a run executed are named" → tests/cli/impact.test.ts
<!-- /scenarios -->

### Requirement: A command answers the inflight graph as JSON

The CLI SHALL provide an `inflight` command that reads the queue directory and answers the
graph this capability computes, as JSON by default, and SHALL exit its ok code whatever it
finds.

This report is read by another program — an orchestrator, in a later round — far more often
than by a person. Like `touched` and `impact`, it reports and holds no gate: a
relationship the graph found is not a build the graph is entitled to fail, and ranking one
relationship over another is exactly the judgement this capability refuses to make.

The command carries no sub-verb: it answers the one question this capability asks, and a
sub-verb parser would be built for choices the capability does not make.

<!-- scenarios: generated -->
- "The `inflight` command answers JSON by default" → tests/cli/inflight.test.ts
- "The command exits its ok code even when the graph carries problems" → tests/cli/inflight.test.ts
<!-- /scenarios -->

### Requirement: A command answers the docket, as text for a person by default

The CLI SHALL provide a `docket` command that answers the docket view — one row per TASK in
the conventional queue directory, and the relationships raised but not yet ruled — as text
by default and as JSON on request, and SHALL exit its ok code whatever it finds.

The default form follows the reader, and a person at a terminal watching several TASKs run
is this command's reader. The JSON form carries the same content.

<!-- scenarios: generated -->
- "The docket command answers as JSON on request, carrying the same content" → tests/cli/docket.test.ts
- "The docket command answers as text for a person by default" → tests/cli/docket.test.ts
- "The docket command exits its ok code whatever it finds" → tests/cli/docket.test.ts
- "The text answer carries the TASK's phase word and its round on its row" → tests/cli/docket.test.ts
<!-- /scenarios -->

### Requirement: A command serves the docket as a page

The CLI SHALL provide a way to serve the docket as a page: the `docket` command, asked to
serve, SHALL answer the page at the root and the JSON the page reads at `/docket`, and
SHALL run until stopped. The listener SHALL bind the loopback interface by default, and
the interface a caller names with `--host`. It SHALL listen by default on the port derived
from the queue root's absolute path: 4567 plus the numeric value of that path's SHA-256
digest taken modulo 1000, a number from 4567 through 5566, computed the same way every
run — so one path derives one port however it is spelled, the same rule the dedicated
server's name follows (`specs/schedule.md`). It SHALL listen on the port a caller names with `--port`. When the port a run wants
is already taken, the command SHALL fail fast, naming the port it could not get and
naming `--port` as the override, and SHALL NOT fall back to another port on its own.

Serving is a command, not a daemon: a person asks for the page the way they ask for any
other answer, and stopping it is closing the terminal it runs in. The loopback interface
is the default because the docket names this machine's queue, this machine's sessions,
and this machine's ruling debts. Naming an interface with `--host` is the caller choosing
who reads. `0.0.0.0` is the spelling that answers every interface the machine has, so the
docket can be watched from another device on the same network. The port is derived from the queue
root so two repos on one machine serve side by side with no configuration, and the same
repo keeps the same port so its URL stays stable. A collision between two repos' derived
ports fails outright and names `--port`, rather than moving a URL nobody told the browser
about.
The JSON it answers at `/docket` is the one answer the page reads, so nothing about the
page is a dialect of its own.

<!-- scenarios: generated -->
- "A named --host is the interface served on" → tests/cli/docket-serve.test.ts
- "A port a caller names is the port served on" → tests/cli/docket-serve.test.ts
- "A port already taken fails the serve fast, naming the port it could not get and --port as the override" → tests/cli/docket-serve.test.ts
- "Asked to serve, the command answers the page at / and the JSON the page reads at /docket" → tests/cli/docket-serve.test.ts
- "Serving runs until stopped, and stopping releases the port" → tests/cli/docket-serve.test.ts
- "The listener answers the loopback interface on the port derived from the queue root by default" → tests/cli/docket-serve.test.ts
- "The listener answers the loopback interface only" → tests/cli/docket-serve.test.ts
<!-- /scenarios -->

### Requirement: Every place that asks git about the BASE_BRANCH reads one name

Wherever the tools ask git about the BASE_BRANCH, they SHALL read its name from the
`PROOFSPEC_BASE_BRANCH` environment variable, taking `main` when that variable is unset.
The diff base `touched` measures a change from, the branch the inflight graph's census
measures each TASK against, the landed check a scheduling pass runs, and the landed check
`settle_task` runs SHALL all read one resolution of the name, so no two of them measure
against different branches.

The name of the branch a repo builds its work on is a fact about the repo, not about the
tool: a repo whose development branch carries another name sets the variable. Two places
that each spelled the name for themselves would ask about two different branches once the
variable is set.

<!-- scenarios: generated -->
- "A scheduling pass settles a mergeable TASK whose branch landed in the branch PROOFSPEC_BASE_BRANCH" → tests/cli/base-branch.test.ts
- "The census measures each TASK against the branch PROOFSPEC_BASE_BRANCH names" → tests/cli/base-branch.test.ts
- "The diff base touched measures from is the branch PROOFSPEC_BASE_BRANCH names" → tests/cli/base-branch.test.ts
- "Unset, every place takes main" → tests/cli/base-branch.test.ts
- "settle_task settles a TASK whose branch landed in the branch PROOFSPEC_BASE_BRANCH names" → tests/cli/base-branch.test.ts
<!-- /scenarios -->

### Requirement: Two revisions can be compared without checking either one out

The CLI SHALL provide a way to compare two named git revisions without checking either one
out: where their histories last agreed, which paths under a pathspec differ between them,
every path either one holds, and whether one is an ancestor of the other.

The inflight graph asks this of two revisions neither of which is checked out — a task's own
branch against another task's, or against the BASE_BRANCH — without disturbing whatever the caller
has checked out.

<!-- scenarios: generated -->
- "A revision the repository does not have is a refusal naming it" → tests/cli/revisions.test.ts
- "Every path either revision holds is answered" → tests/cli/revisions.test.ts
- "Where two revisions last agreed is answered without either being checked out" → tests/cli/revisions.test.ts
- "Whether one revision is an ancestor of the other is answered both ways" → tests/cli/revisions.test.ts
- "Which paths under a pathspec differ between two revisions is answered" → tests/cli/revisions.test.ts
<!-- /scenarios -->

### Requirement: A path's content at a named revision is read without checking it out

The CLI SHALL provide a way to read one path's content exactly as a named git revision holds
it, without checking that revision out, answering nothing — not a refusal — when the given
revision does not hold that path, including when the revision itself is not one the
repository has.

Several reads need the same primitive — a path's content as one revision held it — without
checking anything out.

<!-- scenarios: generated -->
- "A path a revision does not hold answers nothing, not a refusal" → tests/cli/revisions.test.ts
- "A path's content at a named revision is read as that revision holds it" → tests/cli/revisions.test.ts
<!-- /scenarios -->

### Requirement: A conventional queue directory is read one task at a time

The CLI SHALL provide a way to read a conventional queue directory — one task per
subdirectory, each holding a MANIFEST and a state file — into whatever the graph needs,
reading one TASK at a time so that one unreadable TASK answers a problem for that TASK
alone. A queue directory that does not exist SHALL answer an empty list of TASK. A queue
directory that exists but cannot be listed SHALL be a refusal naming the path.

A missing queue directory is the ordinary state between rounds, not a failure: no TASK has
been handed off yet, and the answer is the same one an empty directory would give — no TASK
in flight. A directory that exists and still cannot be listed — permissions denied, a file
sitting where a directory belongs — is a different fact about the repository, one no TASK's
absence explains, so it is refused rather than answered as empty.

A directory that lists fine but holds one unreadable TASK is a per-task problem — refusing
the whole read over one bad TASK would be the very defeat the graph's own resilience exists
to avoid.

<!-- scenarios: generated -->
- "A queue directory is read into one entry per task subdirectory" → tests/cli/queue.test.ts
- "A queue directory that does not exist answers an empty list of tasks" → tests/cli/queue.test.ts
- "A queue directory that exists but cannot be listed is a refusal naming the path" → tests/cli/queue.test.ts
- "A real in-flight TASK still needs the specs directory even when the queue is not empty" → tests/cli/inflight.test.ts
- "One unreadable task answers a problem for that task alone, the rest still read" → tests/cli/queue.test.ts
- "The command answers an empty graph in a bare repository with no specs directory at all" → tests/cli/inflight.test.ts
<!-- /scenarios -->
