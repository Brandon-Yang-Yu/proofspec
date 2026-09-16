import { access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { git } from './git.ts'
import { manifestFor } from './queue.ts'

/**
 * The real `startSession` action design.md left for an embedder to supply: a headed,
 * interactive `pi` executor, started in the TASK's own worktree. `schedule`'s own core
 * never starts one itself (see its tests) — this is the one place that actually does, using
 * tmux as the one thing on this machine that can hand a real pty to a human without taking
 * over the terminal the scheduling pass itself is running in.
 */

const WORKTREES_DIR = ['.proofspec', 'worktrees'] as const

/** Where a TASK's own worktree lives by convention — this tool's own on-disk root, the same
 * one the queue directory and the review LEDGER already live under. */
function worktreePathFor(cwd: string, task: string): string {
  return join(cwd, ...WORKTREES_DIR, task)
}

/**
 * Makes sure a TASK's branch has a worktree checked out at its conventional path, creating
 * one when none exists yet. A ready TASK can reach this action having had no worktree ever
 * opened for it, or having had one opened and since torn down independently of its queue
 * entry — starting a session cannot assume one is there.
 */
export async function ensureWorktree(cwd: string, task: string, branch: string): Promise<string> {
  const path = worktreePathFor(cwd, task)
  if (await pathExists(path)) return path
  const added = await git(cwd, ['worktree', 'add', path, branch])
  if (added === undefined) throw new Error(`could not create a worktree for TASK ${task}'s branch ${branch} at ${path}`)
  return path
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** One tmux command, as the exact program and argv it runs — kept pure so the command a
 * session actually starts can be checked without ever spawning a process. */
export type TmuxCommand = { readonly command: string; readonly args: readonly string[] }

const DEFAULT_TMUX_SOCKET = 'proofspec'

const EXECUTOR_PERSONA_PATH = ['.pi', 'agents', 'executor.md'] as const

/**
 * Strips a `.pi/agents/*.md` persona file's YAML frontmatter, leaving the prompt body a
 * `--append-system-prompt` argument actually wants. The frontmatter's `name:`/`tools:` lines
 * are metadata for the `subagent` spawn mechanism — meaningless, and misleading, as literal
 * prompt text for a session nothing spawned that way. A file with no frontmatter delimiter at all
 * passes through unchanged rather than throwing: still a usable system prompt, and a missing
 * delimiter is not ambiguous the way a malformed value would be.
 */
export function promptBodyFrom(fileContents: string): string {
  return fileContents.replace(/^---\n[\s\S]*?\n---\n/, '').trim()
}

/**
 * Reads the executor's own persona from this tool's own checkout (`cwd`), never from the
 * TASK's own worktree or branch — the executor's instructions are an operational convention
 * this repo's tooling keeps, the same as `DEFAULT_JUDGE_AGENT` or `PROOFSPEC_JUDGE_BIN`
 * (`cli/judge.ts`), not something a TASK's own branch gets to redefine for itself.
 */
async function executorSystemPrompt(cwd: string): Promise<string> {
  const raw = await readFile(join(cwd, ...EXECUTOR_PERSONA_PATH), 'utf8')
  return promptBodyFrom(raw)
}

/**
 * Which tmux server every command here targets — a dedicated one via `-L`, never the user's
 * default server or any other named one. tmux sessions are global to the whole machine, not
 * scoped to any directory or project: `kill-session -t <name>` on the default server kills
 * whatever real session already has that name, whoever it belongs to. Overridable the same way
 * `PROOFSPEC_JUDGE_BIN` is, so a test (or a future acceptance check) can point at a throwaway,
 * per-run socket instead of ever touching the real `proofspec` production one, let alone the
 * user's own.
 */
function tmuxSocket(): string {
  return process.env.PROOFSPEC_TMUX_SOCKET ?? DEFAULT_TMUX_SOCKET
}

const PROGRESS_EXTENSION_PATH = ['.pi', 'extensions', 'progress.ts'] as const

/** What `tmuxSessionCommands` needs to start a TASK's session — grouped rather than four
 *  positional params (style rule 4) now that the queue root joined worktree/systemPrompt. */
export type SessionStart = {
  readonly worktree: string
  /** This tool's own checkout, absolute — never the TASK's own worktree — so a session
   *  started from it can address the queue and load this checkout's own `progress` tool. */
  readonly queueRoot: string
  readonly systemPrompt: string
}

/**
 * The tmux commands that (re)start a TASK's pi executor: killing whatever tmux session
 * already carries the TASK's name before creating a fresh one, so retrying a TASK whose LEASE
 * went stale (schedule's own reclaim requirement) replaces a dead session rather than
 * colliding with its name. The kill is expected to fail the ordinary way — no such session —
 * which is why it is a command of its own rather than folded into one call. `systemPrompt` is
 * appended to `pi`'s own default coding-assistant prompt (`--append-system-prompt`), not a
 * replacement for it — the executor still needs everything that default already grants.
 * `PROOFSPEC_QUEUE_ROOT`/`PROOFSPEC_TASK` are how the session later addresses the queue from
 * inside its own worktree (`specs/progress.md`); `--approve` and the pinned `--extension` are
 * what let it actually load the tool that reports there — a freshly created worktree is an
 * unknown path to `pi`'s own project trust, and `.pi/` being tracked in git means the TASK's
 * own branch can carry a stale (or missing) copy of `progress.ts`.
 */
export function tmuxSessionCommands(task: string, start: SessionStart): readonly [kill: TmuxCommand, start: TmuxCommand] {
  const socket = tmuxSocket()
  const extension = join(start.queueRoot, ...PROGRESS_EXTENSION_PATH)
  return [
    { command: 'tmux', args: ['-L', socket, 'kill-session', '-t', task] },
    {
      command: 'tmux',
      args: [
        '-L', socket, 'new-session', '-d', '-s', task, '-c', start.worktree,
        '-e', `PROOFSPEC_QUEUE_ROOT=${start.queueRoot}`, '-e', `PROOFSPEC_TASK=${task}`,
        'pi', '--approve', '--extension', extension, '--append-system-prompt', start.systemPrompt,
      ],
    },
  ]
}

/**
 * The part of `startSession` provable without ever touching tmux: reads the TASK's own
 * MANIFEST for its branch, and makes sure a worktree stands for it. Throws on a TASK with no
 * readable MANIFEST or a worktree that could not be created — both are real setup problems
 * (Rule 5: a worktree is created before a TASK is ever queued), not an expected failure this
 * domain already has a value for.
 */
export async function resolveSessionWorktree(cwd: string, task: string): Promise<string> {
  const manifest = await manifestFor(cwd, task)
  if (manifest === undefined) throw new Error(`TASK ${task} has no MANIFEST to start a session from`)
  return ensureWorktree(cwd, task, manifest.branch)
}

/** Maps `startSession`'s own inputs onto the `SessionStart` `tmuxSessionCommands` needs —
 *  its own function so the one fact the `progress` boundary depends on (`queueRoot` is this
 *  tool's own `cwd`, never the TASK's worktree) is something a test can check without
 *  spawning a real tmux session. */
export function sessionStartFor(cwd: string, worktree: string, systemPrompt: string): SessionStart {
  return { worktree, queueRoot: cwd, systemPrompt }
}

/**
 * The real `startSession`: resolves the TASK's own worktree, then starts `pi` there in a
 * detached tmux session named for the TASK, seeded with the executor's own system prompt.
 */
export async function tmuxStartSession(cwd: string, task: string): Promise<void> {
  const worktree = await resolveSessionWorktree(cwd, task)
  const systemPrompt = await executorSystemPrompt(cwd)
  const [kill, start] = tmuxSessionCommands(task, sessionStartFor(cwd, worktree, systemPrompt))
  await runIgnoringFailure(kill)
  await runOrThrow(start)
}

/** Runs a command, ignoring whether it succeeded — `tmux kill-session` on a name with no
 * session is exactly this call's ordinary, expected failure, not a reason to stop. */
function runIgnoringFailure(command: TmuxCommand): Promise<void> {
  return new Promise(resolve => {
    const child = spawn(command.command, [...command.args], { stdio: 'ignore' })
    child.once('error', () => resolve())
    child.once('exit', () => resolve())
  })
}

/** Runs a command, throwing when it could not even start or exited non-zero — unlike the kill
 * above, `tmux new-session` failing is a real fault (tmux missing, a broken server) worth
 * surfacing rather than silently reporting a session that was never actually started. */
function runOrThrow(command: TmuxCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`${command.command} ${command.args.join(' ')} exited with code ${code}`))
    })
  })
}
