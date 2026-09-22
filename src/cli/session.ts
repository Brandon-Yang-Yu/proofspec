import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from './git.ts'
import { manifestFor } from './queue.ts'

/**
 * The real `startSession` action: a headed,
 * interactive executor session in the harness `PROOFSPEC_EXECUTOR` names, started in the
 * TASK's own worktree. `schedule`'s own core never starts one itself (see its tests) — this
 * is the one place that actually does, using tmux as the one thing on this machine that can
 * hand a real pty to a human without taking over the terminal the scheduling pass itself is
 * running in.
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

/** Where the queue root's own checkout ships the stdio MCP server entry — one repo-relative
 *  path, so the config naming it can never drift from the file it names. */
const MCP_SERVER_ENTRY_PATH = ['src', 'mcp', 'serve.ts'] as const

/** The two harnesses an executor session can run in. Subscription auth lives only inside
 *  the Claude Code harness, and `pi` is the default — the choice is operational
 *  (`PROOFSPEC_EXECUTOR`), never something a TASK or its branch gets a say in. */
type ExecutorName = 'pi' | 'claude'

/** Which harness a dispatched executor session runs in. Anything but `claude` names `pi` —
 *  an unrecognized value must not silently start nothing. */
function executorName(): ExecutorName {
  return process.env.PROOFSPEC_EXECUTOR === 'claude' ? 'claude' : 'pi'
}

/** The one initial user message `pi` is handed as its positional prompt argument. Its exact
 * words are this implementation's own choice; what is not negotiable is that it exists — an
 * unattended session with no first message sits at `pi`'s input box indefinitely, loaded and
 * healthy but doing nothing, because `--append-system-prompt` changes who the model is,
 * never that it should act. Naming the TASK keeps the message self-contained rather than
 * leaning on the `PROOFSPEC_TASK` environment variable alone, and naming the `intentRef`'s
 * one resolution rule — the reserved name `INTENT` from the TASK's own queue entry, any
 * other value from the branch — keeps an executor whose intent stands only in its queue
 * entry from being sent to look for a file its branch does not hold. */
function kickoffFor(task: string): string {
  return `Begin: work your TASK ${task} now - read the MANIFEST's intentRef (the reserved name INTENT names the TASK's own queue entry file .proofspec/dispatch/${task}/INTENT; any other value names a file on this branch), then run the full pipeline through to merge.`
}

/** The tmux command that kills a TASK's session on the dedicated server. One caller now:
 *  `tmuxSessionCommands`, which clears a stale session of the same name before starting a
 *  fresh one — same name, same dedicated server, never the user's own. A settle's kill is
 *  no longer this command called inline; it is the same kill line reached through the
 *  reaper, so that the settle can answer before the session it kills dies. */
export function tmuxKillSessionCommand(task: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(), 'kill-session', '-t', task] }
}

/** The tmux command that lists the sessions standing on the dedicated server. Two readers,
 *  two questions: a scheduling pass counts the lines to learn how many executor sessions are
 *  live (the socket isolation means everything standing there is one this tool started, so
 *  the plain line count is the count), and the docket reads the names to learn whether a
 *  TASK's session is still there to attach to. */
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

/** How many executor sessions stand live on the dedicated server, asked of the server itself
 *  fresh on every call. A server with no sessions — or no server standing at all — answers
 *  zero: that is tmux's own reading of "nothing runs there", not a failure to count. */
export async function liveSessionCount(): Promise<number> {
  const listing = await runForOutput(tmuxListSessionsCommand())
  if (listing === undefined) return 0
  return listing.split('\n').filter(line => line.trim() !== '').length
}

/** Runs a command and answers its stdout when it exits zero, `undefined` when it exits
 *  non-zero — `tmux list-sessions` on a server holding no sessions exits non-zero, which is
 *  the ordinary empty answer rather than a fault, while a command that cannot even start
 *  (no tmux on the machine) rejects like any real fault: a pass that cannot ask the server
 *  must not read its silence as zero. */
function runForOutput(command: TmuxCommand): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.once('error', reject)
    child.once('exit', code => resolve(code === 0 ? stdout : undefined))
  })
}

/** Runs a command and answers its stdout, or the empty string when it could not run. No
 *  special case for a non-zero exit: tmux writes its own failures to stderr, so a failed ask
 *  still answers no sessions on stdout — which every row reads as absent rather than as a
 *  fault. Where `runForOutput` above treats a start failure as a real fault (a scheduling
 *  pass gating on the count must not read silence as zero), this is the docket's read: a view
 *  that cannot ask reports every session absent rather than refusing to answer at all. */
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

/** The one line the session's runner script runs: `pi`'s whole invocation, with every value
 *  that can vary — the extension path, the system prompt, the kickoff — taken from the
 *  session environment rather than spelled out inside it, because a script file is a channel
 *  a shell parses, and only quoted variable references keep arbitrary bytes intact through
 *  it. The system prompt arrives through `$(cat ...)` inside double quotes, where command
 *  substitution output is never word-split or re-parsed, so the persona's backticks,
 *  quotes, `$()`, and redirections reach `pi` as one argument, same bytes. `--approve` and
 *  the pinned `--extension` are what let the executor actually load the tool that reports
 *  to the queue — a freshly created worktree is an unknown path to `pi`'s own project
 *  trust, and `.pi/` being tracked in git means the TASK's own branch can carry a stale (or
 *  missing) copy of `progress.ts`. `--no-extensions` disables `pi`'s own auto-discovery of
 *  the worktree's copy of that same file — without it, `pi` loads both, and refuses to start
 *  at all: two extensions registering the same tool name, `report_task_state`, is a conflict
 *  `pi` treats as fatal, pinned copy or not; the pinned `--extension` path still loads
 *  under `--no-extensions`, same as `pi`'s own help text says an explicit `-e` does. The
 *  trailing `"$PROOFSPEC_KICKOFF"` is the kickoff message from `kickoffFor` above — the
 *  last argument after every flag/value pair, which is exactly how `pi` reads a first
 *  prompt. */
const RUNNER_SCRIPT =
  'exec pi --approve --no-extensions --extension "$PROOFSPEC_PROGRESS_EXTENSION" --append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")" "$PROOFSPEC_KICKOFF"'

/** The same one line for the `claude` harness: the same executor persona
 *  (`--append-system-prompt`, read from the same prompt file), `--dangerously-skip-permissions`
 *  because an unattended session has nobody attached to answer an approval, and a generated
 *  MCP config naming the queue root's own MCP server — the transport that puts the five
 *  tools in the session's hands. The config rides a file for the same size reason every
 *  other payload does, and its path — not its contents — is what the environment carries.
 *  The kickoff rides FIRST, before every flag: `--mcp-config` takes space-separated values,
 *  so a trailing positional after it is read as one more config path and the session dies
 *  before it ever starts. */
const CLAUDE_RUNNER_SCRIPT =
  'exec claude "$PROOFSPEC_KICKOFF" --append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")" --dangerously-skip-permissions --mcp-config "$PROOFSPEC_MCP_CONFIG"'

/** A Claude Code MCP config naming the queue root's own server — the one config every
 *  Claude Code session this product starts is handed (`specs/schedule.md`, `specs/mcp.md`).
 *  The server it names runs from the queue root's own checkout, never the TASK's worktree,
 *  for the same freshness reason the `pi` invocation pins its `--extension`. */
function mcpConfigFor(queueRoot: string): string {
  const server = { command: 'node', args: ['--experimental-transform-types', join(queueRoot, ...MCP_SERVER_ENTRY_PATH)] }
  return `${JSON.stringify({ mcpServers: { proofspec: server } }, null, 2)}\n`
}

/** The files a session start hands its harness through, and their paths: the system prompt
 *  (far past tmux's command-size cap, so it can only ride a file) and the fixed runner script
 *  for the harness the session runs in; the `claude` shape additionally carries the generated
 *  MCP config, whose path — not its contents — is what the environment hands the runner. The
 *  union is discriminated by the harness itself, so which env entries a start command carries
 *  is read off the shape, never re-derived from a field's presence. All files go in a fresh
 *  throwaway directory: a detached session reads them when it starts, possibly after the
 *  process that wrote them is gone, so nothing is left that could clean them up — and
 *  separate directories keep one start from overwriting files a session has yet to read. */
type SessionHandoff =
  | { readonly executor: 'pi'; readonly promptFile: string; readonly runnerScript: string }
  | { readonly executor: 'claude'; readonly promptFile: string; readonly runnerScript: string; readonly mcpConfig: string }

function writeSessionHandoff(executor: ExecutorName, start: SessionStart): SessionHandoff {
  const directory = mkdtempSync(join(tmpdir(), 'proofspec-session-'))
  const promptFile = join(directory, 'system-prompt.txt')
  writeFileSync(promptFile, start.systemPrompt)
  const runnerScript = join(directory, 'runner.sh')
  writeFileSync(runnerScript, `${executor === 'claude' ? CLAUDE_RUNNER_SCRIPT : RUNNER_SCRIPT}\n`)
  if (executor !== 'claude') return { executor: 'pi', promptFile, runnerScript }
  const mcpConfig = join(directory, 'mcp-config.json')
  writeFileSync(mcpConfig, mcpConfigFor(start.queueRoot))
  return { executor: 'claude', promptFile, runnerScript, mcpConfig }
}

/**
 * The tmux commands that (re)start a TASK's executor session in the harness
 * `PROOFSPEC_EXECUTOR` names: killing whatever tmux session already carries the TASK's name
 * before creating a fresh one, so retrying a TASK whose LEASE went stale (schedule's own
 * reclaim requirement) replaces a dead session rather than colliding with its name. The
 * kill is expected to fail the ordinary way — no such session — which is why it is a
 * command of its own rather than folded into one call.
 *
 * The start command's own words are nothing but `sh <runner script>` — a plain path, no
 * metacharacter in it. tmux packs the command words it is handed and refuses ones past its
 * own size cap ("command too long"; the executor persona is far larger), and older tmux runs
 * the joined words through a shell, substituting every metacharacter they carry — so the
 * system prompt, the kickoff, and the harness's own flags can never ride the words. Every
 * payload instead reaches the session through a channel no shell parses as syntax: the `-e`
 * flags set their values verbatim in the session environment (`PROOFSPEC_QUEUE_ROOT` and
 * `PROOFSPEC_TASK` are also how the session later addresses the queue from inside its own
 * worktree, `specs/progress.md`), and the runner script assembles the harness's argv from
 * them, reading the system prompt from its file — so the harness is handed the persona and
 * the kickoff exactly as passed, one argument each, same bytes.
 */
export function tmuxSessionCommands(task: string, start: SessionStart): readonly [kill: TmuxCommand, start: TmuxCommand] {
  const socket = tmuxSocket()
  const handoff = writeSessionHandoff(executorName(), start)
  // Which harness env the session carries follows the handoff's own shape — the harness it
  // was built for is the discriminator, not a field's presence.
  const harnessEnv = handoff.executor === 'claude'
    ? [`-e`, `PROOFSPEC_MCP_CONFIG=${handoff.mcpConfig}`]
    : [`-e`, `PROOFSPEC_PROGRESS_EXTENSION=${join(start.queueRoot, ...PROGRESS_EXTENSION_PATH)}`]
  return [
    tmuxKillSessionCommand(task),
    {
      command: 'tmux',
      args: [
        '-L', socket, 'new-session', '-d', '-s', task, '-c', start.worktree,
        '-e', `PROOFSPEC_QUEUE_ROOT=${start.queueRoot}`, '-e', `PROOFSPEC_TASK=${task}`,
        '-e', `PROOFSPEC_KICKOFF=${kickoffFor(task)}`,
        '-e', `PROOFSPEC_SYSTEM_PROMPT_FILE=${handoff.promptFile}`,
        ...harnessEnv,
        'sh', handoff.runnerScript,
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
 * The real `startSession`: resolves the TASK's own worktree, then starts the harness
 * `PROOFSPEC_EXECUTOR` names there in a detached tmux session named for the TASK, seeded with
 * the executor's own system prompt. A Claude Code session is additionally handed its hook
 * wiring: the harness reports that session's moves through hooks, and the heartbeat those
 * hooks refresh is the Claude Code transport's own limb of the one write (`specs/mcp.md`).
 */
export async function tmuxStartSession(cwd: string, task: string): Promise<void> {
  const worktree = await resolveSessionWorktree(cwd, task)
  const systemPrompt = await executorSystemPrompt(cwd)
  const [kill, start] = tmuxSessionCommands(task, sessionStartFor(cwd, worktree, systemPrompt))
  if (executorName() === 'claude') await writeClaudeHookSettings(worktree, cwd)
  await runIgnoringFailure(kill)
  await runOrThrow(start)
}

/** Where the queue root's own checkout ships the heartbeat CLI entry — one repo-relative
 *  path, so the hook command naming it can never drift from the file it names. */
const HEARTBEAT_ENTRY_PATH = ['src', 'mcp', 'heartbeat.ts'] as const

/** The command line every Claude Code hook runs: the heartbeat CLI entry out of the queue
 *  root's own checkout, the same freshness rule the MCP config carries — run from the main
 *  checkout, never the TASK's own branch's possibly stale copy. */
function heartbeatHookCommand(queueRoot: string): string {
  return `node --experimental-transform-types ${join(queueRoot, ...HEARTBEAT_ENTRY_PATH)}`
}

/**
 * Writes the hook wiring a dispatched Claude Code session runs with: `.claude/settings.json`
 * in the TASK's worktree, running the heartbeat CLI entry on every event the harness reports
 * a session's move through. The `pi` transport needs no wiring of its own — its extension
 * subscribes the same write to its own events — so this file is written only for `claude`.
 */
async function writeClaudeHookSettings(worktree: string, queueRoot: string): Promise<void> {
  const hook = { type: 'command', command: heartbeatHookCommand(queueRoot) }
  const oneEvent = { hooks: [hook] }
  const settings = {
    hooks: {
      UserPromptSubmit: [oneEvent],
      PreToolUse: [oneEvent],
      PostToolUse: [oneEvent],
      Stop: [oneEvent],
    },
  }
  await mkdir(join(worktree, '.claude'), { recursive: true })
  await writeFile(join(worktree, '.claude', 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`)
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
 * and its same-named tmux session on the dedicated server — the session killed not here but
 * by the reaper below, a moment later. That delay is the whole reason this teardown is safe
 * to call from inside the session being killed: the settle answers its caller first, and the
 * host session dies only once the answer is already out.
 *
 * The directory is removed directly and `git worktree prune` clears the registration a
 * removed worktree leaves behind, because that registration is itself the collision: a
 * later dispatch of the same name dies on "missing but already registered worktree" until
 * pruned, which is exactly where the first unattended dispatch died. Pruning also covers the
 * residue a failed `git worktree add` leaves — a directory no worktree stands behind — which
 * `git worktree remove` would refuse rather than clear.
 */
export async function teardownTask(cwd: string, task: string): Promise<void> {
  await rm(worktreePathFor(cwd, task), { recursive: true, force: true })
  await runGit(cwd, ['worktree', 'prune'])
  reapSession(task)
}

/** How many seconds the reaper waits before its kill lands — long enough for the settle's
 *  own answer to reach its caller, short enough that the teardown still lands as one act.
 *  The one number here that is a felt compromise rather than a fact derived from anything. */
const REAP_DELAY_SECONDS = '2'

/** The reaper's script: wait out the delay, then run the kill on the dedicated server. The
 *  three variables arrive through the environment rather than the command line, so a TASK
 *  name can never be read as shell syntax — the values are expanded by the shell, never
 *  parsed by it. */
const REAPER_SCRIPT =
  'sleep "$PROOFSPEC_REAP_SECONDS" && exec tmux -L "$PROOFSPEC_REAP_SOCKET" kill-session -t "$PROOFSPEC_REAP_TASK"'

/** What the reaper will run: the shell line, and the three variables that line reads. Kept
 *  as a pure value — the same reason the tmux start commands are values — so a test can
 *  check which server and which session a settle's kill targets without scheduling it. */
export type ReaperPlan = {
  readonly command: 'sh'
  readonly args: readonly ['-c', string]
  readonly reapEnv: Readonly<Record<string, string>>
}

/** The reaper a settle schedules for `task`: `sh`, the delay script, and the variables it
 *  reads — the socket resolved here, at scheduling time, from the same override every other
 *  tmux command honors. */
export function reaperFor(task: string): ReaperPlan {
  return {
    command: 'sh',
    args: ['-c', REAPER_SCRIPT],
    reapEnv: {
      PROOFSPEC_REAP_SECONDS: REAP_DELAY_SECONDS,
      PROOFSPEC_REAP_SOCKET: tmuxSocket(),
      PROOFSPEC_REAP_TASK: task,
    },
  }
}

/** Schedules the TASK's session kill: a process of its own, detached from this one, that
 *  waits out the delay and then runs the kill. Detached and unref'd, it survives both the
 *  process that scheduled it and the session it kills — which is the point: the caller of a
 *  settle is usually the very session being killed, so nothing that session owns can be the
 *  one holding the kill. */
function reapSession(task: string): void {
  const plan = reaperFor(task)
  const child = spawn(plan.command, [...plan.args], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...plan.reapEnv },
  })
  child.unref()
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
