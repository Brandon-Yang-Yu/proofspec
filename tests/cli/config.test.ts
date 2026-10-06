// Capability: cli

// The one reading every tool will share: `.proofspec/config.json` at the queue root. The
// value-level scenarios (what a missing key or unusable value falls back to) drive the reading
// where it will live — `src/settings.ts` — while every scenario about which file decides, or
// what a setting does, drives the real surfaces: the session start command, `touched`,
// `schedule`, the judge run from inside a git main checkout the way the bare CLI runs it, and
// the session's own settle_task and census_in_flight tools through the tool core.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { touched, schedule } from '../../src/cli/index.ts'
import type { Outcome, TouchedSummary } from '../../src/cli/index.ts'
import { DEFAULT_JUDGE_TIMEOUT_MS, piJudge } from '../../src/cli/judge.ts'
import { tmuxSessionCommands, tmuxStartSession } from '../../src/cli/session.ts'
import type { TmuxCommand } from '../../src/cli/session.ts'
import { createToolCore } from '../../src/mcp/core.ts'
import { DEFAULT_MAX_SESSIONS } from '../../src/schedule/index.ts'
import type { JudgeVerdict, RelationshipJudgeInput } from '../../src/schedule/index.ts'
import { CAPABILITY, cleanupRepos, enterTask, makeGitRepo, makeRepo, specFile, testFile, TEST_PATH } from './support.ts'

const execFileAsync = promisify(execFile)

// Every settle here targets this throwaway socket — the detached scheduling pass a settle
// fires included — so nothing in this file can reach a real session on the production socket.
// Set once for the whole file, the same convention tests/cli/base-branch.test.ts keeps.
const SOCKET = 'proofspec-config-test'
process.env.PROOFSPEC_TMUX_SOCKET = SOCKET

// The variables this file sets, or that the session running the suite may already carry (an
// executor session runs with PROOFSPEC_QUEUE_ROOT pointing at the real queue): cleared before
// the first test and after every one, so no test reads a value it did not set itself.
const VARIABLES = [
  'PROOFSPEC_EXECUTOR',
  'PROOFSPEC_BASE_BRANCH',
  'PROOFSPEC_JUDGE_BIN',
  'PROOFSPEC_JUDGE_TIMEOUT_MS',
  'PROOFSPEC_MAX_SESSIONS',
  'PROOFSPEC_QUEUE_ROOT',
  'PROOFSPEC_TASK',
] as const
function clearVariables(): void {
  for (const name of VARIABLES) delete process.env[name]
}
clearVariables()

// PATH and cwd are only ever changed around one call and restored whole here too — a stand-in
// dir left on PATH, or a cwd left inside a deleted repo, would leak into every later test.
const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_CWD = process.cwd()
let standInDirs: string[] = []

afterEach(() => {
  process.chdir(ORIGINAL_CWD)
  process.env.PATH = ORIGINAL_PATH
  clearVariables()
})
afterEach(cleanupRepos)
afterEach(async () => {
  await Promise.all(standInDirs.map(dir => rm(dir, { recursive: true, force: true })))
  standInDirs = []
})
afterEach(async () => {
  await execFileAsync('tmux', ['-L', SOCKET, 'kill-server']).catch(() => {})
})

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'

/** A repo whose test and capability file agree, the shape tests/cli/touched.test.ts builds. */
function inSync(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [FIRST, SECOND] }),
    [TEST_PATH]: testFile([FIRST, SECOND]),
  }
}

/** The fixture's test file with one line inside the first proof's body rewritten. */
function bodyEdited(): string {
  return testFile([FIRST, SECOND]).replace('  expect(true).toBe(true)', '  expect(1 + 1).toBe(2)')
}

/** A capability file holding two named requirements, each with its own description. */
function twoRequirementSpec(first: string, second: string): string {
  return [
    '# cli',
    '',
    '### Requirement: A first requirement',
    '',
    first,
    '',
    '### Requirement: A second requirement',
    '',
    second,
    '',
  ].join('\n')
}

/** Writes a queue entry for a TASK carrying no `blocked`, under the given root. */
async function queueTask(root: string, task: string, state: string): Promise<void> {
  const entry = join(root, '.proofspec', 'dispatch', task)
  await mkdir(entry, { recursive: true })
  await writeFile(join(entry, 'MANIFEST'), JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}` }))
  await writeFile(join(entry, 'state'), state)
}

function summaryOf(outcome: Outcome): TouchedSummary {
  if (outcome.kind !== 'touched') throw new Error(`expected a touched report, got ${outcome.kind}`)
  if (outcome.report.kind !== 'summary') throw new Error(`expected the work list, got ${outcome.report.kind}`)
  return outcome.report
}

/** Settings as a test writes them: a whole file's contents, no file at all, or a file standing
 *  there that is not valid JSON. */
type SettingsFile = Readonly<Record<string, unknown>> | 'no file' | 'not valid JSON'

/** The bytes a settings file that is not valid JSON holds. */
const NOT_JSON = '{ not valid JSON'

async function writeSettingsInto(root: string, settings: SettingsFile): Promise<void> {
  if (settings === 'no file') return
  await mkdir(join(root, '.proofspec'), { recursive: true })
  const bytes = settings === 'not valid JSON' ? NOT_JSON : JSON.stringify(settings)
  await writeFile(join(root, '.proofspec', 'config.json'), bytes)
}

/** The start command's own command words are `sh <runner script path>` — the harness's whole
 *  invocation lives in that script's content, so which executor a build chose is read from
 *  the file those words name (the same read tests/schedule/session.test.ts makes). */
async function runnerScriptFrom(start: TmuxCommand): Promise<string> {
  const scriptPath = start.args[start.args.indexOf('sh') + 1]
  expect(scriptPath).toBeDefined()
  return readFile(scriptPath!, 'utf8')
}

/** The harness a session start command built under a queue root holding these settings
 *  runs — the word its runner script execs. */
async function executorStartedUnder(settings: SettingsFile): Promise<string> {
  const queue = await makeRepo({ '.proofspec/dispatch/a/state': 'building' })
  await writeSettingsInto(queue.root, settings)
  const [, start] = tmuxSessionCommands('a', { worktree: `${queue.root}/.proofspec/worktrees/a`, queueRoot: queue.root, systemPrompt: '' })
  const script = await runnerScriptFrom(start)
  return /^exec (\S+)/.exec(script.trim())?.[1] ?? `no exec line in: ${script}`
}

/** The branch `touched` measured from, run in a repo's main checkout holding these settings:
 *  a development branch bDev moved past main, and the checked-out TASK branch cut from bDev,
 *  so where the branch left bDev and where it left main are two different commits. */
async function branchTouchedMeasuredFrom(settings: SettingsFile): Promise<string> {
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'bDev'])
  await repo.write('docs/dev.md', 'the development branch moves past main\n')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the development branch moves past main'])
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await writeSettingsInto(repo.root, settings)
  const leftAt: Readonly<Record<string, string>> = {
    [await repo.git(['merge-base', 'work', 'main'])]: 'main',
    [await repo.git(['merge-base', 'work', 'bDev'])]: 'bDev',
  }

  const base = summaryOf(await touched({ cwd: repo.root })).base
  return leftAt[base] ?? `an unnamed commit ${base}`
}

/** The sessions one scheduling pass starts out of five ready TASKs, run in a repo's main
 *  checkout holding these settings — the live count grown by each session the pass has
 *  itself started, so the bound alone decides where the pass stops. */
async function sessionsAPassStartsUnder(settings: SettingsFile): Promise<{ started: readonly string[]; deferred: readonly string[] }> {
  const repo = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  for (const task of ['a', 'b', 'c', 'd', 'e']) await enterTask(repo, task, { edit: 'specs/cli.md' })
  await writeSettingsInto(repo.root, settings)
  const started: string[] = []
  const pass = await schedule({
    cwd: repo.root,
    schedule: {
      startSession: async task => {
        started.push(task)
      },
      countSessions: async () => started.length,
      judge: async () => ({ kind: 'resolved' }),
      notifyHuman: async () => {},
    },
  })
  if (pass.kind !== 'scheduled') throw new Error(`expected a scheduled report, got ${pass.kind}`)
  return { started: pass.report.started, deferred: pass.report.deferred }
}

/** A capability file holding three named requirements, each with its own description. */
function threeRequirementSpec(first: string, second: string, third: string): string {
  return [
    '# cli',
    '',
    '### Requirement: A first requirement',
    '',
    first,
    '',
    '### Requirement: A second requirement',
    '',
    second,
    '',
    '### Requirement: A third requirement',
    '',
    third,
    '',
  ].join('\n')
}

/** The three branches a base can name in `branchesTheSessionToolsAndAPassMeasureBy`. */
type MeasuredBranch = 'main' | 'bDev' | 'trunk'

/** A repo whose main checkout holds these settings, built so the census, settle_task, and a
 *  scheduling pass each answer differently against main, bDev, and trunk:
 *  - bDev is cut from main and rewrites the first requirement; trunk is cut from bDev and
 *    rewrites the second; the in-flight TASK `censused` is cut from trunk and rewrites the
 *    third — so measured against trunk the census answers the third requirement alone,
 *    against bDev the second and third, and against main all three;
 *  - three mergeable TASKs each landed in exactly one of the three branches, and in neither
 *    other — so the one TASK a settle accepts names the branch it measured by. */
async function measuringRepo(settings: SettingsFile) {
  const repo = await makeGitRepo({ 'specs/cli.md': threeRequirementSpec('First, original.', 'Second, original.', 'Third, original.') })
  await repo.git(['checkout', '-b', 'bDev'])
  await repo.write('specs/cli.md', threeRequirementSpec('First, as bDev rewrote it.', 'Second, original.', 'Third, original.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'bDev rewrites the first'])
  await repo.git(['checkout', '-b', 'trunk'])
  await repo.write('specs/cli.md', threeRequirementSpec('First, as bDev rewrote it.', 'Second, as trunk rewrote it.', 'Third, original.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'trunk rewrites the second'])
  await repo.git(['checkout', '-b', 'work/censused'])
  await repo.write('specs/cli.md', threeRequirementSpec('First, as bDev rewrote it.', 'Second, as trunk rewrote it.', 'Third, as the TASK rewrote it.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK rewrites the third'])
  // Each landing TASK is cut from its branch and merged back into it after every other
  // branch was cut, so it is an ancestor of that branch alone.
  for (const branch of ['main', 'bDev', 'trunk'] as const) {
    const task = `landed-in-${branch}`
    await repo.git(['checkout', branch])
    await repo.git(['checkout', '-b', `work/${task}`])
    await repo.write(`${task}.txt`, `landed in ${branch}\n`)
    await repo.git(['add', `${task}.txt`])
    await repo.git(['commit', '-m', `${task} edits`])
    await repo.git(['checkout', branch])
    await repo.git(['merge', `work/${task}`])
  }
  await repo.git(['checkout', 'main'])
  // The queue entries and the settings file are written after the last checkout, so they
  // stand only in the main checkout, untracked by any branch.
  await queueTask(repo.root, 'censused', 'mergeable')
  for (const branch of ['main', 'bDev', 'trunk'] as const) await queueTask(repo.root, `landed-in-${branch}`, 'mergeable')
  await writeSettingsInto(repo.root, settings)
  return repo
}

/** The branch each of the three remaining places measured against, under a repo's main
 *  checkout holding these settings: the census and settle_task as a session calls them,
 *  handed the queue root in PROOFSPEC_QUEUE_ROOT, and a scheduling pass run in a second such
 *  repo's main checkout the way a person runs it — with no queue root handed, so only the
 *  settings in the pass's own main checkout can decide its answer — read off which
 *  requirements the census answers, and which landed TASK the settle and the pass each settle. */
async function branchesTheSessionToolsAndAPassMeasureBy(settings: SettingsFile): Promise<{ census: string; settleTask: string; pass: string }> {
  const answeredBy: Readonly<Record<string, MeasuredBranch>> = {
    'A third requirement': 'trunk',
    'A second requirement,A third requirement': 'bDev',
    'A first requirement,A second requirement,A third requirement': 'main',
  }
  const toolsRepo = await measuringRepo(settings)
  process.env.PROOFSPEC_QUEUE_ROOT = toolsRepo.root
  const core = createToolCore({ fireSchedulingPass: async () => {} })
  try {
    const census = await core.call('census_in_flight', {}, toolsRepo.root) as { ok: boolean; census?: { tasks: { task: string; capabilities: { requirements: { requirement: string }[] }[] }[] } }
    const censused = census.census?.tasks.find(one => one.task === 'censused')
    const answered = (censused?.capabilities ?? []).flatMap(one => one.requirements.map(requirement => requirement.requirement)).sort().join(',')

    const settledByTool: string[] = []
    for (const branch of ['main', 'bDev', 'trunk'] as const) {
      process.env.PROOFSPEC_TASK = `landed-in-${branch}`
      const settle = await core.call('settle_task', {}, toolsRepo.root) as { ok: boolean }
      if (settle.ok) settledByTool.push(branch)
    }

    // The pass is a command a person runs: no session hand-off stands in its environment, so
    // the repo the session tools were handed is out of its reach.
    delete process.env.PROOFSPEC_QUEUE_ROOT
    delete process.env.PROOFSPEC_TASK
    const passRepo = await measuringRepo(settings)
    const pass = await schedule({
      cwd: passRepo.root,
      schedule: {
        startSession: async () => {},
        countSessions: async () => 0,
        judge: async () => ({ kind: 'resolved' }),
        notifyHuman: async () => {},
      },
    })
    if (pass.kind !== 'scheduled') throw new Error(`expected a scheduled report, got ${pass.kind}`)
    const mergedByPass = pass.report.merged.map(task => task.replace(/^landed-in-/, ''))

    return {
      census: answeredBy[answered] ?? `an unnamed answer: ${answered}`,
      settleTask: settledByTool.join(',') || 'no landed TASK settled',
      pass: mergedByPass.join(',') || 'no landed TASK settled',
    }
  } finally {
    delete process.env.PROOFSPEC_QUEUE_ROOT
    delete process.env.PROOFSPEC_TASK
  }
}

/** A stand-in program on disk: it leaves `<path>.started` the moment it runs, then runs
 *  `rest` — so which program the judge ran is read off the disk, never by spawning a real
 *  harness to find out. */
async function standIn(dir: string, name: string, rest: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\ntouch ${JSON.stringify(`${path}.started`)}\n${rest}\n`)
  await chmod(path, 0o755)
  return path
}

async function standInDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'proofspec-config-standin-'))
  standInDirs.push(dir)
  return dir
}

/** A PATH that reaches the given dir first and then only the system's own programs — never a
 *  directory a real `pi` or `claude` is installed in. */
function guardedPath(dir: string): string {
  return `${dir}:/usr/bin:/bin`
}

/** Runs the real judge the way the bare CLI runs it — `piJudge()` from inside a git main
 *  checkout holding these settings, PROOFSPEC_QUEUE_ROOT unset, as a person's shell has it —
 *  on the given PATH, and answers its verdict and how long it took. */
async function judgedFromMainCheckout(settings: SettingsFile, path: string): Promise<{ verdict: JudgeVerdict; elapsedMs: number }> {
  const repo = await makeGitRepo({ 'README.md': 'a repo the judge runs in\n' })
  await writeSettingsInto(repo.root, settings)
  delete process.env.PROOFSPEC_QUEUE_ROOT
  process.chdir(repo.root)
  process.env.PATH = path
  const startedAt = Date.now()
  try {
    const verdict = await piJudge()(JUDGE_INPUT)
    return { verdict, elapsedMs: Date.now() - startedAt }
  } finally {
    process.env.PATH = ORIGINAL_PATH
    process.chdir(ORIGINAL_CWD)
  }
}

/** A minimal relationship ask for driving the real judge — the same shape
 *  tests/schedule/judge-cli.test.ts hands it. */
const JUDGE_INPUT: RelationshipJudgeInput = {
  relationship: { node: { kind: 'capability', name: 'demo' }, tasks: ['a', 'b'] },
  intents: { a: 'renames a helper', b: 'fixes a typo' },
}

/** A judge timeout short enough to wait out in a test and far from both the default 60000 and
 *  any value an old variable is set to below, so the wait the judge kept is read off the
 *  clock: a stand-in that never answers is killed at this bound, not before and not long after. */
const FILE_TIMEOUT_MS = 1500

/** Reads the settings at a queue root through the one module that will hold the reading.
 *  Imported at call time, not at the file's top, so the scenarios that drive real commands
 *  fail on their own assertions while this one is still unimplemented, rather than the whole
 *  file dying on one missing import. The specifier rides a constant because `src/settings.ts`
 *  does not exist yet at tests-red time: a literal would fail `pnpm typecheck` before any
 *  behavior exists to check, while the runtime failure of this import — the reading is not
 *  implemented — is exactly this scenario's red reason. */
const SETTINGS_MODULE = '../../src/settings.ts'

async function readSettingsAt(queueRoot: string) {
  const { readSettings } = await import(/* @vite-ignore */ SETTINGS_MODULE)
  return readSettings(queueRoot)
}

/** A queue root holding exactly the given settings file, read through the real reading. */
async function settingsFrom(contents: Readonly<Record<string, unknown>>) {
  const repo = await makeRepo({ '.proofspec/config.json': JSON.stringify(contents) })
  return readSettingsAt(repo.root)
}

/** Proves every one of a file's five settings on a real surface: the session start command
 *  runs its executor (claude), touched measures from its baseBranch (bDev), the judge runs its
 *  judgeBin and waits its judgeTimeoutMs, and a pass starts at most its maxSessions — two, below the five ready TASKs
 *  and below the default four, so exactly two start and three are deferred: a pass that
 *  ignored the bound would start all five, and one on the default would start four. */
async function expectEverySettingFromFile(): Promise<void> {
  const dir = await standInDir()
  const fileBin = await standIn(dir, 'file-bin', 'exec sleep 5')
  const settings = { executor: 'claude', baseBranch: 'bDev', judgeBin: fileBin, judgeTimeoutMs: FILE_TIMEOUT_MS, maxSessions: 2 }

  expect(await executorStartedUnder(settings)).toBe('claude')
  expect(await branchTouchedMeasuredFrom(settings)).toBe('bDev')

  // The judge: the file's program ran, and the never-answering stand-in was waited on for the
  // file's timeout — killed at it, never at a shorter wait and never left to the default's.
  // The PATH reaches no real pi or claude, only guards that mark themselves if run.
  const guards = await standInDir()
  await standIn(guards, 'pi', 'exit 1')
  await standIn(guards, 'claude', 'exit 1')
  const judged = await judgedFromMainCheckout(settings, guardedPath(guards))
  expect(existsSync(`${fileBin}.started`)).toBe(true)
  expect(existsSync(join(guards, 'pi.started'))).toBe(false)
  expect(judged.verdict).toEqual({ kind: 'unresolved' })
  expect(judged.elapsedMs).toBeGreaterThanOrEqual(FILE_TIMEOUT_MS - 50)
  // The window also holds the judge's git lookup and its spawn and kill, a few hundred ms under
  // load; the bound still sits below twice the file's value.
  expect(judged.elapsedMs).toBeLessThan(FILE_TIMEOUT_MS + 1000)

  expect(await sessionsAPassStartsUnder(settings)).toEqual({ started: ['a', 'b'], deferred: ['c', 'd', 'e'] })
}

// Requirement: Project settings are read from one file at the queue root
// Scenario: A settings file holding all five keys decides every setting
// GIVEN a settings file at the queue root naming an executor, a baseBranch, a judgeBin, a
//      judgeTimeoutMs, and a maxSessions
// WHEN the tools read their settings
// THEN every setting is the file's — a session runs the named executor, the queue measures
//      against the named branch, the judge runs the named program and waits the named number
//      of milliseconds, and a pass starts at most the named number of sessions
it('answers every setting from a file holding all five keys', async () => {
  await expectEverySettingFromFile()

  const fileSettings = { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 }
  expect(await settingsFrom(fileSettings)).toEqual({ ok: true, settings: fileSettings })
}, 30_000)

// Requirement: Project settings are read from one file at the queue root
// Scenario: With no settings file, every key takes its default
// GIVEN no settings file at the queue root
// WHEN the tools read their settings
// THEN every key takes its default — executor pi, baseBranch main, judgeBin pi,
//      judgeTimeoutMs 60000, maxSessions four
it('answers the default for every key when no settings file stands at the queue root', async () => {
  expect(DEFAULT_JUDGE_TIMEOUT_MS).toBe(60_000)
  expect(DEFAULT_MAX_SESSIONS).toBe(4)
  const repo = await makeRepo({})

  expect(await readSettingsAt(repo.root)).toEqual({
    ok: true,
    settings: {
      executor: 'pi',
      baseBranch: 'main',
      judgeBin: 'pi',
      judgeTimeoutMs: DEFAULT_JUDGE_TIMEOUT_MS,
      maxSessions: DEFAULT_MAX_SESSIONS,
    },
  })
})

// Requirement: Project settings are read from one file at the queue root
// Scenario: A key missing from the settings file takes its default, the others keep their values
// GIVEN a settings file at the queue root naming four of the five keys and naming no baseBranch
// WHEN the tools read their settings
// THEN the base branch is main — the missing key's default — and the four named keys keep
//      the file's values
it('answers the missing key\'s default while the named keys keep the file\'s values', async () => {
  expect(await settingsFrom({ executor: 'claude', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'main', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 },
  })
})

// Requirement: Project settings are read from one file at the queue root
// Scenario: A key holding a value it cannot use takes its default, the other keys keep their values
// GIVEN a settings file whose executor is neither pi nor claude, and, one at a time, a settings
//      file whose baseBranch is not a non-empty string, one whose maxSessions is not a positive
//      number, and one whose judgeTimeoutMs is not a positive number
// WHEN the tools read their settings
// THEN in each case that one key takes its default and the file's other keys keep their values
it('answers a key\'s default when its value is unusable, keeping the file\'s other values', async () => {
  // Every key named with a usable value no default shares, so a key that fell back is told
  // apart from one that kept the file's value — and one unusable value per file.
  const usable = { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 } as const
  const defaults = { executor: 'pi', baseBranch: 'main', judgeBin: 'pi', judgeTimeoutMs: DEFAULT_JUDGE_TIMEOUT_MS, maxSessions: DEFAULT_MAX_SESSIONS } as const
  const unusable: ReadonlyArray<readonly [keyof typeof usable, unknown]> = [
    // An executor naming an agent that is neither pi nor claude, and one that is no name at all.
    ['executor', 'codex'],
    ['executor', 7],
    // A baseBranch that is the empty string, and one that is not a string.
    ['baseBranch', ''],
    ['baseBranch', 42],
    // A maxSessions that is zero, negative, or not a number.
    ['maxSessions', 0],
    ['maxSessions', -3],
    ['maxSessions', 'four'],
    // A judgeTimeoutMs that is zero, negative, or not a number.
    ['judgeTimeoutMs', 0],
    ['judgeTimeoutMs', -500],
    ['judgeTimeoutMs', 'soon'],
  ]

  for (const [key, value] of unusable) {
    expect(await settingsFrom({ ...usable, [key]: value }), `${key} holding ${JSON.stringify(value)}`).toEqual({
      ok: true,
      settings: { ...usable, [key]: defaults[key] },
    })
  }

  // The same fallback on the real surfaces: an unusable executor still starts pi while the
  // same file's bDev still decides where touched measures from, and an unusable baseBranch
  // still measures from main while the same file's claude still decides the harness run.
  for (const executor of ['codex', 7]) {
    const settings = { ...usable, executor }
    expect(await executorStartedUnder(settings), `executor holding ${JSON.stringify(executor)}`).toBe('pi')
    expect(await branchTouchedMeasuredFrom(settings), `executor holding ${JSON.stringify(executor)}`).toBe('bDev')
  }
  for (const baseBranch of ['', 42]) {
    const settings = { ...usable, baseBranch }
    expect(await branchTouchedMeasuredFrom(settings), `baseBranch holding ${JSON.stringify(baseBranch)}`).toBe('main')
    expect(await executorStartedUnder(settings), `baseBranch holding ${JSON.stringify(baseBranch)}`).toBe('claude')
  }
}, 30_000)

// Requirement: Project settings are read from one file at the queue root
// Scenario: A settings file that is not valid JSON fails the command reading it, naming the file
// GIVEN a settings file at the queue root that is not valid JSON
// WHEN a command that reads its settings runs
// THEN it fails with an error naming the settings file, never a quiet run on the defaults
it('refuses, naming the settings file, when it is not valid JSON', async () => {
  // touched, with a change on the branch it would otherwise report.
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'work/diffed'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await repo.write('.proofspec/config.json', '{ not valid JSON')

  const outcome = await touched({ cwd: repo.root })

  if (outcome.kind !== 'cannot-run') throw new Error(`expected touched to refuse naming the settings file, got ${outcome.kind}`)
  expect(outcome.reason).toContain('.proofspec/config.json')

  // schedule, with a ready TASK it would otherwise start a session for: it refuses before
  // starting anything, rather than dispatching under the default bound.
  const queue = await makeGitRepo({ 'specs/cli.md': '# cli\n' })
  await enterTask(queue, 'a', { edit: 'specs/cli.md' })
  await queue.write('.proofspec/config.json', '{ not valid JSON')
  const started: string[] = []

  const pass = await schedule({
    cwd: queue.root,
    schedule: {
      startSession: async task => {
        started.push(task)
      },
      countSessions: async () => started.length,
      judge: async () => ({ kind: 'resolved' }),
      notifyHuman: async () => {},
    },
  })

  if (pass.kind !== 'cannot-run') throw new Error(`expected schedule to refuse naming the settings file, got ${pass.kind}`)
  expect(pass.reason).toContain('.proofspec/config.json')
  expect(started).toEqual([])

  // The session start, the bare CLI's own startSession: it refuses before any session starts,
  // rather than starting the default executor. tmux is a stand-in that logs every call it is
  // given and starts nothing, so a start that went ahead is read off its log, and no real
  // harness can ever be started here.
  const dispatched = await makeGitRepo({ 'a.txt': 'a', '.pi/agents/executor.md': 'You are the executor.\n' })
  await enterTask(dispatched, 'a', { edit: 'a.txt' })
  await writeSettingsInto(dispatched.root, 'not valid JSON')
  const fakeTmuxDir = await standInDir()
  const tmuxLog = join(fakeTmuxDir, 'tmux.log')
  await writeFile(tmuxLog, '')
  await standIn(fakeTmuxDir, 'tmux', `echo "$*" >> ${JSON.stringify(tmuxLog)}\nexit 0`)
  process.env.PATH = `${fakeTmuxDir}:${ORIGINAL_PATH}`
  try {
    await expect(tmuxStartSession(dispatched.root, 'a')).rejects.toThrow(/\.proofspec\/config\.json/)
  } finally {
    process.env.PATH = ORIGINAL_PATH
  }
  expect(await readFile(tmuxLog, 'utf8')).not.toContain('new-session')

  // The judge, run the way the bare CLI runs it from a main checkout: it fails naming the file
  // rather than running the default program. The PATH reaches only a stand-in pi that would
  // answer at once if run, and a guard claude.
  const judgeGuards = await standInDir()
  await standIn(judgeGuards, 'pi', 'echo RESOLVED')
  await standIn(judgeGuards, 'claude', 'exit 1')
  await expect(judgedFromMainCheckout('not valid JSON', guardedPath(judgeGuards))).rejects.toThrow(/\.proofspec\/config\.json/)
  expect(existsSync(join(judgeGuards, 'pi.started'))).toBe(false)
  expect(existsSync(join(judgeGuards, 'claude.started'))).toBe(false)

  // settle_task, from a session handed a queue root whose file is broken: a mergeable TASK
  // whose branch landed in main — the default base — is refused naming the file, its state
  // word left as it stood, rather than settled against the default.
  const settling = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(settling, 'a', { edit: 'a.txt' })
  await settling.git(['merge', 'work/a'])
  await settling.write('.proofspec/dispatch/a/state', 'mergeable')
  await writeSettingsInto(settling.root, 'not valid JSON')
  process.env.PROOFSPEC_QUEUE_ROOT = settling.root
  process.env.PROOFSPEC_TASK = 'a'
  const core = createToolCore({ fireSchedulingPass: async () => {} })

  const settle = await core.call('settle_task', {}, settling.root)

  expect(settle).toEqual({ ok: false, reason: expect.stringContaining('.proofspec/config.json') })
  await expect(readFile(join(settling.root, '.proofspec', 'dispatch', 'a', 'state'), 'utf8')).resolves.toBe('mergeable')

  // census_in_flight, from a session handed that same broken queue root, whose mergeable TASK
  // it would otherwise census: it refuses naming the file, rather than measuring the TASK
  // against the default base.
  const census = await core.call('census_in_flight', {}, settling.root)

  expect(census).toEqual({ ok: false, reason: expect.stringContaining('.proofspec/config.json') })
}, 30_000)

// Requirement: Project settings are read from one file at the queue root
// Scenario: A command run in a worktree reads the main checkout's settings file, never the worktree's copy
// GIVEN a repository whose main checkout holds a settings file naming one base branch, and a
//      TASK's worktree whose own branch carries a settings file naming another
// WHEN a command runs inside that worktree
// THEN the main checkout's file decides — the command measures against the branch that file
//      names, never the branch the worktree's copy names
it('measures against the branch the main checkout\'s settings file names, never the worktree\'s copy', async () => {
  const repo = await makeGitRepo(inSync())
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit a proof'])
  // The repo's own release flow carried the change into main, so a tool measuring from main
  // answers nothing over it — only measuring from the named branch counts it.
  await repo.git(['checkout', 'main'])
  await repo.git(['merge', 'work'])
  // Each file also names its own judge program — a stand-in that marks itself when run — so
  // which file the judge read is read off which mark appears.
  const judges = await standInDir()
  const mainCheckoutJudge = await standIn(judges, 'main-checkout-judge', 'echo RESOLVED')
  const worktreeJudge = await standIn(judges, 'worktree-judge', 'echo RESOLVED')
  await standIn(judges, 'pi', 'exit 1')
  await standIn(judges, 'claude', 'exit 1')
  // The worktree's own branch carries a copy naming main — the very branch that would hide
  // the change.
  await repo.git(['checkout', 'work'])
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main', judgeBin: worktreeJudge }))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the worktree\'s own copy names main'])
  await repo.git(['checkout', 'main'])
  // The queue root's own file names the development branch; written after the last checkout,
  // it stands only in the main checkout.
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development, judgeBin: mainCheckoutJudge }))
  const worktree = join(repo.root, '.proofspec', 'worktrees', 'diffed')
  await repo.git(['worktree', 'add', worktree, 'work'])
  const leftAt = await repo.git(['rev-parse', development])

  const summary = summaryOf(await touched({ cwd: worktree }))

  expect(summary.base).toBe(leftAt)
  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])

  // A scheduling pass run inside the worktree: a mergeable TASK whose branch landed in the
  // development branch alone is settled only by a pass measuring against the main checkout's
  // bDev — measured against the worktree copy's main it would stay mergeable. Only the landed
  // file is committed, so the untracked settings file stays the main checkout's alone.
  // Its branch is `landed`, not `work/landed`: the worktree's own branch `work` already holds
  // that ref prefix.
  await repo.git(['checkout', '-b', 'landed', development])
  await repo.write('landed.txt', 'landed in the development branch\n')
  await repo.git(['add', 'landed.txt'])
  await repo.git(['commit', '-m', 'the landed TASK edits'])
  await repo.git(['checkout', development])
  await repo.git(['merge', 'landed'])
  await repo.git(['checkout', 'main'])
  // The pass reads the queue where it is run, so the entry stands in the worktree.
  const landedEntry = join(worktree, '.proofspec', 'dispatch', 'landed')
  await mkdir(landedEntry, { recursive: true })
  await writeFile(join(landedEntry, 'MANIFEST'), JSON.stringify({ intentRef: 'docs/x.md', branch: 'landed' }))
  await writeFile(join(landedEntry, 'state'), 'mergeable')

  const pass = await schedule({
    cwd: worktree,
    schedule: {
      startSession: async () => {},
      countSessions: async () => 0,
      judge: async () => ({ kind: 'resolved' }),
      notifyHuman: async () => {},
    },
  })

  if (pass.kind !== 'scheduled') throw new Error(`expected a scheduled report, got ${pass.kind}`)
  expect(pass.report.merged).toEqual(['landed'])

  // The judge, run the way the bare CLI runs it but from inside the worktree: the main
  // checkout's program runs, never the one the worktree's copy names. The PATH reaches only
  // the stand-ins and guards, never a real pi or claude.
  process.chdir(worktree)
  process.env.PATH = guardedPath(judges)
  try {
    expect(await piJudge()(JUDGE_INPUT)).toEqual({ kind: 'resolved' })
  } finally {
    process.env.PATH = ORIGINAL_PATH
    process.chdir(ORIGINAL_CWD)
  }
  expect(existsSync(`${mainCheckoutJudge}.started`)).toBe(true)
  expect(existsSync(`${worktreeJudge}.started`)).toBe(false)
  expect(existsSync(join(judges, 'pi.started'))).toBe(false)
}, 30_000)

// Requirement: Project settings are read from one file at the queue root
// Scenario: A session finds the settings file through the queue root it is handed
// GIVEN an executor session standing in a TASK's worktree, handed the queue root in
//      PROOFSPEC_QUEUE_ROOT, whose queue root holds a settings file naming one base branch
//      while the worktree's own branch carries a copy naming another
// WHEN the session's tools read the settings — settling a TASK, and censusing the queue
// THEN they read the file at the queue root they were handed, measuring against the branch
//      it names, never the copy standing in the worktree they are in
it('reads the settings at the queue root a session is handed, never the copy in its worktree', async () => {
  // Three settings files, each naming a different base branch, so the branch an answer was
  // measured against names the file that decided it:
  // - the handed queue root's own file (repo A's main checkout) names bDev;
  // - the session stands in a worktree of a different repository, B — a clone of A — whose
  //   own main checkout's file names bOther, so a reading that asked git for the main checkout
  //   of wherever the session stands would measure against bOther;
  // - the worktree's own branch carries a copy naming main.
  // Measured against bDev the census answers only the second requirement and the settle is
  // performed; against bOther or main the census answers both and the settle is refused,
  // since the settled branch landed in bDev alone.
  const handed = await makeGitRepo({
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
  })
  const development = 'bDev'
  await handed.git(['checkout', '-b', development])
  await handed.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second original description.'))
  await handed.git(['add', '-A'])
  await handed.git(['commit', '-m', 'development branch rewrites the first'])
  // Another branch off main, the one the standing repository's main checkout will name.
  await handed.git(['checkout', 'main'])
  await handed.git(['checkout', '-b', 'bOther'])
  await handed.write('docs/other.md', 'another line of work\n')
  await handed.git(['add', '-A'])
  await handed.git(['commit', '-m', 'another branch moves past main'])
  // The censused TASK: built on bDev, carrying its own settings copy naming main, never
  // merged anywhere. Its worktree is where the session stands.
  await handed.git(['checkout', development])
  await handed.git(['checkout', '-b', 'work/censused'])
  await handed.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second description as the TASK rewrote it.'))
  await handed.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main' }))
  await handed.git(['add', '-A'])
  await handed.git(['commit', '-m', 'the TASK rewrites the second and carries its own copy'])
  // The settled TASK: built on bDev, carrying its own copy naming main, and landed in bDev —
  // an ancestor of it and of neither bOther nor main.
  await handed.git(['checkout', development])
  await handed.git(['checkout', '-b', 'work/settled-by-session'])
  await handed.write('specs/cli.md', twoRequirementSpec('The first description as the settled TASK rewrote it.', 'The second original description.'))
  await handed.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main' }))
  await handed.git(['add', '-A'])
  await handed.git(['commit', '-m', 'the settled TASK rewrites the first and carries its own copy'])
  await handed.git(['checkout', development])
  await handed.git(['merge', 'work/settled-by-session'])
  await handed.git(['checkout', 'main'])
  await queueTask(handed.root, 'censused', 'mergeable')
  await queueTask(handed.root, 'settled-by-session', 'mergeable')
  // The handed queue root's own file names bDev; written after the last checkout, it stands
  // only in A's main checkout.
  await handed.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))
  await handed.git(['worktree', 'add', join(handed.root, '.proofspec', 'worktrees', 'settled-by-session'), 'work/settled-by-session'])

  // B: a clone of A carrying every one of A's branches, so whichever repository a census
  // asks git in, the same branches answer — only the settings file read decides the answer.
  const other = await makeRepo({})
  await execFileAsync('git', ['clone', '-q', handed.root, other.root])
  for (const branch of [development, 'bOther', 'work/censused', 'work/settled-by-session']) {
    await execFileAsync('git', ['branch', branch, `origin/${branch}`], { cwd: other.root })
  }
  await writeSettingsInto(other.root, { baseBranch: 'bOther' })
  const standing = join(other.root, '.proofspec', 'worktrees', 'censused')
  await execFileAsync('git', ['worktree', 'add', standing, 'work/censused'], { cwd: other.root })
  // census_in_flight reads the queue directory of the repo it is called in; the in-flight
  // entry is mirrored in B's main checkout and where the session stands, as it stands in A, so
  // the census finds its TASK whichever directory it takes the queue from — what this scenario
  // holds it to is only which settings file it measures by.
  await queueTask(other.root, 'censused', 'mergeable')
  await queueTask(standing, 'censused', 'mergeable')
  // The session's hand-off, exactly as the start command hands it: the queue root and the TASK
  // in the environment, the session's own cwd the worktree it stands in.
  process.env.PROOFSPEC_QUEUE_ROOT = handed.root
  process.env.PROOFSPEC_TASK = 'settled-by-session'
  process.chdir(standing)
  // The settle's own scheduling pass is a no-op here: this scenario is about the settle's
  // reading, and a real pass would reach for tmux and a judge.
  const core = createToolCore({ fireSchedulingPass: async () => {} })

  // Settling a TASK: measured against bDev, the branch the handed queue root's file names, the
  // settle is performed; measured against bOther or main it would refuse.
  const settled = await core.call('settle_task', {}, standing)
  expect(settled).toEqual({ ok: true, task: 'settled-by-session' })
  await expect(readFile(join(handed.root, '.proofspec', 'dispatch', 'settled-by-session', 'state'), 'utf8')).resolves.toBe('merged')
  await expect(stat(join(handed.root, '.proofspec', 'worktrees', 'settled-by-session'))).rejects.toThrow()

  // Censusing the queue: the one in-flight TASK's rewrite is measured against bDev, which
  // answers only the second requirement — measured against bOther or main it would answer both.
  const census = await core.call('census_in_flight', {}, standing)
  expect(census).toEqual({
    ok: true,
    census: {
      tasks: [
        {
          task: 'censused',
          branch: 'work/censused',
          capabilities: [
            {
              capability: 'cli',
              requirements: [
                {
                  kind: 'reworded',
                  requirement: 'A second requirement',
                  before: 'The second original description.',
                  after: 'The second description as the TASK rewrote it.',
                },
              ],
              terms: [],
            },
          ],
        },
      ],
      failures: [],
    },
  })
}, 30_000)

// Requirement: Project settings are read from one file at the queue root
// Scenario: Setting the old environment variables changes nothing
// GIVEN a settings file at the queue root naming all five keys, and each of
//      PROOFSPEC_EXECUTOR, PROOFSPEC_BASE_BRANCH, PROOFSPEC_JUDGE_BIN,
//      PROOFSPEC_JUDGE_TIMEOUT_MS, and PROOFSPEC_MAX_SESSIONS set to a different value
// WHEN the tools read their settings
// THEN every setting is still the file's — and with no file at all, still the defaults —
//      no setting follows any of the variables
it('answers the file\'s settings — or the defaults — never the old environment variables', async () => {
  // A stand-in for the variable's judge program: it marks that it ran and answers at once, so
  // a judge that followed the variable is caught by its mark.
  const envBins = await standInDir()
  const envBin = await standIn(envBins, 'env-bin', 'echo RESOLVED')

  // With a file naming all five keys, every variable set to a value the file contradicts —
  // pi against the file's claude, trunk against bDev, a 100ms wait against the file's FILE_TIMEOUT_MS,
  // and a bound of three against two.
  process.env.PROOFSPEC_EXECUTOR = 'pi'
  process.env.PROOFSPEC_BASE_BRANCH = 'trunk'
  process.env.PROOFSPEC_JUDGE_BIN = envBin
  process.env.PROOFSPEC_JUDGE_TIMEOUT_MS = '100'
  process.env.PROOFSPEC_MAX_SESSIONS = '3'
  await expectEverySettingFromFile()
  expect(existsSync(`${envBin}.started`)).toBe(false)
  // The base branch at every other place that asks git about it: the census and settle_task
  // as a session calls them, and a scheduling pass's landed check, each measuring by the
  // file's bDev, never the variable's trunk.
  expect(await branchesTheSessionToolsAndAPassMeasureBy({ executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: FILE_TIMEOUT_MS, maxSessions: 2 })).toEqual({
    census: 'bDev',
    settleTask: 'bDev',
    pass: 'bDev',
  })

  // With no file at all, every variable set to a value that is not the default — claude,
  // bDev, the variable's own program, a 300ms wait, and a bound of seven — and still every
  // setting is the default.
  process.env.PROOFSPEC_EXECUTOR = 'claude'
  process.env.PROOFSPEC_BASE_BRANCH = 'bDev'
  process.env.PROOFSPEC_JUDGE_BIN = envBin
  process.env.PROOFSPEC_JUDGE_TIMEOUT_MS = '300'
  process.env.PROOFSPEC_MAX_SESSIONS = '7'

  expect(await executorStartedUnder('no file')).toBe('pi')
  expect(await branchTouchedMeasuredFrom('no file')).toBe('main')
  expect(await branchesTheSessionToolsAndAPassMeasureBy('no file')).toEqual({ census: 'main', settleTask: 'main', pass: 'main' })

  // The judge: the default program is pi, reached on PATH — here a stand-in pi that takes a
  // second to answer, so the variable's 300ms wait would kill it before it ever finished,
  // while the default 60000 lets it answer. A guard claude marks itself if run instead.
  const defaults = await standInDir()
  const defaultPi = await standIn(defaults, 'pi', `sleep 1\ntouch ${JSON.stringify(join(defaults, 'pi.finished'))}\necho RESOLVED`)
  await standIn(defaults, 'claude', 'exit 1')
  const judged = await judgedFromMainCheckout('no file', guardedPath(defaults))
  expect(existsSync(`${envBin}.started`)).toBe(false)
  expect(existsSync(`${defaultPi}.started`)).toBe(true)
  expect(existsSync(join(defaults, 'pi.finished'))).toBe(true)
  expect(existsSync(join(defaults, 'claude.started'))).toBe(false)
  expect(judged.verdict).toEqual({ kind: 'resolved' })

  // The bound: the default four of five ready TASKs, never the variable's seven.
  expect(await sessionsAPassStartsUnder('no file')).toEqual({ started: ['a', 'b', 'c', 'd'], deferred: ['e'] })
}, 60_000)
