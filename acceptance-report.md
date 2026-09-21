# TASK fix-dist-deployability — acceptance checker report

All five steps executed for real in the worktree
`/Users/yang/Projects/proofspec/.proofspec/worktrees/fix-dist-deployability`
(branch `fix-dist-deployability`, clean tree, HEAD `2b12f43`).

## Report — TASK fix-dist-deployability: **PASS (5/5)**

### Step 1 — `pnpm build` + executable bit — ✅ PASS
> *Script: "Run `pnpm build`. Standard: the command exits 0, and `ls -l dist/cli/main.js` shows the executable bit — a mode line like `-rwxr-xr-x`, not `-rw-r--r--`."*

**Executed:** `rm -rf dist && pnpm build` — I removed the pre-existing `dist` first so the mode could not come from a stale artifact.
**Evidence:** the build ran `tsc -p tsconfig.build.json && chmod +x dist/cli/main.js`, exited 0. `ls -l dist/cli/main.js` → `-rwxr-xr-x  1 yang  staff  13934 Sep 21 16:44 dist/cli/main.js`; `head -1` → `#!/usr/bin/env node`. Fresh file (mtime advanced past the pre-run 16:43), executable bit set.

### Step 2 — the CLI as a command (execve) — ✅ PASS
> *Script: "Run `proofspec --help` as a command — the `~/.local/bin/proofspec` symlink itself… Standard: the help text prints and the exit code is 0."*

**Executed as amended for the pre-merge gate:** `./dist/cli/main.js --help` — bash execve'd the built file directly, the same OS mechanism the symlink uses when invoked as `proofspec`; **not** run via `node`. The post-merge `proofspec --help` run in the main checkout remains the executor's final act after merge.
**Evidence:** the full proofspec help text printed (all commands check/write/render/touched/review/impact/inflight/schedule/docket, all options), `EXIT=0`. A non-executable file at this step fails at execve with Permission denied — it did not.

### Step 3 — load `progress.ts` — ✅ PASS
> *Script: "From the repository root, run `node --experimental-transform-types -e "import('./.pi/extensions/progress.ts').then(() => console.log('loaded'))"`. Standard: it prints `loaded` and exits 0."*

**Executed:** verbatim, from the worktree root (the branch's repository root).
**Evidence:** printed `loaded`, exited 0. stderr carried only Node's expected `ExperimentalWarning: Transform Types` notice.

### Step 4 — `pnpm test` — ✅ PASS
> *Script: "Run `pnpm test`. Standard: the run exits 0."*

**Executed:** `pnpm test` (vitest run).
**Evidence:** `Test Files  88 passed (88)`, `Tests  549 passed (549)`, `EXIT=0`. One stderr line (`judge: could not run pi: pi did not answer within 300ms`) comes from a test of the pi-unavailable path; the run itself exited 0.

### Step 5 — `pnpm typecheck` — ✅ PASS
> *Script: "Run `pnpm typecheck`. Standard: the run exits 0."*

**Executed:** `pnpm typecheck`.
**Evidence:** ran `tsc -p tsconfig.json` with no diagnostics, `EXIT=0`.

## Verdict

All five standards met against the branch's code. No code, script, or merge was touched by
this check. The one item outside my gate, as agreed: the executor's post-merge
`proofspec --help` symlink run in the main checkout on `main`.
