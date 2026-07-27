---
name: createworktree
description: Create an isolated git worktree and switch the session into it, ready to work a task or slice. Use when the user says "/createworktree <name>" or asks to start work in a fresh worktree before shipping.
metadata:
  author: proofspec
  version: "1.0"
---

# /createworktree — open an isolated worktree

Set up a fresh, isolated place to work one task or slice, so `main` stays clean and
`/ship` can run without touching worktree mechanics. This is the setup step that used
to live inside `/ship`.

The argument is the worktree name (`/createworktree <name>`). If no name is given,
derive a short kebab-case one from the task (e.g. `matter-list-crud`,
`template-picker-ui`).

## 1. Check the preconditions

- You must be in the git repo and **not already inside a worktree**. `EnterWorktree`
  with a new `name` refuses to nest. If a worktree session is already active, stop and
  tell the user — they likely want `/killworktree` first, or to work in the one they
  have.
- Confirm the working tree is clean enough to branch from (`git status`). Uncommitted
  work on `main` should be handled before opening a new worktree.

## 2. Create and enter

Call `EnterWorktree` with `name` set to the chosen name. This creates the worktree
under `.claude/worktrees/<name>` on a new branch and switches the session into it. By
default the branch starts fresh from `origin/<default-branch>` (the `worktree.baseRef`
setting; `head` would branch from local HEAD instead).

## 3. Confirm and hand off

Report the worktree path, the branch name, and that the session is now working inside
it. From here the user can run `/ship <slice>` (or work by hand); everything stays in
this worktree until `/killworktree` closes it out.
