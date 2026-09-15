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
`enqueue()` answers: on a `task` not already in the queue, a queue entry now exists — its
MANIFEST and a state of `queued` — and `enqueue_task` SHALL report that success; on a `task`
already in the queue, `enqueue_task` SHALL report `enqueue()`'s own refusal —
`{ok: false, reason: 'a TASK named <task> is already in the queue'}` — as a value, never as a
thrown error, and SHALL leave the existing entry untouched.

`enqueue_task`'s whole job on top of `enqueue()` is the validation and the flattening above;
the write outcome itself is `enqueue()`'s to decide, already proven by "enqueue creates a
queue entry once, and refuses rather than overwrite one already there" in
`specs/schedule.md`. Re-deciding, retrying, or papering over that refusal here would be a
second copy of a rule this repo already keeps in one place. A model driving this tool through
a conversation needs the collision back as an answer it can read and relay to the human, not
an exception it has to catch — the same reason every other refusal in this tool answers
`{ok: false, reason}` rather than throwing.

<!-- scenarios: generated -->
- "A TASK already in the queue is refused, naming the collision, and its existing entry is untouched" → tests/handoff/extension.test.ts
- "A TASK not already in the queue is enqueued with base {kind: 'main'} and state queued" → tests/handoff/extension.test.ts
- "A TASK not already in the queue is enqueued with the given base recorded exactly" → tests/handoff/extension.test.ts
<!-- /scenarios -->
