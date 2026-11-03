// Capability: progress

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { discoverAndLoadExtensions, ExtensionRunner, SessionManager } from '@earendil-works/pi-coding-agent'
import type { ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent'

const PINNED_EXTENSION = join(import.meta.dirname, '..', '..', '.pi', 'extensions', 'progress.ts')

const scratchDirs: string[] = []
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/** Loads the extension file the executor's pi invocation pins, through pi's own loader and
 *  pi's own runner — what is proved is what pi itself does with the file, not what a
 *  stand-in for pi was guessed to do. An empty agent folder keeps the user's own global
 *  extensions out of the load. */
async function piRunnerFor(extensionPath: string): Promise<ExtensionRunner> {
  const cwd = await mkdtemp(join(tmpdir(), 'proofspec-name-kill-'))
  scratchDirs.push(cwd)
  const loaded = await discoverAndLoadExtensions([extensionPath], cwd, join(cwd, 'agent'))
  expect(loaded.errors, 'pi failed to load the pinned extension').toEqual([])
  return new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), undefined as never)
}

/** What pi's runner answers for one call of `toolName` with `input`, before the tool runs. */
async function preflight(runner: ExtensionRunner, toolName: string, input: Record<string, unknown>): Promise<ToolCallEventResult | undefined> {
  const event = { type: 'tool_call', toolCallId: 'call-1', toolName, input } as unknown as ToolCallEvent
  return runner.emitToolCall(event)
}

// Requirement: A pi session refuses a bash call that kills processes by name
// Scenario: A bash call that kills processes by name is refused before it runs, and told to kill by PID instead
// GIVEN pi has loaded the executor's pinned extension
// WHEN the session makes a bash call with pkill, killall, or pgrep piped or substituted into kill, alone or after other commands
// THEN each call is blocked before it runs, with a reason that says to stop only what it started, by PID
it('refuses a bash call that kills processes by name, before it runs', async () => {
  const runner = await piRunnerFor(PINNED_EXTENSION)
  const nameKills = [
    'pkill -f "spec:review"',
    'cd x && pkill -9 node',
    'sudo killall node',
    'pgrep -f vitest | xargs kill',
    'pgrep -f vitest | xargs -r kill -9',
    'kill $(pgrep -f vitest)',
    'echo done; (pkill tmux)',
  ]
  for (const command of nameKills) {
    const answer = await preflight(runner, 'bash', { command })
    expect(answer?.block, `not blocked: ${command}`).toBe(true)
    expect(answer?.reason ?? '').toContain('kill <pid>')
  }
})

// Requirement: A pi session refuses a bash call that kills processes by name
// Scenario: A bash call that kills by PID, or only names a kill command as text, runs as asked
// GIVEN pi has loaded the executor's pinned extension
// WHEN the session makes a bash call that kills by PID, kills a tmux session by name, lists processes with pgrep, or only mentions pkill as text
// THEN none of those calls is blocked
it('lets a bash call that kills by PID, or only names a kill command as text, run as asked', async () => {
  const runner = await piRunnerFor(PINNED_EXTENSION)
  const allowed = [
    'kill 29031 34563',
    'tmux -L x kill-session -t a',
    'pgrep -fl vitest',
    'grep -n pkill notes.md',
    'echo "never use pkill here"',
  ]
  for (const command of allowed) {
    const answer = await preflight(runner, 'bash', { command })
    expect(answer?.block ?? false, `blocked: ${command}`).toBe(false)
  }
})

// Requirement: A pi session refuses a bash call that kills processes by name
// Scenario: The guard loads on its own as a pi extension, outside the executor's pinned one
// GIVEN pi has loaded only the guard's own module as an extension
// WHEN the session makes a bash call with pkill
// THEN the call is blocked before it runs
it('blocks a name kill when pi loads the guard module on its own', async () => {
  const runner = await piRunnerFor(join(import.meta.dirname, '..', '..', 'src', 'progress', 'name-kill.ts'))
  const answer = await preflight(runner, 'bash', { command: 'pkill -f "spec:review"' })
  expect(answer?.block).toBe(true)
})
