// Capability: mcp

import { spawn } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { resolveSessionWorktree, tmuxSessionCommands } from '../../src/cli/session.ts'
import { cleanupRepos, enterTask, makeGitRepo } from '../cli/support.ts'

afterEach(cleanupRepos)
// PROOFSPEC_EXECUTOR is this change's own new override — deleted unconditionally, the same
// guard `session.test.ts` keeps for PROOFSPEC_TMUX_SOCKET, so an assertion thrown mid-body
// cannot leak the claude choice into any later test's ambient environment.
afterEach(() => {
  delete process.env.PROOFSPEC_EXECUTOR
})

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

// Requirement: The MCP server runs from the queue root's own checkout, never the TASK's worktree
// Scenario: The MCP server a session loads runs from the queue root's own checkout, never the TASK's worktree
// GIVEN a queue root, and a TASK whose worktree holds a copy of the tool surface that
//      differs from the queue root's own
// WHEN the MCP server for that TASK's session is started
// THEN the server that answers is the queue root's — its answers come from the queue
//      root's current checkout, never from the worktree's copy
it('runs the session\'s MCP server from the queue root\'s own checkout, never the TASK\'s worktree', async () => {
  const repo = await makeGitRepo({ 'a.txt': 'a' })
  await enterTask(repo, 'a', { edit: 'a.txt' })
  const queueRoot = repo.root
  const worktree = await resolveSessionWorktree(queueRoot, 'a')
  process.env.PROOFSPEC_EXECUTOR = 'claude'

  // The one place the server a dispatched Claude Code session loads is named: the start
  // command such a session runs. How the config reaches the argv — inline JSON, or a file
  // resolved against the queue root — is wiring this claim leaves to the implementation;
  // which server it names is not.
  const [, start] = tmuxSessionCommands('a', { worktree, queueRoot, systemPrompt: 'you are the executor' })
  const configIndex = start.args.indexOf('--mcp-config')
  // Where the absence shows while no claude invocation is built at all: no config is
  // carried, so this assertion fires before anything downstream is ever reached.
  expect(configIndex).toBeGreaterThan(-1)
  const carried = start.args[configIndex + 1]!
  const configText = carried.trimStart().startsWith('{') ? carried : await readFile(resolve(queueRoot, carried), 'utf8')
  const config = JSON.parse(configText) as { mcpServers?: Record<string, ServerStart> }
  const servers = Object.values(config.mcpServers ?? {})
  expect(servers.length).toBeGreaterThan(0)

  // The GIVEN's differing copies, stood up where the config's own words point: the queue
  // root's copy answers its marker at the path the config names, and the worktree's
  // differing copy answers the other marker at the same relative path inside the TASK's
  // worktree — so a config naming the worktree, or naming a path the session's own
  // working directory resolves, runs the worktree's copy and answers its marker instead.
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

  // WHEN, made real without a live `claude` run: the server is started exactly the way the
  // dispatched session's harness starts it — the config's own command and args, its own
  // env, from the session's own working directory, the TASK's worktree.
  const runStart = (server: ServerStart): Promise<string> =>
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
        cwd: worktree,
        env: { ...process.env, ...envAdditions },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
      // A real stdio MCP server waits on stdin it never gets here; the stand-in exits on
      // its own, and the kill is only the bound so a wrong entry cannot hang the proof.
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
  const answers = (await Promise.all(servers.map(runStart))).join('\n')

  // THEN: the answer is the queue root's — never the worktree's differing copy.
  expect(answers).toContain(FROM_QUEUE_ROOT)
  expect(answers).not.toContain(FROM_WORKTREE)
}, 15000)
