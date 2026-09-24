# Acceptance report — TASK `mcp-server-installed`

**Result: PASS — all 7 steps.** No findings.

## Step 1 — Build ProofSpec ✅
- **Ran:** `pnpm build` in `<wt>`
- **Saw:** exit 0 (`rm -rf dist && tsc -p tsconfig.build.json && chmod +x dist/cli/main.js`);
  `<wt>/dist/mcp/serve.js` exists as a 393-byte plain file.
- **Standard:** exits 0 and `dist/mcp/serve.js` exists — holds.

## Step 2 — Throwaway adopter, real install ✅
- **Ran:** `mktemp -d` → `<tmp>`; created `<tmp>/adopter`, `git init` + one commit; `package.json`
  name `adopter`; `npm pack --pack-destination <tmp>` in `<wt>` → `proofspec-0.1.0.tgz`;
  `npm install <tmp>/proofspec-0.1.0.tgz` in the adopter.
- **Saw:** `node_modules/proofspec/dist/mcp/serve.js` exists as a plain file (not a link; the
  package dir itself is a real dir, not a symlink); `adopter/src/mcp/` does not exist.
- **Standard:** real copy, not a link; `src/mcp/` absent — holds.

## Step 3 — Give the adopter a TASK ✅
- **Ran:** in the adopter: `git branch accept`; `git worktree add .proofspec/worktrees/accept
  accept`; queue entry `.proofspec/dispatch/accept/` with `MANIFEST`
  `{"intentRef":"INTENT","branch":"accept"}`, `state` `building`, `INTENT`. Matched ProofSpec's
  own convention by gitignoring `.proofspec/worktrees/` + `.proofspec/dispatch/`.
- **Saw:** `.proofspec/worktrees/accept` exists; `git status` in adopter clean.
- **Standard:** worktree directory exists — holds.

## Step 4 — Session start with `PROOFSPEC_EXECUTOR=claude` ✅
- **Ran:** `PROOFSPEC_EXECUTOR=claude node` driver importing `tmuxSessionCommands` from
  `<wt>/dist/cli/session.js`, task `accept`, `queueRoot=<tmp>/adopter`,
  `worktree=<tmp>/adopter/.proofspec/worktrees/accept`; read the file named by the start
  command's `-e PROOFSPEC_MCP_CONFIG=...`.
- **Saw config:** exactly one server (`proofspec`); its start is `node` with the single arg
  `<tmp>/adopter/node_modules/proofspec/dist/mcp/serve.js`. No arg names anything inside
  `.proofspec/worktrees/accept`; nothing names `src/mcp/serve.ts`.
- **Standard:** one server, naming the installed `node_modules` server, no TASK-worktree path,
  no `src/mcp/serve.ts` — holds.

## Step 5 — Start the server, ask for tools ✅
- **Ran:** spawned the server exactly as the config says (command `node`, arg the installed
  `dist/mcp/serve.js`, no env entries in config → inherited env), cwd = the TASK's worktree;
  over stdin sent `initialize` → `notifications/initialized` → `tools/list`.
- **Saw:** `initialize` answered
  `{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"proofspec","version":"0.1.0"}}`
  — no error. `tools/list` returned exactly `["enqueue_task","census_in_flight","report_task_state","report_task_phase","settle_task"]`
  — set-equal to the five required.
- **Standard:** initialize without error; exactly those five tools — holds.

## Step 6 — ProofSpec's own checkout names its own source ✅
- **Ran:** `git clone <wt> <tmp>/checkout`, checked out `mcp-server-installed`; entered TASK
  `owncheck` there (branch, worktree, queue entry); repeated step 4's call with queue root
  `<tmp>/checkout`.
- **Saw config:** start is `node --experimental-transform-types <tmp>/checkout/src/mcp/serve.ts`
  — that checkout's own source. No arg under `node_modules`; nothing inside
  `.proofspec/worktrees/owncheck`.
- **Standard:** names the checkout's own `src/mcp/serve.ts`, nothing under `node_modules`,
  nothing inside the TASK worktree — holds.

## Step 7 — Clean up ✅
- **Ran:** removed `<tmp>` (which held the adopter, the clone — hence both entered TASKs — and
  the `.tgz`, since step 2 packed into `<tmp>`); also removed the two `proofspec-session-*`
  handoff dirs `tmuxSessionCommands` wrote under the OS tmpdir.
- **Saw:** `<tmp>` gone; no `.tgz` in `<wt>`; `git status` in `<wt>` shows only the ledger
  modification this pipeline's own judge commands had already written before step 1 ran.
  Nothing this run wrote remains.
- **Standard:** `git status` in `<wt>` shows nothing this run left behind — holds.

**Verdict: the branch's acceptance is met — an installed ProofSpec's claude session gets the
built server out of `node_modules` (and it serves all five tools), while ProofSpec's own
checkout still names its TypeScript source.**
