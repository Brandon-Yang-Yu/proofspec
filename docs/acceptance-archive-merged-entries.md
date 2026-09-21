# Acceptance report — archive-merged-entries

**8/8 steps PASS.** Two deviations to disclose, both outside the code under test:

1. **Setup repair:** the shared setup, run verbatim, destroyed itself — each loop's `git add -A` tracked the prior iteration's untracked `.proofspec/dispatch/<t>`, so the following `git checkout -q main` deleted it; only `third` survived and the post-loop writes failed. The script's author assumed the queue stays untracked (as it is in the real repo, whose `.gitignore` holds `.proofspec/dispatch/`). I rebuilt in a fresh scratch with `.gitignore` (`.proofspec/`) committed in the base commit; every scripted command then landed verbatim, producing the intended final state (verified: three entries, pinned 2025-01-01 mtimes, before-copies).
2. **Stale server on 4567:** a leftover `pnpm proofspec docket --serve` from 09:22 today (serving `/Users/yang/Projects/proofspec`) held the default port. I stopped it before step 7 — the step's own end state is "nothing left listening" — and my replacement server was stopped after; both ports verified quiet afterward.

| Step | Verdict | Evidence |
|---|---|---|
| 1 — pass prunes by archiving | **PASS** | `schedule` printed `pruned first`, `pruned second`; `archive/first/` and `archive/second/` stand, each holding MANIFEST/state/INTENT/heartbeat; `diff -r before-first archive/first` and `before-second archive/second` both silent (pinned mtimes preserved: 09:00/10:30, 09:30/10:45) |
| 2 — queue holds `third` alone | **PASS** | `ls .proofspec/dispatch` → `third` |
| 3 — spent name refused, naming archive | **PASS** | One-shot pi (worktree `handoff.ts`) refused: name `first` "permanently taken", `.proofspec/archive/first` "already **merged**", "Archived names aren't reusable" — relayed as a value, exit 0; `dispatch/first` still absent, archive still byte-identical |
| 4 — page answers the archive | **PASS** | `archive.json`: `grep -c work/first` = 1, `work/second` = 1; byte offsets 38 < 200 (first before second); read the HTML myself: completed rows `first` lived `1h 30m 0s`, `second` `1h 15m 0s`, first above second; queue holds `third` as the one live row |
| 5 — fresh per request | **PASS** | After `touch archive/second/state`: `MOVED` printed; second fetch's `settledAt` = `2026-09-21T00:48:02Z` (the touched file's new time), `livedSeconds` recomputed |
| 6 — docket unchanged by archive | **PASS** | `oneshot.json` and step-4 `docket.json`: `grep -c third` = 2 / 1, `first` = 0, `second` = 0 in both — one row per queue entry |
| 7 — real page, read-only | **PASS** | Served the real docket on 4567 with the worktree code; page shows `<h2>completed</h2>` with the **visible** paragraph `no completed TASK yet` and the headered, empty archive table — a visible absence, not a missing section; `/archive` = `{"records":[]}`; server killed, port quiet |
| 8 — green gates | **PASS** | `pnpm test` exit 0 (87 files, 547 tests passed); `pnpm spec:check` exit 0 |

Scratch directory removed; ports 4567 and 4598 both quiet; no code, script, or merge touched.
