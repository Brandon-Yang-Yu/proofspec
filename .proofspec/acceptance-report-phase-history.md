Every step is run. The scratch server is dead; the real queue's page is left serving. Here is the report.

---

# Acceptance report — `phase-history`

Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/phase-history` · Scratch queue: `~/scratch/phase-history-accept-24864` (my own fresh dir)

## 1. The suite — **PASS**
`pnpm test` → **87 files, 571 tests, all green**. The four named proof sites run green within it; run alone they answer `4 files, 87 tests passed`: `tests/progress/extension.test.ts` (write rules), `tests/docket/view.test.ts`, `serve.test.ts`, `page.test.ts` (row history, age from `since`, page account, archive account).

## 2. spec:write → spec:check — **PASS**
`pnpm spec:write` → `nothing to write`, exit 0 (specs already agree; `git status specs/` clean — the rewritten `specs/progress.md`/`specs/docket.md` carry the `since`/`phase-history` requirements and scenario pointers). `pnpm spec:check` → **exit 0**. The one printed line (`Term MANIFEST: …`) is a standing advisory — the same line, same exit 0, on main — not drift.

## 3. Scratch queue — **PASS**
Built `four-hours`, `no-phase`, `old-shape`, `returning-word` under `<scratch>/.proofspec/dispatch/`, each with `MANIFEST` (`{"intentRef":…,"branch":"scratch/<name>","base":{"kind":"main"}}`) and `state`(`building`), phase files in the writer's exact byte shapes (`phase` = one JSON object, `phase-history` = JSONL, per `src/cli/queue.ts`). One-shot docket over it: **4 rows for 4 entries, `problems: []`**; `no-phase` carries `phase/round/phaseAgeSeconds/phaseHistory/phaseAccount` all `null` — absences as absences.

## 4. The sharpest entry — **PASS**
`four-hours`: `phase` = `test-review` round 200, `since` = now−4h; history = `implement` @−6h, then `test-review` rounds 1–200 spread over the four hours (201 lines). Files written seconds before the read; the row answered `phaseAgeSeconds: 14422` (≈4h, read from `since`, not write time), account `implement 7200s closed · test-review 14422s live, roundsReached 200`. Page spelled it `test-review round 200`, `4h 0m 51s`, `implement 2h 0m 0s`, `test-review 4h 0m 51s through round 200`.

## 5. The neighbors — **PASS**
- `no-phase`: `no phase` / `—` / `no phases` — absences as absences.
- `old-shape` (`{"phase":"implement","round":3}`, no `since`): answers **as absent** — `phase: null, round: null, phaseAgeSeconds: null`.
- `returning-word` (implement → test-review → implement): account `implement 10822s (= 7200 + 3622, two runs summed), roundsReached 2, live` then `test-review 7200s closed` — **first-standing order**, summed under the one word; page: `implement 3h 0m 51s through round 2` + `test-review 2h 0m 0s`.

## 6. The finished TASK — **PASS**
`<scratch>/.proofspec/archive/done/`: MANIFEST (mtime −3h), `state`=`merged` (mtime −2.5h, per the story; the script's `-2H` example touch is the coarser version), history implement@−3h → test-review@−2.75h. Record: `livedSeconds 1800`, account `implement 900s · test-review 899s`, **both `live: false`**, the last run ending at `settledAt`. Page's completed section shows `done` with exactly that account, nothing live.

## 7. The page against the scratch queue — **PASS**
Port 4599 was free; server ran from the scratch dir. `GET /` → 200; the served HTML answers every clause: `four-hours` with `test-review` / four hours / 200 rounds / `implement` closed at two hours; `no-phase` and `old-shape` as absences; the returning word summed under one word in first-standing order; `done` in the completed section, account closed. (Scratch server then killed by PID — 4599 released.)

## 8. The JSON the page reads — **PASS**
`curl /docket` vs one-shot `docket --format json --pretty`, parsed and compared: **rows identical — task, phase, round, full `phaseHistory` arrays, row order, `problems`, `outstanding`** (ages normalized; in fact both reads even agreed unzeroed: state 70 / phase 14470). `/archive` carries the completed record with its account.

## 9. The real queue, read-only — **PASS**
Before/after hashing of every file under `/Users/yang/Projects/proofspec/.proofspec/dispatch/` (10 files, digest `46398e6b…`): **one** file differed — `phase-history/heartbeat`. Proven not the server: (a) `src/cli/serve.ts` contains no write-side call at all (only `response.writeHead/end` and reads); (b) the heartbeat ticked (`07:32:37.236Z → 07:32:37.241Z`) in a window with **zero** requests to the server — its writer is the executor session's own progress-extension heartbeat; (c) the other 9 files — including the live TASK's `phase`, `state`, `MANIFEST`, `LEASE` — held identical hashes across ~45 requests. The page answers the real queue honestly: the live `phase-history` TASK's row reads its old-shape `phase` file (`{"phase":"acceptance-check","round":1}`, no `since`) **as absent** with no history file yet; the two MANIFEST-less entries stand as per-entry problems; the three archived TASKs show accounts absent (they predate `phase-history`). It reports, judges nothing.

## 10. The human's own eyes — **the human's own**
The real queue's page is left **serving at http://localhost:4601/** (pid 27058, auto-refresh every 2s), awaiting the human's yes. One note for the reading: no live `phase-history` stands on the real queue at this moment, so the moving-time phenomenon is not yet visible there; it was proven at the data level on the scratch queue (live phase age 14422s → 14470s across consecutive reads, closed phases fixed) and will appear on this page the moment a session reports a phase in the new shape.

---

**Verdict: steps 1–9 PASS on the evidence above; step 10 awaits the human.** Nothing for the executor to act on.
