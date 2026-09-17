# docket-page — the docket's answer as a page

## The change

The docket answers in a fourth form: a page a browser can open. `pnpm proofspec
docket --serve` starts a small read-only server on the loopback, port 4567 by default.
`/` answers the page; `/docket` answers the JSON the page reads. The page refreshes
itself; nothing on it acts.

The intent is settled in the spec changes on this branch:

- `specs/docket.md` — three new requirements: the page answers the docket's answer;
  the page refreshes itself without advancing any number client-side; the page shows
  commands and offers no controls.
- `specs/cli.md` — the serve form: loopback, port 4567 by default, paths `/` and
  `/docket`.

## Acceptance

The server writes no file anywhere — serve answers sockets only — so the run below
needs no scratch copy and leaves the real repo untouched.

1. `pnpm proofspec docket --json` exits 0 and answers one line of JSON. This is the
   one-shot form; it is the baseline.
2. `pnpm proofspec docket --serve` (its own terminal) listens on
   `http://localhost:4567/` and runs until stopped.
3. `curl -s http://localhost:4567/docket` answers the same content step 1 gave: same
   rows, same state words, same session facts. The two age numbers may differ by the
   seconds between the two calls — ages are recomputed per request, by design.
4. `curl -s http://localhost:4567/` answers the page: HTML with an inline script that
   polls `/docket` on its own.
5. Open `http://localhost:4567/` in a browser. Each TASK has a row: the state words,
   the two ages, the attach command as copyable text. Every unresolved relationship
   carries its ruling command. No button or form on the page acts — attach, rule,
   hold are absent.
6. Leave the page open, untouched, for ten seconds. The numbers change on their own:
   the page refreshes itself; no human presses refresh.
7. Stop the server. `pnpm proofspec docket --serve --port 4568` answers on 4568 —
   the port is overridable. Stop it: the port is released and the process exits on
   Ctrl-C.

## Done means

- The specs on this branch hold, and the acceptance script above passes.
- `pnpm spec:check` green; `pnpm test` green; the docket reports this TASK mergeable.
