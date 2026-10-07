// Capability: mcp

import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveSessionWorktree, tmuxSessionCommands } from '../../src/cli/session.ts'
import type { TmuxCommand } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)

/** What the queue root's own copy of the tool surface answers, and what the TASK's
 *  worktree's differing copy answers. Two different strings, because against two identical
 *  copies no observation could tell which checkout had answered — the differing copy is
 *  what makes "the queue root's server" a falsifiable claim rather than a tautology. */
const FROM_QUEUE_ROOT = 'the queue root\'s own checkout answered'
const FROM_WORKTREE = 'the TASK\'s worktree copy answered'

/** A stand-in for the tool surface's entry file: plain JavaScript, so whichever runner the
 *  config names executes it — `node`, `tsx`, or node under `--experimental-transform-types`
 *  alike — answering its marker on stdout and exiting, which is all the observation needs. */
const standIn = (answer: string) =>
  `#!/usr/bin/env node\nconsole.log(${JSON.stringify(answer)})\n`

/** One server entry in a Claude Code MCP config, read loosely — `command`/`args`/`env` is
 *  Claude Code's own config shape, not this implementation's to choose. */
type ServerStart = { readonly command?: unknown; readonly args?: unknown; readonly env?: unknown }

/** Every string token of a server's start — its command and its args — the places a config
 *  can name the file it runs from. */
const startTokens = (server: ServerStart): readonly string[] =>
  [server.command, ...(Array.isArray(server.args) ? server.args : [])]
    .filter((token): token is string => typeof token === 'string' && token !== '')

/** Whether `path` sits strictly inside `root` — the root itself is a directory, never the
 *  entry file. */
const sitsUnder = (root: string, path: string): boolean => {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Places one differing copy of the tool surface at `path`, unless something real already
 *  stands there — the stand-in takes only the place the config itself pointed at. */
const plant = async (path: string, answer: string): Promise<void> => {
  try {
    await stat(path)
    return
  } catch {
    // nothing stands there: the stand-in may take the place
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, standIn(answer), { mode: 0o755 })
}

/** The servers a start command's generated MCP config names. The one place the server a
 *  dispatched Claude Code session loads is named is the start command such a session runs;
 *  the config rides a generated file whose path the session environment carries (the same
 *  size reason every payload rides a file) — inline JSON or a path, whichever the entry
 *  holds. How the config reaches the harness is wiring the claims leave to the
 *  implementation; which server it names is not. */
const readMcpServers = async (start: TmuxCommand, queueRoot: string): Promise<readonly ServerStart[]> => {
  const configEnvIndex = start.args.findIndex(arg => arg.startsWith('PROOFSPEC_MCP_CONFIG='))
  // Where the absence shows while no claude invocation is built at all: no config path is
  // carried, so this assertion fires before anything downstream is ever reached.
  expect(configEnvIndex, 'the start command carries no MCP config path in its environment').toBeGreaterThan(-1)
  expect(start.args[configEnvIndex - 1]).toBe('-e')
  const carried = start.args[configEnvIndex]!.slice('PROOFSPEC_MCP_CONFIG='.length)
  const configText = carried.trimStart().startsWith('{') ? carried : await readFile(resolve(queueRoot, carried), 'utf8')
  const config = JSON.parse(configText) as { mcpServers?: Record<string, ServerStart> }
  const servers = Object.values(config.mcpServers ?? {})
  expect(servers.length, 'the config names no MCP server at all').toBeGreaterThan(0)
  return servers
}

/** Stands up the GIVEN's differing copies where the config's own words point: the queue
 *  root's copy answers its marker at the path the config names, and the worktree's
 *  differing copy answers the other marker at the same relative path inside the TASK's
 *  worktree — so a config naming the worktree, or naming a path the session's own working
 *  directory resolves, runs the worktree's copy and answers its marker instead. A place
 *  where something real already stands is left standing. */
const plantDifferingCopies = async (
  servers: readonly ServerStart[],
  roots: { readonly queueRoot: string; readonly worktree: string },
): Promise<void> => {
  const { queueRoot, worktree } = roots
  for (const server of servers) {
    for (const token of startTokens(server)) {
      if (isAbsolute(token)) {
        // The worktree sits under the queue root, so the deeper relation is tested first:
        // a token naming the TASK's worktree is exactly the violation this requirement
        // exists to catch, and it must carry the worktree's differing marker — not be
        // swallowed by the queue-root branch it also sits under.
        if (sitsUnder(worktree, token)) {
          await plant(token, FROM_WORKTREE)
          await plant(join(queueRoot, relative(worktree, token)), FROM_QUEUE_ROOT)
        } else if (sitsUnder(queueRoot, token)) {
          await plant(token, FROM_QUEUE_ROOT)
          await plant(join(worktree, relative(queueRoot, token)), FROM_WORKTREE)
        }
      } else if (token.includes('/')) {
        // A relative path is resolved by the runner against its working directory — the
        // TASK's worktree, where the dispatched session runs — so both roots get their
        // differing copy at that relative path, and which one answers is observable.
        await plant(join(worktree, token), FROM_WORKTREE)
        await plant(join(queueRoot, token), FROM_QUEUE_ROOT)
      }
    }
  }
}

/** Starts one named server exactly the way the dispatched session's harness starts it —
 *  the config's own command and args, its own env, from the session's own working
 *  directory, the TASK's worktree — and answers what it printed on stdout: the WHEN made
 *  real without a live `claude` run. A real stdio MCP server waits on stdin it never gets
 *  here; the stand-in exits on its own, and the kill is only the bound so a wrong entry
 *  cannot hang the proof. */
const startServerFrom = (server: ServerStart, cwd: string): Promise<string> =>
  new Promise(done => {
    const command = typeof server.command === 'string' ? server.command : ''
    const args = (Array.isArray(server.args) ? server.args : [])
      .filter((arg): arg is string => typeof arg === 'string')
    const envAdditions = server.env !== null && typeof server.env === 'object' && !Array.isArray(server.env)
      ? Object.fromEntries(
          Object.entries(server.env as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        )
      : {}
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...envAdditions },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    const timer = setTimeout(() => child.kill(), 4000)
    child.once('error', () => {
      clearTimeout(timer)
      done(stdout)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      done(stdout)
    })
  })

// Requirement: The MCP server is the ProofSpec copy the queue root holds, never the TASK's worktree's
// Scenario: When the queue root is ProofSpec's own checkout, the MCP server a session loads runs from that checkout's own src/mcp/serve.ts, never the TASK's worktree's
// GIVEN a queue root that is ProofSpec's own checkout, and a TASK whose worktree holds a
//      copy of the tool surface that differs from the checkout's own
// WHEN the MCP server for that TASK's session is started
// THEN the server that answers is that checkout's own src/mcp/serve.ts — the queue
//      root's current copy, never the worktree's
it('runs the session\'s MCP server from the queue root\'s own checkout, never the TASK\'s worktree', async () => {
  // The queue root is pinned as ProofSpec's own checkout so any correct detection reads it
  // that way: its package.json is named `proofspec`, and its own src/mcp/serve.ts — the
  // entry this case's server runs from — stands at config-build time, whichever signal the
  // detection leans on. The worktree's copy is the branch-cut one (stale, as a cut
  // branch's is) and answers the worktree's marker; the checkout's current copy, rewritten
  // in the queue root after the branch was cut, answers the queue root's.
  const repo = await makeGitRepo({
    'a.txt': 'a',
    'package.json': `${JSON.stringify({ name: 'proofspec' }, null, 2)}\n`,
    'src/mcp/serve.ts': standIn(FROM_WORKTREE),
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // A Claude Code session: the TASK's executor record names claude — the settings file is the
  // project's, the record the TASK's own, and the record decides first.
  await repo.write('.proofspec/dispatch/a/executor', 'claude')
  const queueRoot = repo.root
  const worktree = await resolveSessionWorktree(queueRoot, 'a')
  await repo.write('src/mcp/serve.ts', standIn(FROM_QUEUE_ROOT))

  const [, start] = tmuxSessionCommands('a', { worktree, queueRoot, systemPrompt: 'you are the executor' })
  const servers = await readMcpServers(start, queueRoot)

  // Proof-level tightener under the claim, not claim text — the STANDARD names the server,
  // not the runner's flags: for a queue root that is ProofSpec's own checkout, the config
  // names that checkout's own src/mcp/serve.ts. Without this pin the run-phase machinery
  // below cannot tell which queue-root file answered, and an implementation naming any
  // other file under the queue root would pass the markers while breaking this case's
  // rule.
  const checkoutEntry = join(queueRoot, 'src', 'mcp', 'serve.ts')
  for (const server of servers) {
    expect(
      startTokens(server),
      'the server the config names is not the checkout\'s own src/mcp/serve.ts',
    ).toContain(checkoutEntry)
  }

  await plantDifferingCopies(servers, { queueRoot, worktree })
  const answers = (await Promise.all(servers.map(server => startServerFrom(server, worktree)))).join('\n')

  // THEN: the answer is the queue root's — never the worktree's differing copy.
  expect(answers).toContain(FROM_QUEUE_ROOT)
  expect(answers).not.toContain(FROM_WORKTREE)
}, 15000)

// Requirement: The MCP server is the ProofSpec copy the queue root holds, never the TASK's worktree's
// Scenario: When the queue root is a project that installed ProofSpec, the MCP server a session loads runs from the installed package's built server, never the TASK's worktree's
// GIVEN a queue root that holds ProofSpec only as an installed package — the package's
//      built server at node_modules/proofspec/dist/mcp/serve.js under the queue root —
//      and a TASK whose worktree holds a copy of the tool surface that differs from it
// WHEN the MCP server for that TASK's session is started
// THEN the server that answers is the installed package's built server under the queue
//      root — never the worktree's copy
it('runs the session\'s MCP server from the installed package\'s built server, never the TASK\'s worktree', async () => {
  // The queue root is pinned as a project that installed ProofSpec: its package.json is
  // named anything but `proofspec`, nothing stands at its own src/mcp/serve.ts, and the
  // installed package's built server does stand under its node_modules — planted after the
  // worktree exists because an install is not part of the project's own git, so nothing of
  // it reaches the worktree the branch cut. The worktree's differing copy at the same
  // relative path is planted below, where the config's own words point.
  const repo = await makeGitRepo({
    'a.txt': 'a',
    'package.json': `${JSON.stringify({ name: 'acme-app' }, null, 2)}\n`,
  })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  // A Claude Code session: the TASK's executor record names claude — the settings file is the
  // project's, the record the TASK's own, and the record decides first.
  await repo.write('.proofspec/dispatch/a/executor', 'claude')
  const queueRoot = repo.root
  const worktree = await resolveSessionWorktree(queueRoot, 'a')
  await plant(join(queueRoot, 'node_modules', 'proofspec', 'dist', 'mcp', 'serve.js'), FROM_QUEUE_ROOT)

  const [, start] = tmuxSessionCommands('a', { worktree, queueRoot, systemPrompt: 'you are the executor' })
  const servers = await readMcpServers(start, queueRoot)

  // Proof-level tighteners under the claim, not claim text — the STANDARD names the
  // server, not the runner's flags: the config names the installed package's built server
  // under the queue root, started by plain `node` (it is built JavaScript, needing no
  // TypeScript transform), and no start token names anything inside the TASK's worktree
  // or the checkout entry src/mcp/serve.ts, which is not this root's server at all.
  const installedServer = join(queueRoot, 'node_modules', 'proofspec', 'dist', 'mcp', 'serve.js')
  for (const server of servers) {
    const tokens = startTokens(server)
    expect(tokens, 'the server the config names is not the installed package\'s built server').toContain(installedServer)
    expect(server.command, 'the built server is not started by plain node').toBe('node')
    expect(tokens, 'built JavaScript needs no TypeScript transform flag to run').not.toContain('--experimental-transform-types')
    for (const token of tokens) {
      // An absolute token names the worktree's copy directly; a relative one is resolved
      // by the runner against the session's working directory — the TASK's worktree — so
      // either shape names the worktree's copy.
      const namesTheWorktree = isAbsolute(token) ? sitsUnder(worktree, token) : token.includes('/')
      expect(namesTheWorktree, 'a start token names a copy inside the TASK\'s worktree').toBe(false)
      expect(token.endsWith(join('src', 'mcp', 'serve.ts')), 'a start token names the checkout entry src/mcp/serve.ts').toBe(false)
    }
  }

  await plantDifferingCopies(servers, { queueRoot, worktree })
  const answers = (await Promise.all(servers.map(server => startServerFrom(server, worktree)))).join('\n')

  // THEN: the answer is the installed package's — never the worktree's differing copy.
  expect(answers).toContain(FROM_QUEUE_ROOT)
  expect(answers).not.toContain(FROM_WORKTREE)
}, 15000)
