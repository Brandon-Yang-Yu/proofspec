# docket-adoption — acceptance report

Run by the executor session in this worktree, every step for real, following
`.proofspec/dispatch/docket-adoption/acceptance.md` in the main checkout. Evidence per
step: the command run and what was observed.

## 1. Build and pack — PASS

`pnpm install && pnpm build && npm pack` → all exit 0; `npm pack` prints one tarball
name, `proofspec-0.1.0.tgz`, in the worktree root (verified present with `ls`).

## 2. The tarball carries the personas and the extension glue — PASS

`tar -tzf proofspec-0.1.0.tgz` lists, among 272 files:

```
package/.pi/agents/acceptance-checker.md
package/.pi/agents/completion-reviewer.md
package/.pi/agents/executor.md
package/.pi/agents/guideline-reviewer.md
package/.pi/agents/implementer.md
package/.pi/agents/intent-writer.md
package/.pi/agents/investigator.md
package/.pi/agents/planner.md
package/.pi/agents/test-reviewer.md
package/.pi/extensions/handoff.ts
package/.pi/extensions/progress.ts
package/dist/cli/main.js
```

All nine personas, both glue files, beside `package/dist/cli/main.js`.

## 3. Make a scratch project — PASS

`DIR=$(mktemp -d)`, `git init`, `npm init -y`, `tests/smoke.test.ts` written exactly as
the script gives it. Observed: the file exists, `specs/` does not, `git rev-parse
--is-inside-work-tree` → true (branch `main`, no commits yet).

## 4. Install the built package — PASS

`npm install <worktree>/proofspec-0.1.0.tgz` → exit 0, "found 0 vulnerabilities".
`npx proofspec --help` prints the usage naming `check write render touched review impact
inflight schedule docket`.

## 5. Copy the personas and the extension glue as the guide says — PASS

The README's from-zero copy block was run exactly as written (`mkdir -p`, three `cp`s,
`echo ".proofspec/" >> .gitignore`, `git add`, `git commit`). All exit 0; the scratch
`.pi/agents/` holds all nine persona files and its `.pi/extensions/` holds `handoff.ts`
and `progress.ts`. (The guide's "Commit your tests too, if they are not yet" was also
followed — `git add tests && git commit`.)

## 6. Follow the guide's first-TASK story — PASS

The guide's step-3 command was run verbatim:

```
pi --approve -p "Queue my first TASK, named retrofit: turn this project into one
ProofSpec can run. Do the investigator's setup — a branch and worktree for the TASK,
and its INTENT doc in the queue entry — then enqueue it. The TASK's intent: create
specs/, write the Gherkin above the existing tests, and get check green. There is no
spec prose yet, so this TASK carries an INTENT doc only; there is nothing to settle at
a disposition review."
```

The session created branch `retrofit` (+ its worktree at `.proofspec/worktrees/retrofit`),
wrote `.proofspec/dispatch/retrofit/INTENT` (an intent doc for the retrofit), and called
`enqueue_task`. Observed afterwards:

- `cat .proofspec/dispatch/retrofit/MANIFEST` →
  `{"intentRef":"INTENT","branch":"retrofit","base":{"kind":"main"}}`
- `cat .proofspec/dispatch/retrofit/state` → `queued`
- the INTENT file stands, opening `# retrofit — turn this project into one ProofSpec
  can run`.

**Finding from the run:** the scheduling pass the enqueue triggered answered
`cannot-run: specs could not be read` — `gatherQueue` tolerates a missing `specs/` only
while the queue is empty, and the from-zero project has none yet. The enqueue itself and
the entry are unaffected (this step's standard is met); but no pass could dispatch the
retrofit TASK until `specs/` exists, and creating it is the TASK's own work. Verified
directly: after `mkdir specs`, `npx proofspec schedule` → `started retrofit`, exit 0, and
the executor session ran live on the dedicated tmux server. The README now names this
bootstrap wrinkle and its one-command unblock (commit e954ee2).

## 7. The docket answers the row — PASS

`npx proofspec docket` → exit 0, one row:

```
retrofit  building  no phase  on retrofit from main  in state 13s  no phase  moved 0s ago  tmux -L proofspec attach-session -t retrofit
```

The row carries the TASK's name and its state word.

## 8. Open the served page — PASS

`npx proofspec docket --serve` in the background; `curl -s http://127.0.0.1:4567/`
returns HTML (`<!doctype html> … <title>Docket</title>`) carrying the TASK's name
(`retrofit` appears in the page); `curl -s http://127.0.0.1:4567/docket` returns the
JSON row with its state word (`"task":"retrofit","state":"building"`, plus the attach
line). The server was stopped afterwards (`pkill`), and the executor session started for
the retrofit TASK was killed and the scratch directory removed once the run's evidence
was captured.

## Verdict

8/8 steps pass on the README's own words. One doc-honesty finding surfaced during the
run (the bootstrap wrinkle) and was fixed in the README before this report.
