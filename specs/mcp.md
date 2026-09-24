# mcp

Serves the queue's tool surface to the Claude Code harness: the five tools the `pi`
extensions register — `enqueue_task` and `census_in_flight` (`specs/handoff.md`), and
`report_task_state`, `report_task_phase`, and `settle_task` (`specs/progress.md`) — over a
stdio MCP server, with the heartbeat reached through a CLI entry the harness's hooks call.
One tool surface, two transports, one core: every rule a tool answers by lives in that
core, and neither transport decides anything, so the tools answer the same whichever
harness a session runs in.

### Requirement: The MCP server exposes the same five tools, answering from one core

The MCP server SHALL expose `enqueue_task`, `census_in_flight`, `report_task_state`,
`report_task_phase`, and `settle_task` under the same names, with the same parameters, and
answering the same values the `pi` extensions answer. The server and the extensions SHALL
both hand every call to one core, and each tool's behavior SHALL live in that core: a
change to a tool's behavior lands in the core and reaches both harnesses, and is written
nowhere else.

Both harnesses serve the same product, and a tool answered one way inside `pi` and another
way through the server is the same product disagreeing with itself. The tools are written
once; the transports only carry calls to them.

<!-- scenarios: generated -->
- "A change to each tool's behavior reaches both transports together" → tests/mcp/server.test.ts
- "A tool answers the same values whichever transport carries its call" → tests/mcp/server.test.ts
- "Each tool is registered under the same parameters on both transports" → tests/mcp/server.test.ts
- "The server exposes the same five tools under the same names, and no others" → tests/mcp/server.test.ts
<!-- /scenarios -->

### Requirement: An adapter carries transport only, never a rule

Each transport adapter SHALL carry transport only — the parameter schemas its tools are
registered under and the process wiring that starts and serves it — and SHALL NOT validate
an argument, decide a policy, or hold a second copy of any rule the core already keeps. Two
surfaces answering one tool differently is the failure this rule exists to prevent.

Two surfaces that share a rule by each holding a copy of it do not share it for long: one
copy gets edited, the other stands, and the two harnesses drift apart with no single change
to point at. One core with two thin adapters is the shape that keeps that from starting.

<!-- scenarios: generated -->
- "The MCP adapter carries calls to the core unchanged, and answers back unchanged" → tests/mcp/adapter.test.ts
- "The pi adapter carries calls to the core unchanged, and answers back unchanged" → tests/mcp/adapter.test.ts
<!-- /scenarios -->

### Requirement: The MCP server is the ProofSpec copy the queue root holds, never the TASK's worktree's

The MCP server a session loads SHALL be the copy of ProofSpec that the queue root holds.
When the queue root is ProofSpec's own checkout, the server SHALL be that checkout's own
`src/mcp/serve.ts`. When the queue root is a project that installed ProofSpec, the server
SHALL be the installed package's built server, `node_modules/proofspec/dist/mcp/serve.js`
under the queue root. The server SHALL NOT be any copy inside the TASK's own worktree.

A TASK's worktree holds the tools as its branch had them when the branch was cut, and
that copy may be out of date. The queue root holds the current tools. A session needs the
current tools to report its state and settle its TASK.

<!-- scenarios: generated -->
- "When the queue root is ProofSpec's own checkout, the MCP server a session loads runs from that checkout's own src/mcp/serve.ts, never the TASK's worktree's" → tests/mcp/checkout.test.ts
- "When the queue root is a project that installed ProofSpec, the MCP server a session loads runs from the installed package's built server, never the TASK's worktree's" → tests/mcp/checkout.test.ts
<!-- /scenarios -->

### Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks

The CLI SHALL offer a heartbeat entry that resolves `PROOFSPEC_QUEUE_ROOT` and
`PROOFSPEC_TASK` from the environment the same way the report tools do — writing nothing
when either is unset — and performs the same heartbeat write the `pi` events trigger. It
SHALL do nothing else. The Claude Code harness's hooks call it.

The hooks a dispatched session wires SHALL run the entry the queue root holds: that
checkout's own `src/mcp/heartbeat.ts` when the queue root is ProofSpec's own checkout,
the installed package's built `node_modules/proofspec/dist/mcp/heartbeat.js` when it is
a project that installed ProofSpec — the same two-kind rule the MCP server entry
carries, and for the same freshness reason: run from the queue root, never the TASK's
own worktree's possibly stale copy.

One write, two triggers: the `pi` transport fires the write from its own events, and the
Claude Code transport fires it from hooks that run this entry. The write is the one shared
thing, so the `heartbeat` file means the same whichever harness the session runs in.

<!-- scenarios: generated -->
- "The heartbeat CLI entry does nothing else" → tests/mcp/heartbeat.test.ts
- "The heartbeat CLI entry performs the same heartbeat write the pi events trigger" → tests/mcp/heartbeat.test.ts
- "The heartbeat CLI entry writes nothing when either PROOFSPEC_QUEUE_ROOT or PROOFSPEC_TASK is unset" → tests/mcp/heartbeat.test.ts
- "When the queue root is ProofSpec's own checkout, the hooks run that checkout's own src/mcp/heartbeat.ts" → tests/mcp/heartbeat.test.ts
- "When the queue root is a project that installed ProofSpec, the hooks run the installed package's built heartbeat entry, refreshing the TASK's heartbeat on a reported move" → tests/mcp/heartbeat.test.ts
<!-- /scenarios -->

### Requirement: The Claude Code hook wiring merges into the settings the worktree already carries

The hook wiring a dispatched Claude Code session runs with SHALL be merged into the
`.claude/settings.json` already standing in the TASK's worktree: every setting the file
carries outside the four reported-move events SHALL stand exactly as it was, the heartbeat's
hook group SHALL join each of those events' existing groups, and a dispatch into a worktree
already wired SHALL add no second copy.

The worktree's `.claude/settings.json` is the project's own committed file — a project may
wire its own hooks there (an install hook, a worktree convention) beside whatever a session
adds. A dispatch that replaces the file erases the project's settings, and the executor
commits the worktree's file, so the erasure would ride the TASK's own merge into the
project's history.

<!-- scenarios: generated -->
- "A dispatch into a worktree already wired adds no second copy of the heartbeat hook" → tests/mcp/heartbeat.test.ts
- "The hook wiring joins the settings already standing in the TASK's worktree, erasing nothing" → tests/mcp/heartbeat.test.ts
<!-- /scenarios -->
