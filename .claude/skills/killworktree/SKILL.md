---
name: killworktree
description: Close out the current worktree — merge its branch into main, verify green, then remove the worktree and branch. Use when the user says "/killworktree" or asks to land the work and clean up after shipping.
metadata:
  author: proofspec
  version: "1.0"
---

# /killworktree — land the work and tear down

Close out the worktree you have been working in: deliver its commits to `main`, then
remove the worktree and its branch. This is the teardown step that used to live at the
end of `/ship`. Run it once, after all the slices you meant to build in this worktree
are committed.

## 1. Check it is safe to close

- Run `git status` in the worktree. The tree must be **clean** — every change either
  committed or intentionally dropped. If there is uncommitted work, stop and tell the
  user; do not merge or remove over unsaved changes.
- Note the branch name and the worktree path (`git worktree list`) before you leave.

## 2. Leave the worktree

Call `ExitWorktree` with action `keep` — this returns the session to the original
directory (`main`) while leaving the branch and worktree intact on disk for the merge.
(`ExitWorktree` only acts on a worktree this session entered; if it reports no active
session, return to the primary checkout by hand before merging.)

## 3. Merge into main

From `main`, merge the task branch. Prefer `git merge --ff-only <branch>`. If `main`
has advanced and a fast-forward is impossible, use
`git merge --no-ff <branch> -m "chore(<scope>): merge <branch>"` — a hook-conforming
message, because the default `Merge branch …` text fails `commit-msg`. Resolve any
conflict, then run `pnpm test` on `main` and require green before tearing down.

## 4. Remove the worktree and branch

Delete both: `git worktree remove .claude/worktrees/<name>`, then
`git branch -d <branch>` (safe delete — it is now merged). Confirm with
`git worktree list` that it is gone. Leave any other worktrees untouched.

If the branch was **not** merged (the user is abandoning the work), say so first, then
use `git worktree remove --force` and `git branch -D <branch>` — but only after the
user confirms the work is being thrown away.

## Finish

Report: branch merged (or discarded), tests green on `main`, and that the worktree and
branch are cleaned up. Never push to a remote unless the user asked.
