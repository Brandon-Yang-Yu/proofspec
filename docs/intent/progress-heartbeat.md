# progress-heartbeat — the extension produces the heartbeat the spec already demands

## The problem

`specs/progress.md` already declares the requirement "The extension refreshes a heartbeat
on every move the session makes" — its prose is judged and is not this TASK's to reword.
The consumer side exists and is proven: the docket reads the heartbeat file's write time
(`src/docket`, `tests/docket`). The producer side does not exist: `src/progress/extension.ts`
registers `report_task_state` and nothing else; no code in `src/progress` writes a
heartbeat.

Two consequences stand today. Every TASK on the docket answers "no heartbeat" forever,
because nothing produces the file. And the check on `main` exits 1 with one failing
finding: `progress › The extension refreshes a heartbeat on every move the session
makes: declared, but no test proves it`.

## The change

1. `src/progress/extension.ts` (or a module beside it, wherever the registerTool pattern
   reads best): refresh a `heartbeat` file in the TASK's queue entry on every observable
   move — the session/agent/model/tool events pi's own extension surface names
   (`docs/extensions.md` in `@earendil-works/pi-coding-agent`) — resolving the entry
   exactly as `report_task_state` does (`PROOFSPEC_QUEUE_ROOT` + `PROOFSPEC_TASK`, and
   nothing written when either is unset), writing a timestamp, and touching nothing else
   in the entry: `state`, `MANIFEST`, and `LEASE` stay byte for byte. The requirement's
   own prose in `specs/progress.md` is the standard — the refresh grain it pins (per
   move, not per token), the refusal shape it pins, and the files it forbids touching
   all stand as written.
2. `tests/progress/extension.test.ts`: write the tests red first, one per scenario the
   requirement states, then record them so the generated block under the requirement in
   `specs/progress.md` carries them. Only the generated block moves in that file; the
   requirement's prose stays byte for byte.

## Done means

- The check's failing finding is gone and the check exits zero. The `Term MANIFEST`
  near-form line beside it is a warning, not a failure — by the guard's own requirement
  — and still standing when this TASK merges is expected.
- A session's observable moves refresh the heartbeat in its queue entry, proven by the
  new tests; the entry's other files are untouched.
- `pnpm test` green; the docket reports this TASK mergeable.
