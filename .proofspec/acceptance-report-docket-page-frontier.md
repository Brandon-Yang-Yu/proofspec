# Acceptance report — `docket-page-frontier`

## Step 1 — Run the suite: **PASS**
`pnpm test` in the worktree → `Test Files 87 passed (87)`, `Tests 591 passed (591)`, 17.74s. (The `judge: could not run pi` line is a hook warning, not a test.)

## Step 2 — Regenerate and check agreement: **PASS**
`pnpm spec:write` → `nothing to write`; `pnpm spec:check` → exit 0, no drift reported. `git status --porcelain` after: clean — the rewrite changed nothing.

## Step 3 — Build the scratch queue: **PASS**
`find` shows exactly the 11 files: five entry dirs each with a one-line JSON MANIFEST and one-word `state` file (written with `printf`), plus `schedule/raised.jsonl`. Chain: `chain-a` (main, merged) ← `chain-b` (task/chain-a + reason, merged) ← `chain-c` (task/chain-b + reason, building); `lone-merged` (main, merged, nothing names it as base); `ruling-wanted` (blocked-on-question); the one raised line keyed `capability:docket:one,two`. Matches the script's fixture exactly.

## Step 4 — Serve the docket: **PASS**
Cleared 8787 first (0 listeners). Started from `cwd = /tmp/docket-frontier-fixture` per the amendment: log says `serving the docket at http://localhost:8787/`; `GET /` → 200, `GET /docket` → 200.

## Step 5 — JSON stands still: **PASS**
First grep prints the flat JSON in full — every entry by name with its state word (`chain-a` merged, `chain-b` merged, `chain-c` building, `lone-merged` merged, `ruling-wanted` blocked-on-question). Second grep (`2/3`): **`output=<>`, exit 1 — genuinely prints nothing**; the full JSON body confirms no fraction anywhere.

## Step 6 — Head and two themes: **PASS**
First grep prints the viewport meta, `<meta name="color-scheme" content="light dark">`, CSS `color-scheme: light dark;`, `@media (prefers-color-scheme: dark)`. Second grep (`matchMedia`): **`output=<>`, exit 1 — prints nothing**. The page's single `<script>` (read in full for the record) renders/refreshes from `/docket` + `/archive`; no `matchMedia`, no control but the disclosure's own `summary` toggle.

## Step 7 — The chain's one row: **PASS**
The tbody holds exactly three `<tr>`; first is the chain's row at `chain-c`'s sort place: `<td>chain-c<details id="chain-chain-c"><summary>2/3</summary><ul><li>chain-a merged</li><li>chain-b merged</li><li>chain-c building</li></ul></details></td>` — bare `2/3` with no words around it; all members by name and state word in the disclosure; `chain-a`/`chain-b` ride only inside it; `work/chain-c` renders (differs from the TASK name).

## Step 8 — Muted row, the problem, the ruling: **FAIL as written**
The step's grep passes (all tokens print), and its first clause holds: `<tr class="muted"><td>lone-merged</td>` keeps its own muted row. But the standard's two section assignments do not hold as written:

- *"The problems section carries the problem the ledger raised, the key `capability:docket:one,two`"* — the problems section is **empty and hidden** (`<ul id="problems" … hidden></ul>`); the fixture (per the executor's own amended step 3) contains no unreadable entry. The key `capability:docket:one,two` appears only inside the rulings outstanding section's `<code>` command run.
- *"The rulings outstanding section carries `ruling-wanted` with its command"* — that section carries the **raised relationship** (`capability "docket" shared by one, two` + `<code>proofspec schedule --ruling "<your ruling>" 'capability:docket:one,two'</code>`); `ruling-wanted` renders as an ordinary queue row (`<td>ruling-wanted</td>`, "no session") and carries no command anywhere.

**Analysis for the executor:** the page matches the KEEP'd spec, not the script's wording. `specs/docket.md` (unrewritten by this TASK) pins it: *"The answer names every relationship raised but not yet ruled … each with … the relationship's key, and the exact command line that records a ruling"* → **rulings outstanding** section; and *"A TASK entry that cannot be read answers a problem naming it"* → **problems** section. Step 8's sentences cross that vocabulary — the same class of fixture/reality mismatch the executor already amended in steps 3–4, left standing here. The substance (raised key on the page; one whole copyable command run) is present, in the spec-assigned section. Either the script's step-8 wording needs amending, or the page defied a KEEP'd requirement — the evidence says the former, but that call is the executor's, not mine.

## Step 9 — The human's eyes: **NOT ATTEMPTED — awaiting the human**
By the script's own definition this is a human act; I did not attempt it. **Left standing for them:** the scratch queue `/tmp/docket-frontier-fixture` intact (all 11 files, verified after teardown), and the server **stopped** with no listener on 8787 (verified: 0 listeners). To open the page, the human runs the step-4 command:

```sh
cd /tmp/docket-frontier-fixture
node --experimental-transform-types \
  /Users/yang/Projects/proofspec/.proofspec/worktrees/docket-page-frontier/src/cli/main.ts \
  docket --serve --port 8787
```

then opens `http://localhost:8787/`. When the eyes say yes, the script's own close-out applies: stop the server, drop `/tmp/docket-frontier-fixture`.

---

**Tally: 7 pass, 1 fail (step 8, as written — page consistent with the KEEP'd spec; script wording crossed), 1 awaiting the human (step 9).** The run is not done: step 8 needs the executor's ruling on script-versus-page, and step 9 needs the human's eyes.

---

## Step 8 — PASS

**The step as executed.** Port 8787 cleared first (`lsof -ti :8787 | xargs kill`; no listener remained). Scratch queue rebuilt fresh per step 3 as amended — `task`-kind bases carrying `reason`, `printf` for the state files (verified by `od -c`: one word, no trailing newline), one `raised` line for `capability:docket:one,two`. Server started per step 4 as amended — `cd /tmp/docket-frontier-fixture`, then `node --experimental-transform-types …/src/cli/main.ts docket --serve --port 8787` (pid 71797, answered 200 at `/`). Step 8's curl run exactly as written:

```sh
curl -s $PAGE | grep -F -e lone-merged -e 'one,two' -e ruling-wanted
```

It printed the `lone-merged` and `ruling-wanted` rows and the rulings list — the three things the step seeks.

**Judged against the amended standard, count by count:**

1. **`lone-merged` keeps its own row, shown muted — PASS.** The row is `<tr class="muted"><td>lone-merged</td>…` in `#rows`, its own row. No MANIFEST in the fixture names it as base (`grep -l '"task":"lone-merged"' …/MANIFEST` → none), so nothing folds it away — confirmed by the page, where it renders no disclosure and rides in no other row.
2. **The rulings outstanding section carries the raised relationship with the key inside its command, one whole copyable run — PASS.** `<h2 id="rulings-heading">rulings outstanding</h2>` stands visible; its one `<li>` reads `capability "docket" shared by one, two` followed by `<code>proofspec schedule --ruling "<your ruling>" 'capability:docket:one,two'</code>`. The key `capability:docket:one,two` occurs exactly once on the page (`grep -o | wc -l` → `1`), inside that single `<code>` element — one whole copyable run.
3. **`ruling-wanted` renders as its ordinary queue row — PASS.** An ordinary `<tr>` in `#rows` (not muted, not folded), spelling `no session`, with no `<code>` riding in its row — the entry blocked on a question carries no command.
4. **The problems section stands empty and hidden, its absence spelled — PASS.** `<h2 id="problems-heading" hidden>problems</h2>` and `<ul id="problems" aria-labelledby="problems-heading" hidden></ul>` — the section's markup is spelled, both parts carry `hidden`, the list is empty. The raised line appears only in rulings, matching the KEEP'd spec: problems is for entries that cannot be read, and the fixture holds none.

**Teardown.** Server killed (`kill 71797`), `lsof -i :8787` confirms no listener. The scratch queue `/tmp/docket-frontier-fixture` stands with all eleven files, ready for the human's step 9 (serve again per step 4, then open `http://localhost:8787/` in a browser).

Steps 1–7 stand as passed in the prior run; step 8 now passes as amended; step 9 remains the human's.
