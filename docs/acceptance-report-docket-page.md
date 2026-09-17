# docket-page — acceptance checker report

The acceptance script at `docs/intent/docket-page.md`, run for real in this worktree,
one step at a time, from bash. All servers killed with `kill -INT`; ports confirmed
released; the throwaway queue removed; `git status` clean at the end.

| Step | Verdict | Evidence |
|---|---|---|
| 1. one-shot `--json` | **pass** | exit 0, stdout exactly one line: `{"rows":[…],"problems":[],"outstanding":[]}` |
| 2. `--serve` on 4567 | **pass** | node listening on `127.0.0.1:4567` (loopback), log: "serving the docket at http://localhost:4567/ — Ctrl-C stops it"; ran until INT |
| 3. `/docket` = step 1 | **pass** | node compare of one-shot vs served: rows identical after zeroing only the two age fields — same state words, same session facts, same problems/outstanding |
| 4. page at `/` | **pass** | `<!doctype html>` + `<title>Docket</title>`, inline script with `fetch('/docket')` on `setInterval(refresh, 2000)`; 0 matches for `<form`/`<button`/`onclick` |
| 5. rows in a browser | **pass** | Real headless Chrome `--dump-dom` rendered `<td>demo</td><td>building</td>…<td>1m 11s</td><td>no heartbeat</td>`; rendered DOM has 0 forms/buttons. The queue rows carried no listed session and no outstanding relationship, so those cells weren't live in the browser run — `tests/docket/page.test.ts` runs the page's script *unchanged* (`pageScript()`) in a stub browser and asserts `<code>ATTACH…</code>` and `<code>RULING.answerWith</code>` each in one copyable run, plus the no-controls scenario |
| 6. numbers move alone | **pass** | Two untouched headless loads ~2 min apart rendered the same row's age `18m 39s` → `20m 44s` while its state file never changed; the served page polls every 2 s; page.test.ts asserts the script fetches `/docket` at once and again when its interval fires |
| 7. `--port 4568` + clean stop | **pass** | answered `/docket` and `/` on 4568; `kill -INT` → port released, process exited on Ctrl-C; same for 4567 earlier |

Findings noted, not blockers: a stale `docket --serve` from the author's earlier run was
holding 4567 when the check began (killed; the refusal "port 4567 is already in use" is the
correct behavior for a second instance); and pnpm prints `[ELIFECYCLE] Command failed`
after a Ctrl-C'd serve — pnpm's wrapper for any interrupted script, not the server's own
exit; the process exits and the port releases, which is what step 7 asks.
