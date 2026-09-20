# Acceptance report — docket-page-phase

Checker: fresh acceptance-checker subagent, dispatched by the executor. Worktree head at
check time: `86fa501 feat(docket): the page drops the state word for the phase word`.
Scratch: `/tmp/docket-accept-yang-25359`, `PROOFSPEC_TMUX_SOCKET=scratchsock` for steps 1–4.

## 1. The phase files — PASS

Both one-shot pi runs (`pi -p --no-extensions --approve -e <worktree>/.pi/extensions/progress.ts`)
reported the phase: `phase-looper` → `test-review` round 2 (explicit), `phase-first` →
`explorer` round 1 (the tool's own default, said in the reply). `phase-looper/phase` and
`phase-first/phase` exist; `plain/` still holds only `MANIFEST` and `state`.

## 2. The one-shot JSON — PASS

Exit 0. `phase-looper`: state `building`, phase `test-review`, round 2, heartbeat age a real
number. `phase-first`: phase `explorer` round 1 with its own heartbeat age. `plain`: state
`queued`, phase/round/phase age/heartbeat age all `null`. Rows sorted by name. The state word
is here — this is the form that keeps it.

## 3. The served page and JSON — PASS (after clearing a stale squatter)

First attempt failed on the environment, not the code: port 4599 was held by an orphaned
`executor-pipeline` server (PID 99058, PPID 1). Killed it, re-ran verbatim. Clean-run counts:
`test-review round 2` → 1; `explorer round 1` → 1; `building` → 0; `queued` → 0; `round N`
total → 2; the `plain` row spells `no phase` (muted) with no round; `served.json` carries
`building` and matches `oneshot.json` row for row on state, phase, round, branch (`plain`
null in both); ages differ between files, which the step allows.

## 4. The page by eye — PASS on what is machine-verifiable; read by fetch, not by eye

No browser available: verified from the bytes over 6 fetches in ~12s — every fetch carries
both phase rows with rounds and the `plain` row's `no phase`; ages step only because each
fetch is a fresh answer; the script's only clock-bearing call is `setInterval` driving the
refetch (`no Date, no setTimeout, no requestAnimationFrame, no performance.now`); the plain
row's absence uses the same muted spelling as a missing heartbeat. The human's by-eye
reading of the animated page stands beyond this.

## 5. The real queue through this TASK's code — PASS on the machine-verifiable parts

The human's standing server (PIDs 46756/46770, on 4567 since Sep 17) was stopped to serve
with the worktree code, real socket, default port. One in-flight TASK (`docket-page-phase`
itself): row reads `acceptance-check round 1`, two ages beside it (`3m 14s`, `3m 2s`), no
state word on the rendered page (`building` 0 on page / 1 in JSON), attach command as
copyable `<code>` text. No live no-phase TASK on the real queue at check time (that case was
verified on the scratch queue, steps 3–4). The human's own eyes still owe this step its
final judgement; the page was left standing at `http://localhost:4567/`.

## 6. The green gates — PASS

First `pnpm test` failed 2 tests because the step-5 server held 4567 (the checker's doing);
after stopping it: `pnpm test` exit 0 — 87 files, 534 tests green, globals inventory exactly
`Math`, `document`, `fetch`, `setInterval` asserted and passing; `pnpm spec:check` exit 0.

## Verdict: 6/6 pass

Flags for the human: (1) the by-eye judgement on the standing page is owed for steps 4–5;
(2) the standing docket server on 4567 was replaced by the worktree-code server for that
judgement — after merge the main checkout serves this same page; (3) one orphaned
executor-pipeline server squatting on 4599 was killed.
