# investigator-no-write-tools — acceptance checker report

The acceptance script at
`.proofspec/dispatch/investigator-no-write-tools/acceptance.md`, run for real in this
worktree, one step at a time, from bash. The worktree's HEAD is the branch that merges
into main as a fast-forward, so its content is exactly merged main's content.

| Step | Verdict | Evidence |
|---|---|---|
| 1. frontmatter `tools:` line | **pass** | `sed -n '1,20p' .pi/agents/investigator.md` → `tools: read, grep, find, ls, bash, subagent, enqueue_task, census_in_flight` — exact match, no `write`, no `edit` |
| 2. "No write or edit tool" section | **pass** | states "Your tool list carries no `write` and no `edit`. That is deliberate." and "Every sentence of intent prose — a spec row, a TERM, the intent doc, the acceptance script, at every revision round — arrives only through a fresh intent writer pass you spawn." |
| 3. `intent-writer.md` unchanged | **pass** | `sed -n '1,12p' .pi/agents/intent-writer.md` → `tools: read, write, edit, grep, find, ls` — `write` and `edit` still listed |
| 4. `design.md` §49 paragraph | **pass** | the paragraph at line 1248 opens "Drafting has since left the investigator's own hands." and its last sentences read "The split is now backed at the tool level as well: the investigator's persona carries no `write` or `edit` tool at all, so the rule against drafting prose and the toolbelt it runs with say the same thing." |
| 5. `pnpm test` | **pass** | 86/86 test files passed, 499/499 tests passed, 0 failures |

Findings noted, not blockers: the `judge: could not run pi` line the suite prints is a
warning from the judge harness about a probe timeout, not a test failure — vitest reports
zero failures.
