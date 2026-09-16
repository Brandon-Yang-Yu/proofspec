import { readFile, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { runGit } from './git.ts'
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
 * one with `git worktree add` whenever no worktree truly stands there. Reuse is decided by
 * the `.git` file a linked worktree keeps at its root — a local fact of the path itself —
 * never by the path merely existing: a `git worktree add` that fails partway can leave an
 * empty directory behind, and reusing whatever merely sits there would start the session
 * in a directory with no repository of its own behind it, on every retry. A creation that
 * fails throws carrying git's own stderr — a bare "could not create" names no cause, and
 * the causes git names (a branch already checked out elsewhere, say) are actionable.
 */
export async function ensureWorktree(cwd: string, task: string, branch: string): Promise<string> {
  const path = worktreePathFor(cwd, task)
  if (await isWorktree(path)) return path
  const added = await runGit(cwd, ['worktree', 'add', path, branch])
  if (!added.ok) {
    throw new Error(`could not create a worktree for TASK ${task}'s branch ${branch} at ${path}: ${added.stderr.trim()}`)
  }
  return path
}

/** Whether a worktree stands at `path`: the `.git` file a linked worktree keeps at its
 * root, and nothing looser — a directory merely sitting at the path is not one. */
async function isWorktree(path: string): Promise<boolean> {
  try {
    const dotGit = await stat(join(path, '.git'))
    return dotGit.isFile()
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

/** The one initial user message `pi` is handed as its positional prompt argument. Its exact
 * words are this implementation's own choice; what is not negotiable is that it exists — an
 * unattended session with no first message sits at `pi`'s input box indefinitely, loaded and
 * healthy but doing nothing, because `--append-system-prompt` changes who the model is,
 * never that it should act. Naming the TASK keeps the message self-contained rather than
 * leaning on the `PROOFSPEC_TASK` environment variable alone. */
function kickoffFor(task: string): string {
  return `Begin: work your TASK ${task} now - read the MANIFEST's intentRef on this branch, then run the full pipeline through to merge.`
}

/** The tmux command that kills a TASK's session on the dedicated server. Built for two
 *  callers that need the identical command: `startSession`, which clears a stale session of
 *  the same name before starting a fresh one, and the scheduling pass settling a TASK, which
 *  kills the session outright — same name, same dedicated server, never the user's own. */
export function tmuxKillSessionCommand(task: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(), 'kill-session', '-t', task] }
}

/** The tmux command that asks the dedicated server for its session list — the server's own
 *  answer about what it holds, which is how the docket learns whether a TASK's session is
 *  still there to attach to. */
export function tmuxListSessionsCommand(): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(), 'list-sessions'] }
}

/** The exact command a person runs to attach to a TASK's session on the dedicated server —
 *  the one line the docket carries for every session the server still holds. */
export function tmuxAttachCommand(task: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(), 'attach-session', '-t', task] }
}

/** A command as the one line a person copies and runs. */
export function commandLine(command: TmuxCommand): string {
  return `${command.command} ${command.args.join(' ')}`
}

/** Each line of tmux's `list-sessions` output names one session, colon-separated from its
 *  details — only the name is the docket's, to match against TASK names. */
export function parseSessionNames(output: string): readonly string[] {
  return output
    .split('\n')
    .map(line => line.split(':')[0]!.trim())
    .filter(name => name !== '')
}

/** The session names the dedicated server holds, or none when the server holds no session at
 *  all — a server with nothing on it is the docket's ordinary every-session-absent case, not
 *  a fault worth surfacing. */
export async function listTmuxSessions(): Promise<readonly string[]> {
  return parseSessionNames(await capture(tmuxListSessionsCommand()))
}

/** Runs a command and answers its stdout, or the empty string when it could not run or exited
 *  non-zero — a server that cannot be asked answers no sessions, which every row reads as
 *  absent rather than as a failure. */
function capture(command: TmuxCommand): Promise<string> {
  return new Promise(resolve => {
    const child = spawn(command.command, [...command.args], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    child.stdout.on('data', chunk => {
      out += chunk
    })
    child.once('error', () => resolve(''))
    child.once('exit', () => resolve(out))
  })
}

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
 * own branch can carry a stale (or missing) copy of `progress.ts`. `--no-extensions` disables
 * `pi`'s own auto-discovery of the worktree's copy of that same file — without it, `pi` loads
 * both, and refuses to start at all: two extensions registering the same tool name,
 * `report_task_state`, is a conflict `pi` treats as fatal, pinned copy or not. The pinned
 * `--extension` path still loads under `--no-extensions`, same as `pi`'s own help text says
 * an explicit `-e` does. The trailing positional argument is the kickoff message above: the
 * last thing after every flag/value pair, which is exactly how `pi` reads a first prompt.
 */
export function tmuxSessionCommands(task: string, start: SessionStart): readonly [kill: TmuxCommand, start: TmuxCommand] {
  const socket = tmuxSocket()
  const extension = join(start.queueRoot, ...PROGRESS_EXTENSION_PATH)
  return [
    tmuxKillSessionCommand(task),
    {
      command: 'tmux',
      args: [
        '-L', socket, 'new-session', '-d', '-s', task, '-c', start.worktree,
        '-e', `PROOFSPEC_QUEUE_ROOT=${start.queueRoot}`, '-e', `PROOFSPEC_TASK=${task}`,
        'pi', '--approve', '--no-extensions', '--extension', extension, '--append-system-prompt', start.systemPrompt,
        kickoffFor(task),
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

/** Tears down what a settled TASK leaves checked out: its worktree at the conventional path,
 * and its same-named tmux session on the dedicated server. This is the scheduling pass's
 * move, never the executor's own — the executor's session lives inside the very worktree
 * being removed, and a process cannot safely delete the directory it is running in.
 *
 * The directory is removed directly and `git worktree prune` clears the registration a
 * removed worktree leaves behind, because that registration is itself the collision: a
 * later dispatch of the same name dies on "missing but already registered worktree" until
 * pruned, which is exactly where the first unattended dispatch died. Pruning also covers the
 * residue a failed `git worktree add` leaves — a directory no worktree stands behind — which
 * `git worktree remove` would refuse rather than clear. Killing the session first means the
 * process whose cwd is about to disappear is gone before it does.
 */
export async function teardownTask(cwd: string, task: string): Promise<void> {
  await runIgnoringFailure(tmuxKillSessionCommand(task))
  await rm(worktreePathFor(cwd, task), { recursive: true, force: true })
  await runGit(cwd, ['worktree', 'prune'])
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
