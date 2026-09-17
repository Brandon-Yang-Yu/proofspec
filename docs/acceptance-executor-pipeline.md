# acceptance report — executor-pipeline

The checker ran every step of `.proofspec/dispatch/executor-pipeline/acceptance.md` for real,
on scratch state under `/tmp/acceptance-3mgs`. The production queue, worktrees, and tmux
socket were never touched; every command ran with `PROOFSPEC_TMUX_SOCKET=scratchsock`.

| Step | What ran | Result |
| --- | --- | --- |
| 1. The tool path | One-shot `pi -p --no-extensions --approve -e <worktree>/.pi/extensions/progress.ts` with `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK=phase-demo`; the session called `report_task_phase` for real | **Pass** — reply "Reported: phase `test-review`, round 2"; `phase-demo/phase` holds `{"phase":"test-review","round":2}`; `phase-demo/state` still exactly `building`; `plain/` still only `MANIFEST` + `state` |
| 2. The refusal paths | Two further one-shot calls: `env -u PROOFSPEC_TASK`, then `PROOFSPEC_TASK=never-existed` | **Pass** — first refuses naming `PROOFSPEC_TASK` as the missing variable; second refuses naming the absent queue entry; neither throws, both answered as values; after both, no `phase` under `plain/`, no `never-existed/` directory, `phase-demo/phase` unchanged |
| 3. The docket row | `docket --format json --pretty` over the scratch checkout | **Pass** — `phase-demo` carries state `building`, phase `test-review`, round `2`, branch `phase-demo`, phase age a real number (559s, not `null`); `plain` carries phase, round, and phase age all `null`; rows sorted by name; exit 0 |
| 4. The third age | `phase` aged to 3 hours, `state` to 1 hour, docket re-answered | **Pass** — `phaseAgeSeconds` 10801 beside `stateAgeSeconds` 3601: the third number is its own file's age, not a repeat of the first; `plain`'s phase age still `null`. *Checker's note:* the script's `touch -d '3 hours ago'` is a GNU spelling BSD touch rejects; the step's intent — distinct known file ages — was driven with `touch -t` and absolute stamps, and the measured facts are exactly what the step asked to see |
| 5. The served page | `docket --serve --port 4599`, `curl /docket`, `curl /`, stop | **Pass** — `docket.json` carries `phase-demo` with phase `test-review`, round `2`, phase age 10816 and `plain` with all three phase fields absent; `page.html` carries `test-review` and `round 2` as visible content in the markup outside the script |
| 6. The branch's own file facts | The four file checks | **Pass** — `.claude/skills/ship` does not exist; createworktree holds no `/ship` reference; `executor.md` holds no `ship` and names test-reviewer/planner/explorer (13 matches); `git diff --stat main -- docs/design.md .claude/skills/audit` is empty |
| 7. The green gates | `pnpm test`, `pnpm typecheck`, `pnpm spec:check` in the worktree | **Pass** — 87 files / 534 tests green; typecheck exit 0; the scenario ledger agrees (exit 0) |

All steps pass. The one deviation is the note on step 4: a portable command spelling for
the same measured fact, not a change to what the step checks.
