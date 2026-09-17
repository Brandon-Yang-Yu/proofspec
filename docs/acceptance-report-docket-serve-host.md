# docket-serve-host — acceptance report

Checker run of `.proofspec/dispatch/docket-serve-host/acceptance.md` against the worktree,
on the real port. Overall: **8 pass, 1 can't-tell.**

| # | Step | Result |
|---|------|--------|
| 1 | Suite green (`pnpm test`, `pnpm typecheck`) | PASS |
| 2 | Demo queue entry written, nothing else changed | PASS |
| 3 | Serve with no host named: `/` HTML, `/docket` JSON with demo row | PASS |
| 4 | Default refuses the non-loopback address (curl exit 7; listener 127.0.0.1 only) | PASS |
| 5 | Stop the default serve | PASS |
| 6 | `--host 0.0.0.0`: page + JSON at 192.168.68.55, byte-identical to loopback answers | PASS |
| 7 | Read it from another device | CAN'T-TELL |
| 8 | Stopping releases the port (curl refused, no listener left) | PASS |
| 9 | `spec:write` a no-op, prose unchanged, six scenarios recorded, `spec:check` exit 0 | PASS |

Step 7 could not be run as written from this machine: no scriptable path to another
device exists (no second ssh-able host, no devicectl, no remote browser). The machine-side
preconditions it depends on were verified directly: the listener stands on every interface
(`TCP *:4567 (LISTEN)`), the macOS firewall is disabled so nothing blocks inbound, and the
served page carries its own two-second `fetch('/docket')` refresh. The remaining act —
opening `http://192.168.68.55:4567/` in a browser on another device while a
`docket --serve --host 0.0.0.0` runs — needs hands this session does not have.

Evidence per step, commands and observations, is in the executor session log; this report
is the record the branch's history keeps. Dropped from the tree in the commit after this
one, the same convention the docket-page report rode.
