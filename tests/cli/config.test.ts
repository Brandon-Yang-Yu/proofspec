// Capability: cli

// The one reading every tool will share: `.proofspec/config.json` at the queue root. The
// value-level scenarios (what a file names, what a missing key or unusable value falls back
// to, what an unparsable file does) drive the reading where it will live — `src/settings.ts`
// — while the resolution scenarios drive the real commands: `touched` for the invalid file
// and for a run inside a worktree, and the session's own settle and census for the queue-root
// hand-off.

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { touched } from '../../src/cli/index.ts'
import type { Outcome, TouchedSummary } from '../../src/cli/index.ts'
import { DEFAULT_JUDGE_TIMEOUT_MS } from '../../src/cli/judge.ts'
import { runCensusInFlight } from '../../src/handoff/extension.ts'
import { runSettleTask } from '../../src/progress/extension.ts'
import { DEFAULT_MAX_SESSIONS } from '../../src/schedule/index.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, makeRepo, specFile, testFile, TEST_PATH } from './support.ts'
import type { GitRepo } from './support.ts'

const execFileAsync = promisify(execFile)

// Every settle here targets this throwaway socket — the detached scheduling pass a settle
// fires included — so nothing in this file can reach a real session on the production socket.
// Set once for the whole file, the same convention tests/cli/base-branch.test.ts keeps.
const SOCKET = 'proofspec-config-test'
process.env.PROOFSPEC_TMUX_SOCKET = SOCKET

afterEach(cleanupRepos)
// Unconditional deletes, not in-test ones — a thrown assertion earlier in a body would leak a
// variable into every later test in the same worker.
afterEach(() => {
  delete process.env.PROOFSPEC_EXECUTOR
  delete process.env.PROOFSPEC_BASE_BRANCH
  delete process.env.PROOFSPEC_JUDGE_BIN
  delete process.env.PROOFSPEC_JUDGE_TIMEOUT_MS
  delete process.env.PROOFSPEC_MAX_SESSIONS
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_TASK
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

/** Writes a queue entry for a TASK carrying no `blocked`. */
async function queueTask(repo: GitRepo, task: string, state: string): Promise<void> {
  const manifest = { intentRef: 'docs/x.md', branch: `work/${task}` }
  await repo.write(`.proofspec/dispatch/${task}/MANIFEST`, JSON.stringify(manifest))
  await repo.write(`.proofspec/dispatch/${task}/state`, state)
}

function summaryOf(outcome: Outcome): TouchedSummary {
  if (outcome.kind !== 'touched') throw new Error(`expected a touched report, got ${outcome.kind}`)
  if (outcome.report.kind !== 'summary') throw new Error(`expected the work list, got ${outcome.report.kind}`)
  return outcome.report
}

/** Reads the settings at a queue root through the one module that will hold the reading.
 *  Imported at call time, not at the file's top, so the scenarios that drive real commands
 *  fail on their own assertions while this one is still unimplemented, rather than the whole
 *  file dying on one missing import. */
async function readSettingsAt(queueRoot: string) {
  const { readSettings } = await import('../../src/settings.ts')
  return readSettings(queueRoot)
}

/** A queue root holding exactly the given settings file, read through the real reading. */
async function settingsFrom(contents: Readonly<Record<string, unknown>>) {
  const repo = await makeRepo({ '.proofspec/config.json': JSON.stringify(contents) })
  return readSettingsAt(repo.root)
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
  expect(await settingsFrom({ executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 },
  })
})

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
// GIVEN a settings file whose executor names an agent that is neither pi nor claude, and, one
//      at a time, a settings file whose baseBranch is the empty string, one whose maxSessions
//      is not a positive number, and one whose judgeTimeoutMs is not a positive number
// WHEN the tools read their settings
// THEN in each case that one key takes its default and the file's other keys keep their values
it('answers a key\'s default when its value is unusable, keeping the file\'s other values', async () => {
  // An executor naming an agent that is neither pi nor claude.
  expect(await settingsFrom({ executor: 'codex', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'pi', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 },
  })
  // A baseBranch that is the empty string.
  expect(await settingsFrom({ executor: 'claude', baseBranch: '', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'main', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 },
  })
  // A maxSessions that is not a positive number.
  expect(await settingsFrom({ executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 0 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: DEFAULT_MAX_SESSIONS },
  })
  // A judgeTimeoutMs that is not a positive number.
  expect(await settingsFrom({ executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 0, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: DEFAULT_JUDGE_TIMEOUT_MS, maxSessions: 7 },
  })
})

// Requirement: Project settings are read from one file at the queue root
// Scenario: A settings file that is not valid JSON fails the command reading it, naming the file
// GIVEN a settings file at the queue root that is not valid JSON
// WHEN a command that reads its settings runs
// THEN it fails with an error naming the settings file, never a quiet run on the defaults
it('refuses, naming the settings file, when it is not valid JSON', async () => {
  const repo = await makeGitRepo(inSync())
  await repo.git(['checkout', '-b', 'work/diffed'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await repo.write('.proofspec/config.json', '{ not valid JSON')

  const outcome = await touched({ cwd: repo.root })

  if (outcome.kind !== 'cannot-run') throw new Error(`expected a refusal naming the settings file, got ${outcome.kind}`)
  expect(outcome.reason).toContain('.proofspec/config.json')
})

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
  // The worktree's own branch carries a copy naming main — the very branch that would hide
  // the change.
  await repo.git(['checkout', 'work'])
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main' }))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the worktree\'s own copy names main'])
  await repo.git(['checkout', 'main'])
  // The queue root's own file names the development branch; written after the last checkout,
  // it stands only in the main checkout.
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))
  const worktree = join(repo.root, '.proofspec', 'worktrees', 'diffed')
  await repo.git(['worktree', 'add', worktree, 'work'])
  const leftAt = await repo.git(['rev-parse', development])

  const summary = summaryOf(await touched({ cwd: worktree }))

  expect(summary.base).toBe(leftAt)
  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])
})

// Requirement: Project settings are read from one file at the queue root
// Scenario: A session finds the settings file through the queue root it is handed
// GIVEN an executor session standing in a TASK's worktree, handed the queue root in
//      PROOFSPEC_QUEUE_ROOT, whose queue root holds a settings file naming one base branch
//      while the worktree's own branch carries a copy naming another
// WHEN the session's tools read the settings — settling a TASK, and censusing the queue
// THEN they read the file at the queue root they were handed, measuring against the branch
//      it names, never the copy standing in the worktree they are in
it('reads the settings at the queue root a session is handed, never the copy in its worktree', async () => {
  const repo = await makeGitRepo({
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
  })
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second original description.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'development branch rewrites the first'])
  // The censused TASK: built on the named branch, carrying its own settings copy naming main,
  // never merged anywhere.
  await repo.git(['checkout', '-b', 'work/censused'])
  await repo.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second description as the TASK rewrote it.'))
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main' }))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK rewrites the second and carries its own copy'])
  // The settled TASK: built on the named branch, carrying its own copy naming main, and landed
  // in that branch — an ancestor of it and not of main.
  await repo.git(['checkout', development])
  await repo.git(['checkout', '-b', 'work/settled-by-session'])
  await repo.write('specs/cli.md', twoRequirementSpec('The first description as the settled TASK rewrote it.', 'The second original description.'))
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: 'main' }))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the settled TASK rewrites the first and carries its own copy'])
  await repo.git(['checkout', development])
  await repo.git(['merge', 'work/settled-by-session'])
  await repo.git(['checkout', 'main'])
  await queueTask(repo, 'censused', 'mergeable')
  await queueTask(repo, 'settled-by-session', 'mergeable')
  // The queue root's own file names the development branch; written after the last checkout,
  // it stands only in the main checkout.
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'censused'), 'work/censused'])
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'settled-by-session'), 'work/settled-by-session'])
  // The session's hand-off: the queue root arrives in PROOFSPEC_QUEUE_ROOT — the same value the
  // tools below are handed, the same value settle_task's own rule resolves from that variable.
  const queueRoot = repo.root
  process.env.PROOFSPEC_QUEUE_ROOT = queueRoot
  process.env.PROOFSPEC_TASK = 'settled-by-session'

  // Settling a TASK: measured against the branch the queue root's file names, the settle is
  // performed; measured against main it would refuse, since the branch never landed there.
  const settled = await runSettleTask({ queueRoot, task: 'settled-by-session' })
  expect(settled).toEqual({ ok: true, task: 'settled-by-session' })
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'settled-by-session', 'state'), 'utf8')).resolves.toBe('merged')
  await expect(stat(join(repo.root, '.proofspec', 'worktrees', 'settled-by-session'))).rejects.toThrow()

  // Censusing the queue: the one in-flight TASK's rewrite is measured against the named
  // branch, which answers only the second requirement — measured against main it would
  // answer both.
  const census = await runCensusInFlight(queueRoot)
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
})

// Requirement: Project settings are read from one file at the queue root
// Scenario: Setting the old environment variables changes nothing
// GIVEN a settings file at the queue root naming all five keys, and each of
//      PROOFSPEC_EXECUTOR, PROOFSPEC_BASE_BRANCH, PROOFSPEC_JUDGE_BIN,
//      PROOFSPEC_JUDGE_TIMEOUT_MS, and PROOFSPEC_MAX_SESSIONS set to a different value
// WHEN the tools read their settings
// THEN every setting is still the file's — and with no file at all, still the defaults —
//      no setting follows any of the variables
it('answers the file\'s settings — or the defaults — never the old environment variables', async () => {
  process.env.PROOFSPEC_EXECUTOR = 'pi'
  process.env.PROOFSPEC_BASE_BRANCH = 'trunk'
  process.env.PROOFSPEC_JUDGE_BIN = 'pi'
  process.env.PROOFSPEC_JUDGE_TIMEOUT_MS = '30000'
  process.env.PROOFSPEC_MAX_SESSIONS = '2'

  // With the file naming all five keys, every setting is the file's.
  expect(await settingsFrom({ executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 })).toEqual({
    ok: true,
    settings: { executor: 'claude', baseBranch: 'bDev', judgeBin: 'claude', judgeTimeoutMs: 45_000, maxSessions: 7 },
  })

  // With no file at all, still the defaults.
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
