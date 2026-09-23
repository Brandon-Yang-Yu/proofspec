// Capability: docket

import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { docket } from '../../src/cli/index.ts'
import { commandLine, listTmuxSessions, parseSessionNames, tmuxAttachCommand, tmuxListSessionsCommand, tmuxSessionCommands } from '../../src/cli/session.ts'
import type { TmuxCommand } from '../../src/cli/session.ts'
import type { Docket } from '../../src/docket/index.ts'
import type { Outcome } from '../../src/cli/index.ts'
import { cleanupRepos, makeRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// Unconditional for the same reason the schedule session tests do it: a leaked socket override
// would point every later test's tmux command at a socket only one test meant to name.
afterEach(() => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
})

function reportOf(outcome: Outcome): Docket {
  if (outcome.kind !== 'docket') throw new Error(`expected a docket report, got ${outcome.kind}`)
  return outcome.report
}

function manifestFor(task: string): string {
  return JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}`, base: { kind: 'main' } })
}

/** The socket a built tmux command reaches its server through — the value its own `-L`
 *  names. A command with no `-L` at all would reach the user's default server, the exact
 *  thing this requirement forbids, so the missing flag is itself the failure to report. */
function socketOf(command: TmuxCommand): string {
  const flag = command.args.indexOf('-L')
  expect(flag).toBeGreaterThanOrEqual(0)
  return command.args[flag + 1]!
}

/** The per-repo default the start commands derive for a queue root — the name every other
 *  tmux surface must agree with for the same root. Read off the built start command rather
 *  than re-derived here, so what the docket expects can never drift from what the scheduler
 *  actually asks. A derivation still answering the machine's shared bare `proofspec` name
 *  would make every comparison against this value vacuous, so the per-repo shape —
 *  `proofspec-` with a root-dependent tail — is held here, at the source. */
function derivedSocketFor(queueRoot: string): string {
  const [, start] = tmuxSessionCommands('a', {
    worktree: `${queueRoot}/.proofspec/worktrees/a`,
    queueRoot,
    systemPrompt: 'irrelevant to the socket',
  })
  const socket = socketOf(start)
  expect(socket).toMatch(/^proofspec-.+$/)
  return socket
}

// Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server
// Scenario: A session the server holds is listed on the row with its exact attach command
// GIVEN a queue of two TASKs and a session server holding a session named for one of them
// WHEN the docket is answered
// THEN that TASK's row carries the exact command that attaches to its session, the other's is marked absent, and the server was asked for its list once
it('carries the exact attach command for a session the server holds, asking for the list once', async () => {
  const repo = await makeRepo({
    '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
    '.proofspec/dispatch/alpha/state': 'building',
    '.proofspec/dispatch/beta/MANIFEST': manifestFor('beta'),
    '.proofspec/dispatch/beta/state': 'building',
  })
  let asked = 0
  const listSessions = async (): Promise<readonly string[]> => {
    asked += 1
    return ['alpha']
  }

  const outcome = await docket({ cwd: repo.root, docket: { listSessions } })

  const report = reportOf(outcome)
  // The row's exact command attaches through the socket this repo's own server derives —
  // the same name the start commands target for the same queue root — read off those
  // commands, never pinned, so the row cannot name a server the scheduler never asked.
  expect(report.rows.find(row => row.task === 'alpha')?.session).toEqual({
    listed: true,
    attach: `tmux -L ${derivedSocketFor(repo.root)} attach-session -t alpha`,
  })
  expect(report.rows.find(row => row.task === 'beta')?.session).toEqual({ listed: false })
  expect(asked).toBe(1)
})

// Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server
// Scenario: A session not listed is marked absent, and nothing further asked about it
// GIVEN a TASK whose name no session on the server carries
// WHEN the docket is answered
// THEN its row marks the session absent, and no second question is asked of the server about it
it('marks a session the server does not hold as absent, asking nothing further', async () => {
  const repo = await makeRepo({
    '.proofspec/dispatch/alpha/MANIFEST': manifestFor('alpha'),
    '.proofspec/dispatch/alpha/state': 'merged',
  })
  const questions: string[] = []
  const listSessions = async (): Promise<readonly string[]> => {
    questions.push('list-sessions')
    return []
  }

  const outcome = await docket({ cwd: repo.root, docket: { listSessions } })

  expect(reportOf(outcome).rows[0]?.session).toEqual({ listed: false })
  // The one list question the server was asked; nothing probed the absent session itself.
  expect(questions).toEqual(['list-sessions'])
})

const execFileAsync = promisify(execFile)

// Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server
// Scenario: The session list is asked of the dedicated server through PROOFSPEC_TMUX_SOCKET, with the same per-repo default
// GIVEN no socket override is set, and a queue root
// WHEN the session-list command and the attach command are built for that root
// THEN both reach that root's own derived server — the same per-repo default the start
//      commands target for the same root — and PROOFSPEC_TMUX_SOCKET moves both to the socket it names
it('asks the repo\'s own dedicated server for the session list, honoring the socket override', async () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  const queueRoot = '/repo'

  const derived = derivedSocketFor(queueRoot)

  expect(socketOf(tmuxListSessionsCommand(queueRoot))).toBe(derived)
  expect(socketOf(tmuxAttachCommand('alpha', queueRoot))).toBe(derived)

  // The runtime half: the docket's served ask is the zero-argument reader, which sources
  // its queue root from the cwd it runs in — the same fact PROOFSPEC_QUEUE_ROOT carries. A
  // session stands on a real root's own derived server, the reader runs from inside that
  // root, and the names come back — proving the runtime ask and the built command name one
  // server, with no override anywhere to hide a wrong root behind. `derivedSocketFor` holds
  // the shape before any tmux runs, so the red suite can never stand a session on the
  // machine's real bare-name server by way of the retired default.
  const root = await mkdtemp(join(tmpdir(), 'proofspec-docket-socket-'))
  const rootDerived = derivedSocketFor(root)
  const askDerived = (args: readonly string[]) => execFileAsync('tmux', ['-L', rootDerived, ...args])
  const wasCwd = process.cwd()
  try {
    await askDerived(['kill-server']).catch(() => {})
    await askDerived(['new-session', '-d', '-s', 'alpha', 'sleep', '60'])
    process.chdir(root)
    await expect(listTmuxSessions()).resolves.toEqual(['alpha'])
  } finally {
    process.chdir(wasCwd)
    await askDerived(['kill-server']).catch(() => {})
    await rm(root, { recursive: true, force: true })
  }

  process.env.PROOFSPEC_TMUX_SOCKET = 'proofspec-test-run-42'

  expect(tmuxListSessionsCommand(queueRoot)).toEqual({ command: 'tmux', args: ['-L', 'proofspec-test-run-42', 'list-sessions'] })
  expect(commandLine(tmuxAttachCommand('alpha', queueRoot))).toBe('tmux -L proofspec-test-run-42 attach-session -t alpha')
})

// Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server
// Scenario: The server's session list is read from tmux's own output, one name per line
// GIVEN the lines tmux's list-sessions writes, each naming a session before a colon
// WHEN the session names are read
// THEN each line's leading name is taken, and output that names nothing answers no sessions
it('reads the session names from tmux\'s own list output', () => {
  const output = ['alpha: 1 windows (created at ...) [attached]', 'beta: 2 windows (created at ...)'].join('\n')

  expect(parseSessionNames(output)).toEqual(['alpha', 'beta'])
  expect(parseSessionNames('')).toEqual([])
})
