# docket-adoption — acceptance report

Run by the executor session in this worktree, every step for real, following
`.proofspec/dispatch/docket-adoption/acceptance.md` in the main checkout, against the
README as it stands on this branch (the final guide text, commits through 0a6a5a6).
Evidence per step: the command run and what was observed.

## 1. Build and pack — PASS

`pnpm install && pnpm build && npm pack` → all exit 0; `npm pack` prints one tarball
name, `proofspec-0.1.0.tgz`, in the worktree root (verified present with `ls`).

## 2. The tarball carries the personas and the extension glue — PASS

`tar -tzf proofspec-0.1.0.tgz` → 11 paths under `package/.pi/`: the nine persona files
(acceptance-checker.md, completion-reviewer.md, executor.md, guideline-reviewer.md,
implementer.md, intent-writer.md, investigator.md, planner.md, test-reviewer.md) and
both extension glue files (`package/.pi/extensions/handoff.ts`,
`package/.pi/extensions/progress.ts`), with `package/dist/cli/main.js` present beside
them (272 files total).

## 3. Make a scratch project — PASS

`DIR=$(mktemp -d)`, `git init`, `npm init -y`, `tests/smoke.test.ts` written exactly as
the script gives it. Observed: the file exists, `specs/` does not, `git rev-parse
--is-inside-work-tree` → true.

## 4. Install the built package — PASS

`npm install <worktree>/proofspec-0.1.0.tgz` → exit 0, "found 0 vulnerabilities".
`npx proofspec --help` exits 0 and its Commands section names all nine: check, write,
render, touched, review, impact, inflight, schedule, docket.

## 5. Copy the personas and the extension glue as the guide says — PASS

The README's from-zero copy block run exactly as written: `mkdir -p .pi/agents
.pi/extensions`, the three `cp`s, `printf '.proofspec/dispatch/\n.proofspec/worktrees/\n'
>> .gitignore`, `git add .gitignore .pi package.json package-lock.json`, `git commit`.
All exit 0; the scratch `.pi/agents/` holds all nine persona files (`ls | wc -l` → 9)
and its `.pi/extensions/` holds `handoff.ts` and `progress.ts`. The guide's "Commit your
tests too, if they are not yet" was also followed.

## 6. Follow the guide's first-TASK story — PASS

The guide's step-3 block run exactly as written — `mkdir specs`, then the one-shot:

```
pi --approve -p "Queue my first TASK, named retrofit: turn this project into one
ProofSpec can run. Do the investigator's setup — a branch and worktree for the TASK,
and its INTENT doc in the queue entry — then enqueue it. The TASK's intent: create
specs/, write the Gherkin above the existing tests, and get check green. There is no
spec prose yet, so this TASK carries an INTENT doc only; there is nothing to settle at
a disposition review."
```

The session created branch `retrofit` off `main` with its worktree at
`.proofspec/worktrees/retrofit`, wrote the INTENT doc, and called `enqueue_task`.
Observed immediately after:

- `cat .proofspec/dispatch/retrofit/MANIFEST` →
  `{"intentRef":"INTENT","branch":"retrofit","base":{"kind":"main"}}`
- `cat .proofspec/dispatch/retrofit/state` → `queued`
- the INTENT file stands, opening `# retrofit — turn this project into one ProofSpec
  can run`.

The enqueue-triggered scheduling pass dispatched: the retrofit executor session ran
live on the dedicated tmux server (`tmux -L proofspec list-sessions` → `retrofit: 1
windows`), exactly as the guide's prose promises.

## 7. The docket answers the row — PASS

`npx proofspec docket` → exit 0, one row:

```
retrofit  queued  no phase  on retrofit from main  in state 22s  no phase  moved 0s ago  tmux -L proofspec attach-session -t retrofit
```

The row carries the TASK's name and its state word.

## 8. Open the served page — PASS

`npx proofspec docket --serve` in the background; `curl -s http://127.0.0.1:4567/`
returns HTML (`<!doctype html> …`) carrying the TASK's name (one `retrofit` match in
the page); `curl -s http://127.0.0.1:4567/docket` returns the JSON row with its state
word (`"task":"retrofit","state":"queued"`, plus the attach line). The server was
stopped afterwards, the executor session started for the retrofit TASK was killed, and
the scratch directory was removed once the run's evidence was captured.

## Verdict

8/8 steps pass on the README's own words, on the final guide text. An earlier run of
the same script against the pre-0a6a5a6 guide surfaced one finding — the from-zero
bootstrap wrinkle (a scheduling pass needs `specs/` to stand once the queue is
non-empty; the guide then taught `mkdir specs` only after the enqueue) — which the
guide fixed by moving `mkdir specs` ahead of the enqueue ask; this run is the re-run on
that final text, with the dispatch live and no wrinkle left to teach.
