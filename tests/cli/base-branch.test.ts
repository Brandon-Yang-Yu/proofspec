// Capability: cli

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { schedule, touched } from '../../src/cli/index.ts'
import type { Outcome, SchedulePlan, TouchedSummary } from '../../src/cli/index.ts'
import { runCensusInFlight } from '../../src/handoff/extension.ts'
import { runSettleTask } from '../../src/progress/extension.ts'
import { CAPABILITY, cleanupRepos, makeGitRepo, specFile, testFile, TEST_PATH } from './support.ts'
import type { GitRepo } from './support.ts'

const execFileAsync = promisify(execFile)

// Every settle and scheduling pass in this suite targets this throwaway socket — the
// reaper's kill included — so nothing here can ever reach a real session on the production
// socket. Set once for the whole file and never deleted in the per-test cleanup: the reaper
// reads it at spawn time (the same convention tests/progress/settle.test.ts keeps).
const SOCKET = 'proofspec-base-branch-test'
process.env.PROOFSPEC_TMUX_SOCKET = SOCKET

afterEach(cleanupRepos)
afterEach(async () => {
  await execFileAsync('tmux', ['-L', SOCKET, 'kill-server']).catch(() => {})
})

const FIRST = 'A first behavior'
const SECOND = 'A second behavior'

/** A repo under git whose test and capability file agree, the shape tests/cli/touched.test.ts builds. */
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

/** Writes a queue entry for a TASK carrying no `blocked` — built on the BASE_BRANCH, whatever
 *  that branch is called in this repo. */
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

function planOf(outcome: Outcome): SchedulePlan {
  if (outcome.kind !== 'scheduled') throw new Error(`expected a scheduled report, got ${outcome.kind}`)
  return outcome.report
}

function hasSession(task: string): Promise<boolean> {
  return execFileAsync('tmux', ['-L', SOCKET, 'has-session', '-t', task]).then(
    () => true,
    () => false,
  )
}

/** Waits until no session with the TASK's name stands, answering false if one still does
 *  after the deadline — a few times the reaper's two-second delay. */
async function sessionGoneWithin(task: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!(await hasSession(task))) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return !(await hasSession(task))
}

// Requirement: Every place that asks git about the BASE_BRANCH reads one name
// Scenario: The diff base touched measures from is the branch the settings file names
// GIVEN a repo with a branch named main and a development branch the work is built on, a settings
//      file at the queue root whose baseBranch names that development branch, and a branch cut
//      from it that has committed a change
// WHEN the touched command runs
// THEN the change is counted, measured from where the branch left the named branch
it('measures the diff from the branch the settings file names', async () => {
  const repo = await makeGitRepo(inSync())
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.git(['checkout', '-b', 'work'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'edit a proof'])
  // The repo's own release flow already carried the change into main, so a tool measuring
  // from main answers nothing over it — only measuring from the named branch counts it.
  await repo.git(['checkout', 'main'])
  await repo.git(['merge', 'work'])
  await repo.git(['checkout', 'work'])
  const leftAt = await repo.git(['rev-parse', development])
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))

  const summary = summaryOf(await touched({ cwd: repo.root }))

  expect(summary.base).toBe(leftAt)
  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])
})

// Requirement: Every place that asks git about the BASE_BRANCH reads one name
// Scenario: The census measures each TASK against the branch the settings file names
// GIVEN a queue holding an in-flight TASK whose MANIFEST records no `blocked`, and a settings
//      file at the queue root whose baseBranch names a branch other than main
// WHEN the census computes what each in-flight TASK is measured against
// THEN that TASK is measured against the named branch
it('measures the census against the branch the settings file names', async () => {
  const repo = await makeGitRepo({
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
  })
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second original description.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'development branch rewrites the first'])
  await repo.git(['checkout', '-b', 'work/censused'])
  await repo.write('specs/cli.md', twoRequirementSpec('The first description as the development branch rewrote it.', 'The second description as the TASK rewrote it.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK rewrites the second'])
  await repo.git(['checkout', 'main'])
  await queueTask(repo, 'censused', 'mergeable')
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))

  const result = await runCensusInFlight(repo.root)

  expect(result).toEqual({
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

// Requirement: Every place that asks git about the BASE_BRANCH reads one name
// Scenario: A scheduling pass settles a mergeable TASK whose branch landed in the branch the settings file names
// GIVEN a settings file at the queue root whose baseBranch names a development branch, and a
//      mergeable TASK whose branch is an ancestor of that branch and not of the branch named main
// WHEN a scheduling pass runs
// THEN the TASK is settled — its state rewritten to merged, its worktree and session torn down
it('settles through a scheduling pass against the branch the settings file names', async () => {
  const repo = await makeGitRepo({
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
  })
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.git(['checkout', '-b', 'work/passed'])
  await repo.write('specs/cli.md', twoRequirementSpec('The first original description.', 'The description the TASK rewrote.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await repo.git(['checkout', development])
  await repo.git(['merge', 'work/passed'])
  await repo.git(['checkout', 'main'])
  await queueTask(repo, 'passed', 'mergeable')
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'passed'), 'work/passed'])
  await execFileAsync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', 'passed', 'sleep', '60'])
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))

  const outcome = await schedule({ cwd: repo.root })

  expect(planOf(outcome).merged).toEqual(['passed'])
  await expect(readFile(join(repo.root, '.proofspec', 'archive', 'passed', 'state'), 'utf8')).resolves.toBe('merged')
  await expect(stat(join(repo.root, '.proofspec', 'worktrees', 'passed'))).rejects.toThrow()
  await expect(sessionGoneWithin('passed', 5000)).resolves.toBe(true)
}, 10000)

// Requirement: Every place that asks git about the BASE_BRANCH reads one name
// Scenario: settle_task settles a TASK whose branch landed in the branch the settings file names
// GIVEN a settings file at the queue root whose baseBranch names a development branch, and a
//      mergeable TASK whose branch is an ancestor of that branch and not of the branch named main,
//      with a worktree standing and a session live
// WHEN settle_task runs
// THEN the settle is performed — the state rewritten to merged, the worktree removed, the session killed
it('settles through settle_task against the branch the settings file names', async () => {
  const repo = await makeGitRepo({
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
  })
  const development = 'bDev'
  await repo.git(['checkout', '-b', development])
  await repo.git(['checkout', '-b', 'work/handed'])
  await repo.write('specs/cli.md', twoRequirementSpec('The first original description.', 'The description the TASK rewrote.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await repo.git(['checkout', development])
  await repo.git(['merge', 'work/handed'])
  await repo.git(['checkout', 'main'])
  await queueTask(repo, 'handed', 'mergeable')
  await repo.git(['worktree', 'add', join(repo.root, '.proofspec', 'worktrees', 'handed'), 'work/handed'])
  await execFileAsync('tmux', ['-L', SOCKET, 'new-session', '-d', '-s', 'handed', 'sleep', '60'])
  await repo.write('.proofspec/config.json', JSON.stringify({ baseBranch: development }))

  const result = await runSettleTask({ queueRoot: repo.root, task: 'handed' })

  expect(result).toEqual({ ok: true, task: 'handed' })
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'handed', 'state'), 'utf8')).resolves.toBe('merged')
  await expect(stat(join(repo.root, '.proofspec', 'worktrees', 'handed'))).rejects.toThrow()
  await expect(sessionGoneWithin('handed', 5000)).resolves.toBe(true)
}, 10000)

/** Drives each of the four places that ask git about the base branch — touched, the census,
 *  settle_task, a scheduling pass — through one repo whose work is built on main, asserting
 *  every one of them measures against main. `files` are the repo's starting files, so one
 *  call stands with no settings file at all and another with one holding no baseBranch. */
async function everyPlaceMeasuresAgainstMain(files: Readonly<Record<string, string>>): Promise<void> {
  const repo = await makeGitRepo(files)
  await repo.git(['checkout', '-b', 'work/diffed'])
  await repo.write(TEST_PATH, bodyEdited())
  await repo.write('specs/cli.md', twoRequirementSpec('The description the TASK rewrote.', 'The second original description.'))
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the TASK edits'])
  await repo.git(['checkout', 'main'])
  await repo.git(['checkout', '-b', 'work/settled-by-tool'])
  await repo.write('a.txt', 'a\nchanged by the TASK\n')
  await repo.git(['add', '-A'])
  await repo.git(['commit', '-m', 'the other TASK edits'])
  await repo.git(['checkout', 'main'])
  await queueTask(repo, 'diffed', 'mergeable')
  await queueTask(repo, 'settled-by-tool', 'mergeable')

  // The diff base: standing on the branch, its committed proof edit is counted, measured
  // from where the branch left main.
  await repo.git(['checkout', 'work/diffed'])
  const summary = summaryOf(await touched({ cwd: repo.root }))
  await repo.git(['checkout', 'main'])
  expect(summary.requirements.map(one => one.scenarios)).toEqual([1])

  // The census: the TASK's own spec rewrite is answered, measured against main.
  const census = await runCensusInFlight(repo.root)
  expect(census).toEqual({
    ok: true,
    census: {
      tasks: [
        {
          task: 'diffed',
          branch: 'work/diffed',
          capabilities: [
            {
              capability: 'cli',
              requirements: [
                {
                  kind: 'reworded',
                  requirement: 'A first requirement',
                  before: 'The first original description.',
                  after: 'The description the TASK rewrote.',
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

  // settle_task: a mergeable TASK whose branch landed in main is settled.
  await repo.git(['merge', 'work/settled-by-tool'])
  await expect(runSettleTask({ queueRoot: repo.root, task: 'settled-by-tool' })).resolves.toEqual({ ok: true, task: 'settled-by-tool' })
  await expect(readFile(join(repo.root, '.proofspec', 'dispatch', 'settled-by-tool', 'state'), 'utf8')).resolves.toBe('merged')

  // The scheduling pass: it settles the mergeable TASK whose branch landed in main.
  await repo.git(['merge', 'work/diffed'])
  const outcome = await schedule({ cwd: repo.root })
  expect(planOf(outcome).merged).toEqual(['diffed'])
}

// Requirement: Every place that asks git about the BASE_BRANCH reads one name
// Scenario: Naming no branch, every place takes main
// GIVEN a repo whose settings file names no baseBranch — no file at all, and then a file holding
//      no baseBranch — and whose work is built on a branch named main
// WHEN each of the four places asks git about the base branch
// THEN every one of them measures against main
it('takes main in every place when no baseBranch is named', async () => {
  const files = {
    ...inSync(),
    'specs/cli.md': twoRequirementSpec('The first original description.', 'The second original description.'),
    'a.txt': 'a',
  }
  await everyPlaceMeasuresAgainstMain(files)
  await everyPlaceMeasuresAgainstMain({ ...files, '.proofspec/config.json': '{}' })
})
