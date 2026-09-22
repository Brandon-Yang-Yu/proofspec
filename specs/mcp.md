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

### Requirement: An adapter carries transport only, never a rule

Each transport adapter SHALL carry transport only — the parameter schemas its tools are
registered under and the process wiring that starts and serves it — and SHALL NOT validate
an argument, decide a policy, or hold a second copy of any rule the core already keeps. Two
surfaces answering one tool differently is the failure this rule exists to prevent.

Two surfaces that share a rule by each holding a copy of it do not share it for long: one
copy gets edited, the other stands, and the two harnesses drift apart with no single change
to point at. One core with two thin adapters is the shape that keeps that from starting.

### Requirement: The MCP server runs from the queue root's own checkout, never the TASK's worktree

The MCP server process SHALL be started from the queue root's own checkout, never from the
TASK's own worktree.

A freshly created worktree carries whatever copy of the tools the TASK's branch holds, and
a TASK's branch is cut from `main` at some earlier, possibly stale point; the queue root's
checkout is where the current tools live. A session that must report its state needs the
current tools, not its branch's possibly stale copy.

### Requirement: A heartbeat CLI entry performs the same heartbeat write, called by the Claude Code hooks

The CLI SHALL offer a heartbeat entry that resolves `PROOFSPEC_QUEUE_ROOT` and
`PROOFSPEC_TASK` from the environment the same way the report tools do — writing nothing
when either is unset — and performs the same heartbeat write the `pi` events trigger. It
SHALL do nothing else. The Claude Code harness's hooks call it.

One write, two triggers: the `pi` transport fires the write from its own events, and the
Claude Code transport fires it from hooks that run this entry. The write is the one shared
thing, so the `heartbeat` file means the same whichever harness the session runs in.
