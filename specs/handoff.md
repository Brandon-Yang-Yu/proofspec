# handoff

Wraps `enqueue()`'s already-tested queue write behind one tool call a coding agent inside
`pi` can make directly, instead of a human hand-writing a MANIFEST by hand. `enqueue(cwd,
task, manifest)` (`src/cli/queue.ts`) already creates a TASK's queue entry once and refuses
to overwrite one already there — this capability is not that write, but the one hop in front
of it: validating a TASK name is safe to touch the filesystem with at all, and turning the
flattened shape a model can produce into the exact `Manifest`/`ManifestBase` `readManifest`
(`src/inflight/manifest.ts`) already parses. `schedule`'s own charter is acting on a queue
entry already there — one triggered pass over work already dispatched; `inflight` only ever
reads a queue entry once one exists. Creating the entry in the first place, from a human's
intent spoken to an agent rather than typed into a file, is a different act, and this is
where it lives: `enqueue_task` (`src/handoff/extension.ts`), the pi extension tool this
capability builds.

### Requirement: A TASK name that is not a plain kebab-case slug is refused before the filesystem is touched

`enqueue_task` (`src/handoff/extension.ts`) SHALL validate that its `task` argument is a
plain kebab-case slug — starting with a lowercase letter, followed by lowercase letters,
digits, and hyphens, with no trailing hyphen — before calling `enqueue()`, and SHALL refuse,
naming why, on any `task` that contains `/`, contains `..`, contains whitespace, contains an
uppercase letter, or starts with a digit, without creating or writing anything under
`.proofspec/dispatch/`.

`enqueue(cwd, task, manifest)` builds its path as `join(cwd, '.proofspec', 'dispatch', task)`
with no check at all on `task` — safe until now only because nothing ever called it with a
`task` that did not already come from a trusted caller. `enqueue_task` is the first caller
where `task` arrives from a model's own text, so the shape this repo's real branch names
already follow — letter-initial, lowercase, hyphen-joined (`schedule-embedder-defaults`,
`investigation-agent`) — has to become an actual gate, run before `enqueue()`'s own `join`
ever sees the value: a `task` of `../../etc` or `foo/bar` is a path, not a TASK name, and
refusing it after a directory has already been created under it is one step too late.

<!-- scenarios: generated -->
- "A TASK name containing .. is refused before anything is written" → tests/handoff/extension.test.ts
- "A TASK name containing a slash is refused before anything is written" → tests/handoff/extension.test.ts
- "A TASK name containing a space is refused before anything is written" → tests/handoff/extension.test.ts
- "A TASK name containing an uppercase letter is refused before anything is written" → tests/handoff/extension.test.ts
- "A TASK name ending with a hyphen is refused before anything is written" → tests/handoff/extension.test.ts
- "A TASK name starting with a digit is refused before anything is written" → tests/handoff/extension.test.ts
- "A plain kebab-case slug is accepted and passed through to enqueue" → tests/handoff/extension.test.ts
<!-- /scenarios -->

### Requirement: enqueue_task flattens its input onto the exact Manifest shape readManifest parses

`enqueue_task` SHALL accept `{ task, intentRef, branch, base? }`, where a given `base` is
`{ task, reason }`, and SHALL map it onto a `Manifest` exactly as `readManifest`
(`src/inflight/manifest.ts`) already reads one: `base` omitted becomes `{ kind: 'main' }`;
`base` given becomes `{ kind: 'task', task: base.task, reason: base.reason }`.

`ManifestBase`'s two shapes already say everything a hand-off needs to say about what a TASK
was built on — the `task` shape argues why, the `main` shape needs no reason. Asking a model
to construct that discriminated union itself, tagging `kind` by hand, is asking it to know a
domain type it should not need to see; flattening `base` to the one thing a human hand-off
actually varies — which TASK, and why — and inferring the `kind` tag from whether it was
given at all is the whole of what "ergonomic" means here. No new concept is introduced: the
mapping is total and exact, not an interpretation.

<!-- scenarios: generated -->
- "A call with a base naming another TASK and a reason maps to a MANIFEST whose base is exactly {kind: 'task', task, reason}" → tests/handoff/extension.test.ts
- "A call with no base maps to a MANIFEST whose base is {kind: 'main'}" → tests/handoff/extension.test.ts
<!-- /scenarios -->

### Requirement: enqueue_task answers enqueue()'s own result faithfully, without throwing

Once its `task` has passed validation, `enqueue_task` SHALL call `enqueue(cwd, task,
manifest)` (`src/cli/queue.ts`) with the mapped `Manifest` and answer exactly what
`enqueue()` answers. On a `task` whose name neither the queue nor the archive holds, a
queue entry now exists — its MANIFEST and a state of `queued` — and `enqueue_task` SHALL
report that success. On a `task` already in the queue, `enqueue_task` SHALL report
`enqueue()`'s own refusal — `{ok: false, reason: 'a TASK named <task> is already in the
queue'}` — as a value, never as a thrown error, and SHALL leave the existing entry
untouched. On a `task` whose name an archived entry already holds, `enqueue_task` SHALL
report that refusal the same way — a value naming the archive, never a thrown error — with
the archived entry untouched.

`enqueue_task`'s whole job on top of `enqueue()` is the validation and the flattening above;
the write outcome itself is `enqueue()`'s to decide, already proven by "enqueue creates a
queue entry once, and refuses rather than overwrite one already there" in
`specs/schedule.md`, the spent-name refusal included. `enqueue_task` decides nothing
between the outcomes: it relays `enqueue()`'s answer either way. Re-deciding, retrying, or
papering over a refusal here would be a second copy of a rule this repo already keeps in
one place. A model driving this tool through a conversation needs the collision back as an
answer it can read and relay to the human, not an exception it has to catch — the same
reason every other refusal in this tool answers `{ok: false, reason}` rather than throwing.

<!-- scenarios: generated -->
- "A TASK already in the queue is refused, naming the collision, and its existing entry is untouched" → tests/handoff/extension.test.ts
- "A TASK not already in the queue is enqueued with base {kind: 'main'} and state queued" → tests/handoff/extension.test.ts
- "A TASK not already in the queue is enqueued with the given base recorded exactly" → tests/handoff/extension.test.ts
- "A TASK whose name an archived entry already holds is refused as a value naming the archive, with the archived entry untouched" → tests/handoff/extension.test.ts
<!-- /scenarios -->

### Requirement: census_in_flight answers the queue's census for the repo it runs in, writing nothing

`census_in_flight` (`src/handoff/extension.ts`) SHALL read the calling repo's own queue
directory and committed specs and answer the census `inflight` computes — every requirement
and TERM each in-flight TASK's branch has rewritten, relative to its own base — without
creating, deleting, or overwriting anything on disk. A queue directory that exists but cannot
be listed SHALL be reported as a value naming why, never thrown as an error; a TASK the census
itself could not read carries its own named problem exactly as `inflight` already reports it,
and every other TASK's census still answers.

`enqueue_task` is the one hop in front of a write the investigation agent cannot make by
hand-writing files; `census_in_flight` is the one hop in front of a read it cannot make by
walking every in-flight TASK's own worktree itself. The investigator's own census only ever
sees the working tree it is standing in — whatever the BASE_BRANCH looked like when that
worktree was cut — so a requirement another in-flight TASK is rewriting on a branch not
yet merged stays invisible to it until this tool asks git on the agent's behalf. Answering
rather than throwing is the same reason every one of `enqueue_task`'s own refusals is a value:
a model driving this tool through a conversation needs an unreadable repo back as something
it can read and relay to the human, not an exception it has to catch.

<!-- scenarios: generated -->
- "A queue entry naming a branch that does not exist is a named problem, not a thrown error" → tests/handoff/census.test.ts
- "An empty queue answers no TASK, rather than a refusal" → tests/handoff/census.test.ts
- "An in-flight TASK's rewritten requirement is answered, naming the TASK and its branch" → tests/handoff/census.test.ts
- "Nothing on disk is created, changed, or removed" → tests/handoff/census.test.ts
<!-- /scenarios -->

### Requirement: A successful enqueue immediately triggers a scheduling pass

Once `enqueue()` reports a TASK newly queued, `enqueue_task` (`src/handoff/extension.ts`) SHALL
run one scheduling pass over the queue — the same `schedule` (`src/cli/run.ts`) a human would
otherwise have to run by hand — using the same real `startSession`/`judge`/`notifyHuman`
actions the bare CLI supplies (`tmuxStartSession`, `piJudge()`, `stderrNotifyHuman()`), before
`enqueue_task` returns its own result. A refusal to enqueue — the `task` name failed
validation, or a TASK of that name already exists — SHALL NOT trigger a pass at all: nothing
new entered the queue, so there is nothing for a pass to react to.

`specs/schedule.md` already requires that "a scheduling pass is triggered by events... a TASK
enqueued... and SHALL NOT run inside a resident process or on a timer" — the domain rule has
stood since the scheduling capability landed, but nothing has ever called `schedule()` when that event actually happens.
Today a human hands a TASK to `enqueue_task` and then has to separately remember to run
`proofspec schedule` for anything to happen; investigator only owns intent and hand-off, and
the human's own attention is the one thing this whole pipeline exists to spend on judgment,
not on remembering to press a button. Running the pass from inside `enqueue_task` itself,
synchronously, before it answers, closes that gap without inventing a new triggering mechanism
— `enqueue_task` already is the one moment code runs exactly when a TASK enters the queue.

The triggered pass's own outcome SHALL be carried alongside `enqueue_task`'s result, never in
place of it: a TASK that is genuinely now queued stays reported as queued even if the pass
that followed found nothing ready, raised a relationship, or could not run at all (no judge or
startSession action wired, an unreadable queue) — a hiccup in the pass that happened to run
next is not a fact about whether the enqueue itself succeeded, and conflating the two would
make a human debug a write that worked by reading a report about something else that didn't.

A merge landing on `main` is the other event `specs/schedule.md` names — that half is ops
glue, not domain logic, and belongs beside `.githooks/post-commit` (which already runs an
unrelated command on its own event with nothing of its own to test): a `post-merge` hook that
shells out to `pnpm proofspec schedule` on a merge into `main`. It is part of this TASK's
intent but carries no requirement or scenario here, the same reason `post-commit` carries none.

<!-- scenarios: generated -->
- "A TASK stays reported as queued even when the pass that followed it could not run" → tests/handoff/extension.test.ts
- "A refusal to enqueue never triggers a scheduling pass" → tests/handoff/extension.test.ts
- "A successful enqueue immediately triggers a scheduling pass" → tests/handoff/extension.test.ts
<!-- /scenarios -->
