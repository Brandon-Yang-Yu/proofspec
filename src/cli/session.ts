import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { settingsOrThrow } from '../settings.ts'
import { queueRootDigest } from './digest.ts'
import { runGit } from './git.ts'
import { executorRecordPath, manifestFor } from './queue.ts'
import type { ExecutorName } from './queue.ts'

/**
 * The real `startSession` action: a headed,
 * interactive executor session in the TASK's harness — the one its queue entry's executor
 * record names, else the one the settings file names — started in the TASK's own
 * worktree. `schedule`'s own core never starts one itself (see its tests) — this
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
 * this repo's tooling keeps, the same as `DEFAULT_JUDGE_AGENT` (`cli/judge.ts`), not
 * something a TASK's own branch gets to redefine for itself.
 */
async function executorSystemPrompt(cwd: string): Promise<string> {
  const raw = await readFile(join(cwd, ...EXECUTOR_PERSONA_PATH), 'utf8')
  return promptBodyFrom(raw)
}

/**
 * Which tmux server every command here targets — a dedicated one via `-L`, never the user's
 * default server or any other named one. tmux sessions are global to the whole machine, not
 * scoped to any directory or project: `kill-session -t <name>` on the default server kills
 * whatever real session already has that name, whoever it belongs to. The default name is
 * derived from the queue root — `proofspec-` plus the first 8 hex digits of the root's
 * SHA-256 digest — so every repo on the machine gets a server of its own while the same
 * repo always reaches the same one, and no two checkouts share a fixed name. Overridable by
 * `PROOFSPEC_TMUX_SOCKET`, so a test (or a future acceptance check) can point at a
 * throwaway, per-run socket instead of ever touching the repo's own production one, let
 * alone the user's.
 */
function tmuxSocket(queueRoot: string): string {
  const override = process.env.PROOFSPEC_TMUX_SOCKET
  if (override !== undefined) return override
  return `proofspec-${queueRootDigest(queueRoot).slice(0, 8)}`
}

const PROGRESS_EXTENSION_PATH = ['.pi', 'extensions', 'progress.ts'] as const

/** Where the installed `pi` package itself ships the `subagent` extension — under the queue
 *  root's `node_modules`, never a file under `.pi/extensions/`. pi injects the virtual modules
 *  that example imports only into an entry extension file, so a wrapper under
 *  `.pi/extensions/` re-exporting it hangs pi at startup, silently (measured three ways);
 *  pinning the package's own copy also keeps the extension and the pi that runs it from
 *  drifting apart — they version together. */
const SUBAGENT_EXTENSION_PATH = ['node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'subagent', 'index.ts'] as const

/** Where ProofSpec's own checkout ships the stdio MCP server entry — TypeScript source,
 *  so the config naming it also carries the transform flag node needs to run it. */
const CHECKOUT_SERVER_ENTRY_PATH = ['src', 'mcp', 'serve.ts'] as const

/** Where an installed ProofSpec package ships the built stdio MCP server entry. Built
 *  JavaScript, not `node_modules/proofspec/src/mcp/serve.ts`: node strips no types from a
 *  `.ts` file under `node_modules`, so a project that installed ProofSpec has no source
 *  entry it can run. */
const INSTALLED_SERVER_ENTRY_PATH = ['node_modules', 'proofspec', 'dist', 'mcp', 'serve.js'] as const

/** The harness a TASK's queue entry records for it, or nothing when the entry holds no
 *  record naming one. Trimmed, because a record written by hand ends in a newline; any other
 *  word counts as no record, so a typo falls back to the operator's choice rather than
 *  starting nothing. */
function recordedExecutor(queueRoot: string, task: string): ExecutorName | undefined {
  let record: string
  try {
    record = readFileSync(executorRecordPath(queueRoot, task), 'utf8').trim()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (record === 'pi' || record === 'claude') return record
  return undefined
}

/** Which harness a TASK's executor session runs in: the TASK's own record first — a TASK
 *  moved to claude stays there through every later start, a start by hand included — then
 *  the `executor` the settings file at the queue root names, `pi` when it names none. The
 *  file is read even when a record decides, so a broken settings file stops every start
 *  loudly, naming the file, rather than only the starts that happen to consult it. */
function executorFor(queueRoot: string, task: string): ExecutorName {
  const settings = settingsOrThrow(queueRoot)
  return recordedExecutor(queueRoot, task) ?? settings.executor
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

/** The tmux command that kills a TASK's session on the dedicated server — the server named
 *  by the queue root the session lives under. One caller now: `tmuxSessionCommands`, which
 *  clears a stale session of the same name before starting a fresh one — same name, same
 *  dedicated server, never the user's own. A settle's kill is no longer this command called
 *  inline; it is the same kill line reached through the reaper, so that the settle can
 *  answer before the session it kills dies. */
export function tmuxKillSessionCommand(task: string, queueRoot: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(queueRoot), 'kill-session', '-t', task] }
}

/** The list-sessions command against a socket already resolved. */
function listSessionsOn(socket: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', socket, 'list-sessions'] }
}

/** The tmux command that lists the sessions standing on the dedicated server — the server
 *  named by the queue root it is built from. Two readers, two questions: a scheduling pass
 *  counts the lines to learn how many executor sessions are live (the socket isolation means
 *  everything standing there is one this tool started, so the plain line count is the
 *  count), and the docket reads the names to learn whether a TASK's session is still there
 *  to attach to. */
export function tmuxListSessionsCommand(queueRoot: string): TmuxCommand {
  return listSessionsOn(tmuxSocket(queueRoot))
}

/** The exact command a person runs to attach to a TASK's session on the dedicated server —
 *  the one line the docket carries for every session the server still holds, built from the
 *  queue root that server is named by. */
export function tmuxAttachCommand(task: string, queueRoot: string): TmuxCommand {
  return { command: 'tmux', args: ['-L', tmuxSocket(queueRoot), 'attach-session', '-t', task] }
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

/** The session names the dedicated server holds — the server named by the queue root — or
 *  none when the server holds no session at all: a server with nothing on it is the docket's
 *  ordinary every-session-absent case, not a fault worth surfacing. */
export async function listTmuxSessions(queueRoot: string): Promise<readonly string[]> {
  return parseSessionNames(await capture(tmuxListSessionsCommand(queueRoot)))
}

/** How many executor sessions stand live on the dedicated server, asked of the server itself
 *  fresh on every call. The server is the one the queue root names — the same socket the
 *  start commands use, so what is counted is what this tool started, repo by repo — or the
 *  one `PROOFSPEC_TMUX_SOCKET` names instead. A server with no sessions — or no server
 *  standing at all — answers zero: that is tmux's own reading of "nothing runs there", not
 *  a failure to count. */
export async function liveSessionCount(queueRoot: string): Promise<number> {
  const listing = await runForOutput(listSessionsOn(tmuxSocket(queueRoot)))
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
 *  that can vary — the extension paths, the system prompt, the kickoff — taken from the
 *  session environment rather than spelled out inside it, because a script file is a channel
 *  a shell parses, and only quoted variable references keep arbitrary bytes intact through
 *  it. The system prompt arrives through `$(cat ...)` inside double quotes, where command
 *  substitution output is never word-split or re-parsed, so the persona's backticks,
 *  quotes, `$()`, and redirections reach `pi` as one argument, same bytes. `--approve` and
 *  the pinned `--extension`s are what let the executor actually load the tools it works
 *  with — `--approve` because a freshly created worktree is an unknown path to `pi`'s own
 *  project trust; the `progress.ts` pin because `.pi/` being tracked in git means the
 *  TASK's own branch can carry a stale (or missing) copy; the `subagent` pin because the
 *  executor's work reaches its personas through fresh subagents, and it points into
 *  `node_modules` for the reason `SUBAGENT_EXTENSION_PATH` records. `--no-extensions`
 *  disables `pi`'s own auto-discovery of the worktree's own copy of `progress.ts` — without
 *  it, `pi` loads both, and refuses to start at all: two extensions registering the same
 *  tool name, `report_task_state`, is a conflict `pi` treats as fatal, pinned copy or not.
 *  The two pinned paths coexist (no tool-name overlap between them), and both still load
 *  under `--no-extensions`, same as `pi`'s own help text says an explicit `-e` does. The
 *  trailing `"$PROOFSPEC_KICKOFF"` is the kickoff message from `kickoffFor` above — the
 *  last argument after every flag/value pair, which is exactly how `pi` reads a first
 *  prompt. */
const RUNNER_SCRIPT =
  'exec pi --approve --no-extensions --extension "$PROOFSPEC_PROGRESS_EXTENSION" --extension "$PROOFSPEC_SUBAGENT_EXTENSION" --append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")" "$PROOFSPEC_KICKOFF"'

/** The same one line for the `claude` harness: the same executor persona
 *  (`--append-system-prompt`, read from the same prompt file), `--dangerously-skip-permissions`
 *  because an unattended session has nobody attached to answer an approval, and a generated
 *  MCP config naming the MCP server the queue root holds — the transport that puts the five
 *  tools in the session's hands. The config rides a file for the same size reason every
 *  other payload does, and its path — not its contents — is what the environment carries.
 *  The kickoff rides FIRST, before every flag: `--mcp-config` takes space-separated values,
 *  so a trailing positional after it is read as one more config path and the session dies
 *  before it ever starts. */
const CLAUDE_RUNNER_SCRIPT =
  'exec claude "$PROOFSPEC_KICKOFF" --append-system-prompt "$(cat "$PROOFSPEC_SYSTEM_PROMPT_FILE")" --dangerously-skip-permissions --mcp-config "$PROOFSPEC_MCP_CONFIG"'

/** Whether the queue root is ProofSpec's own checkout rather than a project that installed
 *  ProofSpec — read off the root's `package.json` name, the one fact that names the checkout
 *  itself rather than anything installed under it. No readable `package.json`, or one whose
 *  name is anything else, reads as an installing project: the config then names the built
 *  server under `node_modules`, the only ProofSpec copy such a root holds. */
function isProofspecCheckout(queueRoot: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(queueRoot, 'package.json'), 'utf8')) as { name?: unknown }
    return manifest.name === 'proofspec'
  } catch {
    return false
  }
}

/** A Claude Code MCP config naming the server the queue root actually holds (`specs/mcp.md`)
 *  — always under the queue root, never a copy inside the TASK's worktree, for the same
 *  freshness reason the `pi` invocation pins its `--extension`. ProofSpec's own checkout
 *  names its TypeScript entry under `--experimental-transform-types`; any other queue root
 *  names the installed package's built server, run by plain `node` because it is built
 *  JavaScript. */
function mcpConfigFor(queueRoot: string): string {
  const args = isProofspecCheckout(queueRoot)
    ? ['--experimental-transform-types', join(queueRoot, ...CHECKOUT_SERVER_ENTRY_PATH)]
    : [join(queueRoot, ...INSTALLED_SERVER_ENTRY_PATH)]
  const server = { command: 'node', args }
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
 * The tmux commands that (re)start a TASK's executor session in the TASK's harness
 * (`executorFor`): killing whatever tmux session already carries the TASK's name
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
 * worktree, `specs/progress.md` — and the queue root is where the session's tools find the
 * project's settings file, so no setting rides the environment), and the runner script assembles the harness's argv from them, reading the system prompt
 * from its file — so the harness is handed the persona and the kickoff exactly as passed,
 * one argument each, same bytes.
 */
export function tmuxSessionCommands(task: string, start: SessionStart): readonly [kill: TmuxCommand, start: TmuxCommand] {
  return sessionCommandsFor(task, { start, executor: executorFor(start.queueRoot, task) })
}

/** `tmuxSessionCommands` with the harness already resolved, so `tmuxStartSession` builds the
 *  commands and decides the hook wiring from one read of the TASK's record, never two that
 *  could disagree. */
function sessionCommandsFor(
  task: string,
  session: { readonly start: SessionStart; readonly executor: ExecutorName },
): readonly [kill: TmuxCommand, start: TmuxCommand] {
  const { start, executor } = session
  const socket = tmuxSocket(start.queueRoot)
  const handoff = writeSessionHandoff(executor, start)
  // Which harness env the session carries follows the handoff's own shape — the harness it
  // was built for is the discriminator, not a field's presence.
  const harnessEnv = handoff.executor === 'claude'
    ? [`-e`, `PROOFSPEC_MCP_CONFIG=${handoff.mcpConfig}`]
    : [
      `-e`, `PROOFSPEC_PROGRESS_EXTENSION=${join(start.queueRoot, ...PROGRESS_EXTENSION_PATH)}`,
      `-e`, `PROOFSPEC_SUBAGENT_EXTENSION=${join(start.queueRoot, ...SUBAGENT_EXTENSION_PATH)}`,
    ]
  return [
    tmuxKillSessionCommand(task, start.queueRoot),
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
 * The real `startSession`: resolves the TASK's own worktree, then starts the TASK's harness
 * (`executorFor`) there in a detached tmux session named for the TASK, seeded with
 * the executor's own system prompt. A Claude Code session is additionally handed its hook
 * wiring: the harness reports that session's moves through hooks, and the heartbeat those
 * hooks refresh is the Claude Code transport's own limb of the one write (`specs/mcp.md`).
 */
export async function tmuxStartSession(cwd: string, task: string): Promise<void> {
  const worktree = await resolveSessionWorktree(cwd, task)
  const systemPrompt = await executorSystemPrompt(cwd)
  const executor = executorFor(cwd, task)
  const [kill, start] = sessionCommandsFor(task, { start: sessionStartFor(cwd, worktree, systemPrompt), executor })
  if (executor === 'claude') await writeClaudeHookSettings(worktree, cwd)
  await runIgnoringFailure(kill)
  await runOrThrow(start)
}

/** Where ProofSpec's own checkout ships the heartbeat CLI entry — TypeScript source,
 *  so the hook command naming it also carries the transform flag node needs to run it. */
const CHECKOUT_HEARTBEAT_ENTRY_PATH = ['src', 'mcp', 'heartbeat.ts'] as const

/** Where an installed ProofSpec package ships the built heartbeat CLI entry — the same
 *  built-JavaScript rule `INSTALLED_SERVER_ENTRY_PATH` carries: node strips no types from
 *  a `.ts` file under `node_modules`, so a project that installed ProofSpec has no source
 *  entry it can run. */
const INSTALLED_HEARTBEAT_ENTRY_PATH = ['node_modules', 'proofspec', 'dist', 'mcp', 'heartbeat.js'] as const

/** The provider-error CLI entry's two homes, the heartbeat's siblings under the same
 *  two-kind rule. */
const CHECKOUT_PROVIDER_ERROR_ENTRY_PATH = ['src', 'mcp', 'provider-error.ts'] as const
const INSTALLED_PROVIDER_ERROR_ENTRY_PATH = ['node_modules', 'proofspec', 'dist', 'mcp', 'provider-error.js'] as const

/** The command line a Claude Code hook runs for one CLI entry the queue root holds — that
 *  checkout's own TypeScript entry when the root is ProofSpec's own checkout, the installed
 *  package's built entry otherwise — the same two-kind rule and freshness rule the MCP
 *  config carries: run from the queue root, never the TASK's own branch's possibly stale
 *  copy. */
function hookCommandFor(
  queueRoot: string,
  entry: { readonly checkout: readonly string[]; readonly installed: readonly string[] },
): string {
  const args = isProofspecCheckout(queueRoot)
    ? ['--experimental-transform-types', join(queueRoot, ...entry.checkout)]
    : [join(queueRoot, ...entry.installed)]
  return `node ${args.join(' ')}`
}

/** The events Claude Code reports a session's moves through — the hook-bearing
 *  counterparts of the `pi` transport's observable moves, and the four events a dispatch
 *  wires the heartbeat entry to. */
const REPORTED_MOVE_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'] as const

/** The settings file a dispatched Claude Code session reads its hooks from, relative to
 *  the TASK's worktree. */
const CLAUDE_SETTINGS_PATH = ['.claude', 'settings.json'] as const

/** The settings standing in the TASK's worktree, or nothing while none stands. A file
 *  that does not parse reads as no settings at all — a `.claude/settings.json` Claude
 *  Code itself could not load carries no keys worth preserving, and the heartbeat's
 *  wiring must not be held hostage to it. */
async function readClaudeSettings(worktree: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(worktree, ...CLAUDE_SETTINGS_PATH), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

/** A JSON object, as opposed to an array, a string, or any other JSON value. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether any group under one event already carries a command hook running `command` —
 *  the shape a dispatch checks before appending its own group, so a re-dispatch of a TASK
 *  whose worktree is reused adds no second copy of any hook it wires. */
function carriesCommandHook(groups: readonly unknown[], command: string): boolean {
  return groups.some(group => {
    if (!isJsonObject(group) || !Array.isArray(group.hooks)) return false
    return group.hooks.some(hook => isJsonObject(hook) && hook.command === command)
  })
}

/** The event Claude Code fires when a turn ends on an API error — the provider-error
 *  entry's one event. */
const PROVIDER_ERROR_EVENT = 'StopFailure'

/** One command hook a dispatch wires, and the events it joins. */
type HookWiring = { readonly events: readonly string[]; readonly command: string }

/** The hook wiring merged into the settings already standing: every key outside `hooks`
 *  and every event's existing groups stand as they were, and each wiring's own group joins
 *  each of its events — appended when the event does not already run that command, left
 *  alone when it does. */
function mergeHookSettings(existing: unknown, wirings: readonly HookWiring[]): Record<string, unknown> {
  const base = isJsonObject(existing) ? existing : {}
  const hooks = isJsonObject(base.hooks) ? base.hooks : {}
  const mergedHooks: Record<string, unknown> = { ...hooks }
  for (const wiring of wirings) {
    const group = { hooks: [{ type: 'command', command: wiring.command }] }
    for (const event of wiring.events) {
      const standing = mergedHooks[event]
      const groups = Array.isArray(standing) ? standing : []
      mergedHooks[event] = carriesCommandHook(groups, wiring.command) ? groups : [...groups, group]
    }
  }
  return { ...base, hooks: mergedHooks }
}

/**
 * Writes the hook wiring a dispatched Claude Code session runs with: `.claude/settings.json`
 * in the TASK's worktree, running the heartbeat CLI entry on every event the harness reports
 * a session's move through, and the provider-error CLI entry on `StopFailure`, so a session
 * whose provider refuses it parks its TASK for a human rather than hanging. Merged, never
 * replaced: the worktree's settings file is the project's own committed one — a project may wire its own hooks there beside whatever a
 * session adds — and the executor commits the worktree's file, so a replacement would ride
 * the TASK's own merge into the project's history as an erasure of its settings. The `pi`
 * transport needs no wiring of its own — its extension subscribes the same write to its own
 * events — so this file is written only for `claude`.
 */
async function writeClaudeHookSettings(worktree: string, queueRoot: string): Promise<void> {
  const heartbeat = hookCommandFor(queueRoot, { checkout: CHECKOUT_HEARTBEAT_ENTRY_PATH, installed: INSTALLED_HEARTBEAT_ENTRY_PATH })
  const providerError = hookCommandFor(queueRoot, { checkout: CHECKOUT_PROVIDER_ERROR_ENTRY_PATH, installed: INSTALLED_PROVIDER_ERROR_ENTRY_PATH })
  const settings = mergeHookSettings(await readClaudeSettings(worktree), [
    { events: REPORTED_MOVE_EVENTS, command: heartbeat },
    { events: [PROVIDER_ERROR_EVENT], command: providerError },
  ])
  await mkdir(join(worktree, '.claude'), { recursive: true })
  await writeFile(join(worktree, ...CLAUDE_SETTINGS_PATH), `${JSON.stringify(settings, null, 2)}\n`)
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
  reapSession(cwd, task)
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
 *  reads — the socket resolved here, at scheduling time, from the queue root the settle runs
 *  against, the same derivation every other tmux command honors, and the one
 *  `PROOFSPEC_TMUX_SOCKET` overrides. */
export function reaperFor(task: string, queueRoot: string): ReaperPlan {
  return {
    command: 'sh',
    args: ['-c', REAPER_SCRIPT],
    reapEnv: {
      PROOFSPEC_REAP_SECONDS: REAP_DELAY_SECONDS,
      PROOFSPEC_REAP_SOCKET: tmuxSocket(queueRoot),
      PROOFSPEC_REAP_TASK: task,
    },
  }
}

/** Schedules the TASK's session kill: a process of its own, detached from this one, that
 *  waits out the delay and then runs the kill. Detached and unref'd, it survives both the
 *  process that scheduled it and the session it kills — which is the point: the caller of a
 *  settle is usually the very session being killed, so nothing that session owns can be the
 *  one holding the kill. */
function reapSession(cwd: string, task: string): void {
  const plan = reaperFor(task, cwd)
  const child = spawn(plan.command, [...plan.args], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...plan.reapEnv },
  })
  child.unref()
}

/** Runs a command, throwing when it could not even start or exited non-zero — unlike the kill
 * above, `tmux new-session` failing is a real fault (tmux missing, a broken server) worth
 * surfacing rather than silently reporting a session that was never actually started. The
 * thrown message carries tmux's own stderr, the same standard a failed worktree creation
 * keeps — a bare exit-code summary names no cause, and the causes tmux names (a socket
 * directory that is not a directory, say) are actionable. */
function runOrThrow(command: TmuxCommand): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
    // `close`, not `exit`: `exit` can fire while the stderr stream is still open, and a
    // truncated cause is the name-no-cause summary this throw exists to replace.
    child.once('close', code => {
      if (code === 0) resolve()
      else {
        const cause = stderr.trim()
        reject(new Error(cause === '' ? commandLine(command) : `${commandLine(command)}: ${cause}`))
      }
    })
  })
}
