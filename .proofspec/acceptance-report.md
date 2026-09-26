# Acceptance report: `provider-error-fallback`

- Script: `/Users/yang/Projects/proofspec/.proofspec/dispatch/provider-error-fallback/acceptance.md`
- Worktree: `/Users/yang/Projects/proofspec/.proofspec/worktrees/provider-error-fallback`, branch `provider-error-fallback`, HEAD `486f27d`
- Run root: `S=/var/folders/2m/j_0y5q4s60lftkxw1l1xhhl80000gn/T/tmp.yQq8PrQ1JB`, tmux socket `pef-accept-81030`
- Tools: pi 0.86.1, Claude Code 2.1.283, tmux, node, pnpm 11.13.1

**Verdict: all 11 steps PASS.** One setup incident on the first try of steps 4-5 is recorded below. It was my fault, but it also shows a robustness gap.

| # | Step | Result |
|---|------|--------|
| 1 | Throwaway queue root with two entries | PASS |
| 2 | Stub provider on 127.0.0.1:18429 | PASS |
| 3 | Harnesses pointed at the stub, throwaway tmux | PASS |
| 4 | `scratch-fallback` starts in `pi` | PASS |
| 5 | `pi` fails over to `claude` | PASS (second attempt, see note) |
| 6 | Claude hook wiring in the worktree | PASS |
| 7 | `claude` parks the TASK | PASS |
| 8 | Hand restart keeps `claude` | PASS |
| 9 | Control TASK stays in `pi`, untouched | PASS |
| 10 | Gates | PASS |
| 11 | Teardown | PASS |

## 1. Build the throwaway queue root: PASS
- `git clone` of the worktree into `$S/queue`, which landed at `486f27d`. `pnpm install` finished ("Done in 1.7s"). Created the branches `scratch/fallback` and `scratch/control`.
- Entries:
  - `scratch-fallback/MANIFEST` holds `{"intentRef":"INTENT","branch":"scratch/fallback"}`
  - `scratch-control/MANIFEST` holds `{"intentRef":"INTENT","branch":"scratch/control"}`
  - Both `INTENT` files hold `Scratch TASK. Reply with one word and stop.`
  - `state` holds `building` or `queued`.
  - Neither entry has an `executor` file.
- Note: I first wrote the state files with a trailing newline (`building\n`). See step 5. I rewrote both files as the bare words (`od -c` shows `b u i l d i n g` and `q u e u e d`, with no `\n`) before the run that counts.

## 2. Start the stub provider: PASS
- `$S/stub.mjs` answers 429 with the given JSON body and appends one line per request to `$S/stub.log`. It runs in the background.
- `curl ... http://127.0.0.1:18429/` prints `429`.

## 3. Point the harnesses at the stub: PASS
- `$S/pi-agent/models.json` defines provider `stub`: baseUrl `http://127.0.0.1:18429/v1`, api `openai-completions`, apiKey `stub`, model `stub-model`.
- `settings.json` holds `{"defaultProvider":"stub","defaultModel":"stub-model"}`.
- Exported `PI_CODING_AGENT_DIR`, `ANTHROPIC_BASE_URL`, `SOCK=pef-accept-81030` and `PROOFSPEC_TMUX_SOCKET`, and unset `PROOFSPEC_EXECUTOR`. `ANTHROPIC_API_KEY` was not needed: claude went to the stub while logged in.
- Observation, not a failure: the tmux server's global environment also picked up `PROOFSPEC_TASK`, `PROOFSPEC_QUEUE_ROOT=/Users/yang/Projects/proofspec` and `PROOFSPEC_MCP_CONFIG` from my parent session's shell. `tmuxStartSession` overrides all three per session (`show-environment -t scratch-fallback` shows the clone's queue root, `PROOFSPEC_TASK=scratch-fallback`, and its own MCP config). Nothing in the real queue was touched: no `executor` file appeared under the real `.proofspec/dispatch`.

## 4. Start `scratch-fallback` like a scheduling pass: PASS
- Ran the `tmuxStartSession(process.cwd(), 'scratch-fallback')` command from `$S/queue`.
- `pane_start_command` is `sh .../proofspec-session-uqulf7/runner.sh`, and that runner is `exec pi --approve --no-extensions --extension "$PROOFSPEC_PROGRESS_EXTENSION" ...`, so the pane names `pi`.
- `pane_current_path` is `$S/queue/.proofspec/worktrees/scratch-fallback`.
- The pane shows pi v0.86.1 on `stub-model`, hitting `Error: 429 status code (no body)` and retrying.
- The second attempt (runner `proofspec-session-5InYEQ`) also named `pi`.

## 5. Watch `pi` fail over to `claude`: PASS (on the second attempt)

**First attempt: no switch.** pi made 4 requests (08:04:29 to 08:04:43Z), ended with `Error: Retry failed after 3 attempts`, and settled. The pi session log's last message was `stopReason: "error"`. After about 9.5 minutes of waiting there was still no `executor` file.
- Cause: the `state` file I hand-wrote held `building\n`. `restartInClaude` in `src/progress/extension.ts` compares `readState(...) !== BUILDING`. `readState` (`src/cli/queue.ts:155`) returns the raw file, and `readOptional` does no trim. So `"building\n"` is not `"building"`, and the watch did nothing.
- The queue's own writer (`writeState`) never adds a newline, so this was a deviation in my setup, not a failure against the script's standard.
- It is still worth noting. The executor reader in `session.ts:135` trims its file, but the state reader does not. A state file written by hand or by `echo` makes the provider-error watch go silent.

**Second attempt: switch happened.** I rewrote the state as the bare word `building` and re-ran the step 4 command.
- `executor` appeared at 18:15:03 and holds `claude`.
- `pane_start_command` changed to runner `proofspec-session-9fzjyz`, which is `exec claude "$PROOFSPEC_KICKOFF" --append-system-prompt ... --dangerously-skip-permissions --mcp-config "$PROOFSPEC_MCP_CONFIG"`. It names `claude`, not `pi`.
- The tmux session was re-created ("created 18:15:02"), so the old pi session was killed. The restart still landed, which shows it ran detached.
- `pane_current_path` is `/private/var/.../tmp.yQq8PrQ1JB/queue/.proofspec/worktrees/scratch-fallback`. That is the same worktree (`/var` is a symlink to `/private/var`).
- `stub.log` grew to 11 lines: pi's `POST /v1/chat/completions` requests, then claude's `HEAD /api/hello`. The failure came from the stub.

## 6. Claude session hook wiring: PASS
`$S/queue/.proofspec/worktrees/scratch-fallback/.claude/settings.json`:
- **Heartbeat:** `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` each carry a heartbeat group: `node --experimental-transform-types $S/queue/src/mcp/heartbeat.ts`.
- **Existing hook kept:** `PreToolUse` also keeps the worktree's existing `cbm-first-gate` group, so the wiring merged into the settings rather than replacing them.
- **Provider-error hook:** `StopFailure` has exactly one group: `node --experimental-transform-types /private/var/.../tmp.yQq8PrQ1JB/queue/src/mcp/provider-error.ts`. It runs from the queue root, not from the worktree.

## 7. Watch `claude` park the TASK: PASS
- Answered the one-time "trust this folder" screen with `send-keys Down Enter`. Claude then retried against the stub ("429 Weekly/Monthly Limit Exhausted... attempt 4/10").
- `QUESTION` appeared by 18:18:14. It holds: `API Error: Server is temporarily limiting requests (not your usage limit) · Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-28 20:16:01`
- `grep -c` for the exact text `Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-09-28 20:16:01` returns 1.
- `state` is `[blocked-on-question]`.
- `pnpm proofspec docket` shows: `scratch-fallback  blocked-on-question  no phase  on scratch/fallback  in state 3s ...`

## 8. Restart the switched TASK by hand: PASS
- Rewrote `state` to `building`.
- Run A, with `PROOFSPEC_EXECUTOR` unset: the runner (`W747oM`) is `exec claude ...`.
- Run B, with `PROOFSPEC_EXECUTOR=pi` set for that one command: the runner (`6o8KUF`) is `exec claude ...`.
- `executor` still holds `claude`. The record is read before the environment variable.

## 9. Control TASK: PASS
- Started `scratch-control`. Its runner (`c9iGFc`) is `exec pi ...`.
- The stub gained new `POST /v1/chat/completions` requests at 08:18:29Z and 08:18:31Z. pi then gave up ("Retry failed after 3 attempts") inside the next minute.
- After more than 60 seconds more (18:19:32):
  - `scratch-control/` holds only `INTENT MANIFEST heartbeat state`, with no `executor` and no `QUESTION`.
  - `state` is `[queued]`.
  - The pane still names `pi`.

## 10. Gates in the branch worktree: PASS
- `pnpm test`: exit 0. 94 test files and 634 tests passed.
- The four test files behind the changed requirements (`tests/mcp/provider-error.test.ts`, `tests/progress/extension.test.ts`, `tests/schedule/session.test.ts`, `tests/mcp/heartbeat.test.ts`) passed again on their own: 77 of 77.
- `pnpm typecheck` (`tsc -p tsconfig.json`): exit 0.
- `pnpm spec:write`: exit 0, "nothing to write". The working tree was unchanged afterwards (only the pre-existing ` M .claude/settings.json`).
- `pnpm spec:check`: exit 0. It printed one advisory line: `Term MANIFEST: its definition spells TASK in its everyday form 'task'...`. It comes from `specs/glossary.md`, which this branch does not touch, so it is pre-existing and not drift.

## 11. Teardown: PASS
- Before teardown, the stub had logged 59 requests.
- `tmux -L pef-accept-81030 kill-server`: exit 0. The stub was killed and `rm -rf "$S"` ran.
- `tmux -L pef-accept-81030 ls` now prints `no server running on /private/tmp/tmux-501/pef-accept-81030`.
- `curl http://127.0.0.1:18429/` fails to connect (exit 7, code 000). `$S` is gone, and `pgrep` finds no leftover processes.
- Residue outside `$S` that the script's teardown does not cover:
  - Six `startSession` temp dirs in `$TMPDIR`: `proofspec-session-{uqulf7,5InYEQ,9fzjyz,W747oM,6o8KUF,c9iGFc}`.
  - Claude Code's project transcript dir `~/.claude/projects/-private-var-folders-...-tmp-yQq8PrQ1JB-queue--proofspec-worktrees-scratch-fallback`.
  - I left both in place, since they are outside the script's teardown.

## Findings for the executor
1. **Worth fixing:** the provider-error watch compares the raw `state` file to `building`, and `readState` does not trim. A `state` file with a trailing newline stops the pi-to-claude switch without any message.
   - Every writer in the codebase omits the newline, so this did not affect the scripted standard once the setup matched the queue's own format.
   - The executor record reader does trim (`src/cli/session.ts:135`), so the two readers behave differently.
2. The run leaves `proofspec-session-*` temp dirs and a Claude Code projects dir behind. Neither is in the script's teardown standard.
