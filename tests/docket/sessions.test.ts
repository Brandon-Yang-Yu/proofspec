// Capability: docket

import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { docket } from '../../src/cli/index.ts'
import { commandLine, parseSessionNames, tmuxAttachCommand, tmuxListSessionsCommand } from '../../src/cli/session.ts'
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
  return JSON.stringify({ intentRef: 'docs/x.md', branch: `work/${task}` })
}

// The dedicated server's own name for a queue root — proofspec- plus the first 8 hex digits
// of the root's SHA-256 digest. Computed here from the rule so a proof pins that the name
// follows the path, never a literal string the implementation could share by accident.
function derivedSocket(queueRoot: string): string {
  return `proofspec-${createHash('sha256').update(queueRoot).digest('hex').slice(0, 8)}`
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
  expect(report.rows.find(row => row.task === 'alpha')?.session).toEqual({
    listed: true,
    attach: `tmux -L ${derivedSocket(repo.root)} attach-session -t alpha`,
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

// Requirement: A row carries where the TASK's session lives, read from the dedicated tmux server
// Scenario: The session list is asked of the dedicated server through PROOFSPEC_TMUX_SOCKET, with the same default
// GIVEN no socket override is set
// WHEN the session-list command and the attach command are built
// THEN both reach the dedicated server, and PROOFSPEC_TMUX_SOCKET moves both to the socket it names
it('asks the dedicated server for the session list, honoring the socket override', () => {
  delete process.env.PROOFSPEC_TMUX_SOCKET
  const queueRoot = '/repo'

  expect(tmuxListSessionsCommand(queueRoot)).toEqual({ command: 'tmux', args: ['-L', derivedSocket(queueRoot), 'list-sessions'] })
  expect(commandLine(tmuxAttachCommand('alpha', queueRoot))).toBe(`tmux -L ${derivedSocket(queueRoot)} attach-session -t alpha`)

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
