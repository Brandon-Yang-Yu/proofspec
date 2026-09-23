# inflight

Reads a MANIFEST left behind by an investigation agent's hand-off, and computes how the
in-flight TASK working this repository right now relate to one another through the
CAPABILITY_FILE and TERM their branches touch. It holds no queue and dispatches nothing:
this capability answers a question about work already in flight, and deciding what to do
with the answer belongs to something else.

`cli` lists the conventional queue directory and hands each TASK's MANIFEST and state file
over, one TASK at a time; this capability decides what a TASK's own state means, where its
own history begins, and what it shares with its neighbours.

### Requirement: A MANIFEST that cannot stand is refused, naming why

Reading a MANIFEST SHALL refuse it, naming why, when its JSON does not parse, when a
required field is missing, when its `base` names a `kind` that is neither `main` nor `task`,
or when a `base` of kind `task` is missing its `task` or its `reason`.

A hand-off nobody can trust is worse than none. A MANIFEST silently dropped would leave a
TASK invisible to the graph; one silently accepted half-shaped would leave it present under
a shape nothing checked. Refusing before anything is built from it turns a bad hand-off into
a problem naming its own cause, rather than a graph quietly wrong in a way nobody asked it
to explain.

<!-- scenarios: generated -->
- "A MANIFEST missing a required field is refused, naming the field" → tests/inflight/manifest.test.ts
- "A MANIFEST whose JSON does not parse is refused, naming why" → tests/inflight/manifest.test.ts
- "A `base` of a kind that is neither `main` nor `task` is refused" → tests/inflight/manifest.test.ts
- "A `base` of kind `task` missing its `task` or its `reason` is refused" → tests/inflight/manifest.test.ts
<!-- /scenarios -->

### Requirement: A TASK's state is read literally

Reading a TASK's state SHALL treat the literal word `merged` as merged and every other word,
including one never seen before, as still in flight.

A future state word this capability has never met is exactly the case a silent default
would get wrong. Reading anything but the one word it already knows as merged would let a
TASK vanish from the graph the day someone invents a new word for it. Treating the unknown
as in flight is the direction that fails safe: a TASK wrongly kept in view costs a reader a
moment's confusion, a TASK wrongly dropped costs the graph its whole purpose.

<!-- scenarios: generated -->
- "A state word never seen before is read as still in flight" → tests/inflight/state.test.ts
- "The literal word `merged` is read as merged" → tests/inflight/state.test.ts
<!-- /scenarios -->

### Requirement: The graph reads each in-flight TASK from its own base

Computing the graph SHALL read each in-flight TASK's edges relative to the merge-base of
its own branch with the branch of the TASK its `base` names, when that `base` is of kind
`task` and the named TASK is itself in flight, and with the BASE_BRANCH otherwise. A TASK
whose own state has reached merged SHALL NOT be read into the graph at all.

A `base` without a live ancestor is not one case but two — a `base` of kind `main`, and a
`base` of kind `task` naming a TASK that has since merged — and both mean the same thing:
the work behind that name is now in the BASE_BRANCH. Both measure against the BASE_BRANCH,
and measuring against the old branch instead would double-count what the BASE_BRANCH
already holds. A TASK already merged has nothing left to place on a graph of what is
still in flight; it is not a TASK with an empty answer, it is not asked.

<!-- scenarios: generated -->
- "A TASK based on a merged TASK measures against the BASE_BRANCH even though its own branch was" → tests/inflight/end-to-end.test.ts
- "A TASK whose `base` is of the `main` shape is read from its merge-base with the BASE_BRANCH" → tests/inflight/bases.test.ts
- "A TASK whose `base` names a TASK not present in the queue at all carries an" → tests/inflight/bases.test.ts
- "A TASK whose `base` names a TASK that has merged is read from the BASE_BRANCH instead" → tests/inflight/bases.test.ts
- "A TASK whose `base` names an in-flight TASK is read from its merge-base with that branch" → tests/inflight/bases.test.ts
- "A TASK whose own state has reached merged is not read into the graph at all" → tests/inflight/bases.test.ts
<!-- /scenarios -->

### Requirement: The census names every requirement and TERM a TASK's branch rewrote, relative to its own base

Computing the census SHALL name, for each in-flight TASK and relative to the same base its
edges are measured from, every requirement and every TERM its branch rewrote: reworded when
both ends define it but not the same way, carrying the prose before and after; new when only
its branch defines it, carrying only the prose after; gone when only its base defined it,
carrying only the prose before. A requirement or TERM whose prose reads the same at both ends
SHALL be absent from the census entirely. A TASK whose MANIFEST or branch cannot be read
SHALL instead carry a named problem for that TASK alone, and every other TASK's census SHALL
still be answered.

The graph's own writes edge already says a TASK touched a CAPABILITY_FILE or a TERM; the
census answers the question a same-branch overlap actually turns on — what changed there —
at the grain two rewrites collide at, one requirement's own heading and description, one
TERM's own definition, never the whole file two unrelated rewrites might both sit in.
Carrying the prose as it stands, not only the fact that a row moved, is what a TASK's own
census of its working tree cannot give a reader by itself: that census only ever sees `main`
as of when its worktree was cut, so a requirement another in-flight TASK is rewriting right
now, on a branch not yet merged, is invisible to it until this capability reads that branch
directly.

There is no arm for a row that did not move, the same reason `changedTerms`
(`src/glossary/change.ts`) — which this reuses for the TERM half — carries none: a row
nobody has rewritten is not part of what a TASK's branch has to answer for. A TASK whose
branch or MANIFEST cannot be read is a problem for its own census alone, never a reason to
refuse every other TASK's — the same asymmetry "A conventional queue directory is read one
task at a time" in `specs/cli.md` draws between a directory that cannot be listed and one
task inside it that cannot be read, and the one "A TASK that cannot be read carries a
problem, and the rest of the graph still answers" already keeps for the graph itself.

<!-- scenarios: generated -->
- "A TASK whose own census could not be read is a named problem, and every other TASK still answers" → tests/inflight/census.test.ts
- "A requirement neither end moved is absent from the census entirely" → tests/inflight/census.test.ts
- "A requirement the branch added is answered as new, carrying only the after text" → tests/inflight/census.test.ts
- "A requirement the branch removed is answered as gone, carrying only the before text" → tests/inflight/census.test.ts
- "A rewritten TERM is answered beside that file's rewritten requirements" → tests/inflight/census.test.ts
- "A rewritten requirement's description is answered as reworded, carrying both texts" → tests/inflight/census.test.ts
<!-- /scenarios -->

### Requirement: The graph reports a writes edge for every CAPABILITY_FILE and TERM a TASK's branch changed

Relative to its base, the graph SHALL report a writes edge from a TASK to every
CAPABILITY_FILE its branch edited and to every TERM whose definition changed.

A TASK's own writes are the ground truth everything else in the graph is compared against:
the reopened edges the next requirement computes, and the shared nodes a relationship is
built from, both start from what a TASK actually wrote.

<!-- scenarios: generated -->
- "A writes edge is reported for every CAPABILITY_FILE the branch edited" → tests/inflight/graph.test.ts
- "A writes edge is reported for every TERM whose definition the branch changed" → tests/inflight/graph.test.ts
<!-- /scenarios -->

### Requirement: The graph reports a reopened edge to every other CAPABILITY_FILE a changed TERM reaches

Relative to its base, the graph SHALL report a reopened edge from a TASK to every
CAPABILITY_FILE its own branch did not edit that homes a requirement whose heading or
description uses a TERM the TASK changed, directly or through another TERM's own
definition. A CAPABILITY_FILE that is both edited and reopened SHALL carry only the writes
edge.

The CAPABILITY_FILE is the unit on purpose: two different requirements in one file can
still genuinely collide, and a TERM definition sitting in the same file collides no less,
since a review reads the whole file's diff and a merge gate holds the file rather than the
requirement or the term, so this deliberately does not go finer than the file. Folding a
reopened edge into a writes edge on the same file loses nothing worth keeping: a TASK
already editing that file is already going to have it reviewed, and a second edge saying so
again would only be noise. Only a CAPABILITY_FILE and a TERM feed either edge.

A CAPABILITY_FILE that homes a TERM defined in terms of a changed one is not a case this
requirement can reach: every TERM now lives in the glossary, so a TASK that changed a TERM
has already edited the one file that homes any of them, and the fold above turns that into
a writes edge before a reopened edge could ever be asked for. Writing that clause anyway
would put a promise in the spec no scenario could prove.

<!-- scenarios: generated -->
- "A CAPABILITY_FILE both edited and reopened carries only the writes edge" → tests/inflight/graph.test.ts
- "A changed TERM in a real glossary file reopens a real CAPABILITY_FILE that uses it" → tests/inflight/end-to-end.test.ts
- "A reopened edge reaches a CAPABILITY_FILE whose requirement words use a TERM that is" → tests/inflight/graph.test.ts
- "A reopened edge reaches a CAPABILITY_FILE whose requirement words use a changed TERM" → tests/inflight/graph.test.ts
<!-- /scenarios -->

### Requirement: A basedOn edge holds only when the ancestry it claims is real

The graph SHALL draw a TASK-to-TASK edge carrying the reason a TASK's `base` argues, when
that `base` is of kind `task`, only when the named TASK's branch is truly an ancestor of
this TASK's branch. When it is not, the graph SHALL draw no such edge and SHALL instead
report a problem naming the TASK and the claim that did not hold.

A `base` of kind `task` is a human's word for why a worktree was built where it was, not a
git fact — ancestry can be checked, intent cannot, and by the time anyone reads a stale claim
back the person who made the call is usually gone. Verifying it is what keeps a rebased-away
claim from silently explaining an overlap it no longer explains. A `basedOn` edge holds
neither TASK back from anything, so accepting a real one costs nothing, but believing a
false one would.

<!-- scenarios: generated -->
- "A basedOn claim naming a TASK absent from the queue is reported as unresolved end to end" → tests/inflight/end-to-end.test.ts
- "A basedOn claim verified false through real git reports the problem, not the edge" → tests/inflight/end-to-end.test.ts
- "A basedOn claim verified true through real git draws the edge" → tests/inflight/end-to-end.test.ts
- "A basedOn edge carrying its reason is drawn when the claimed ancestry is real" → tests/inflight/graph.test.ts
- "A claimed ancestry that does not hold draws no edge and reports a problem naming the claim" → tests/inflight/graph.test.ts
<!-- /scenarios -->

### Requirement: A relationship is a shared CAPABILITY_FILE or TERM with no basedOn edge already explaining it

The graph SHALL report a relationship for a CAPABILITY_FILE or TERM that two or more
in-flight TASK are attached to and no verified `basedOn` edge connects, naming every TASK
attached to it once, not as separate pairs. A node where a verified `basedOn` edge connects
every TASK attached to it SHALL NOT be reported. The glossary's own CAPABILITY_FILE SHALL
NOT itself be reported as a shared node.

Two tasks a `basedOn` edge already connects sharing a node is not a surprise — that overlap
is exactly what the edge argues, so reporting it again would just repeat an explanation the
reader already has. A node three or more tasks share is one relationship, not several
pairwise ones: the reader needs to see who else is standing on the same ground, and naming
them separately would make one fact look like many.

The glossary is the one CAPABILITY_FILE every TERM change writes, so without this exception
two tasks that touched two unrelated TERM would always relate through it: sharing that file
is a fact about the format, not about the tasks' work. A TERM node still carries the real
signal, exactly when the same TERM is touched — the exception reaches the file that merely
houses every TERM, never the word itself.

<!-- scenarios: generated -->
- "A node a verified basedOn edge already explains is not reported" → tests/inflight/graph.test.ts
- "A node three TASK share is named once, not as three pairs" → tests/inflight/graph.test.ts
- "A node two in-flight TASK are attached to is one relationship naming both" → tests/inflight/graph.test.ts
- "Two TASK that both changed only unrelated TERM do not relate on the glossary file alone" → tests/inflight/graph.test.ts
<!-- /scenarios -->

### Requirement: The graph only reports

The graph SHALL NOT order tasks, hold any TASK, rank one relationship over another, or
recommend anything about a relationship it finds.

Deciding what to do about a relationship needs the intent behind each TASK's work, which
this capability never reads — the MANIFEST names where that intent is written, it does not
carry it. That judgement belongs to whatever later reads this graph with the intent in
hand, an orchestrator this round does not build.

<!-- scenarios: generated -->
- "Computing the graph writes nothing to the queue directory" → tests/inflight/end-to-end.test.ts
- "The answer carries no order, no hold, no rank, and no recommendation" → tests/inflight/invariants.test.ts
<!-- /scenarios -->

### Requirement: A TASK that cannot be read carries a problem, and the rest of the graph still answers

A TASK whose MANIFEST or branch cannot be read SHALL be reported on the answer as a problem
naming that TASK and why it could not be read, and SHALL NOT instead be reported as a TASK
that relates to nothing. Every other TASK's edges, and every relationship that does not
depend on the one that failed, SHALL still be reported.

A graph that refused entirely because one of several tasks has a stale branch would defeat
its own purpose. Most tasks are readable most of the time, and the one that is not is
exactly the one a person needs pointed out, not hidden behind a refusal of everything else.

Pointing it out is the promise, not a courtesy beside it. The command answers with its ok
code whatever it finds, so the exit code says nothing here, and the answer is the only place
a reader is told. A TASK quietly dropped, or left in the graph with no edges and no
relationship, reads exactly like a TASK that overlaps nobody — the one wrong answer this
capability exists to avoid, and the one a reader has no way to catch from outside. So the
answer says it: this TASK could not be read, and here is why.

<!-- scenarios: generated -->
- "A TASK that cannot be read is not reported as a TASK that relates to nothing" → tests/inflight/invariants.test.ts
- "A TASK whose branch cannot be read carries a problem, on the answer, naming the TASK and why" → tests/inflight/invariants.test.ts
- "Every other TASK's edges are still reported when one TASK cannot be read" → tests/inflight/invariants.test.ts
<!-- /scenarios -->

### Requirement: The graph is computed fresh from git on every run

Computing the graph SHALL read nothing but git and the queue directory at the moment it is
asked, store no prior graph anywhere, and answer identically, in the same order, on two runs
over an unmoved repository.

A cached or stored graph is a second copy of a fact git already holds, and a second copy is
exactly what goes stale — the same argument that keeps a scenario's position computed rather
than written down. Nothing here changes fast enough to need caching, and a stored answer
would be one more file a run could disagree with the moment a task's branch moved.

<!-- scenarios: generated -->
- "Two runs over an unmoved repository answer identically, in the same order" → tests/inflight/end-to-end.test.ts
<!-- /scenarios -->
