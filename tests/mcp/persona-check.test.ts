// Capability: mcp

import { spawn } from 'node:child_process'
import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { cleanupRepos, makeRepo, type Repo } from '../cli/support.ts'

afterEach(cleanupRepos)

// --- driving the personas entry -------------------------------------------------------

/** The personas entry's own source, run as a real process the way `personas:write` and
 *  `personas:check` run it: the check's contract is its exit code and what it names on
 *  failure, so the test holds the process to account, not an imported function. */
const PERSONAS_ENTRY = fileURLToPath(new URL('../../src/personas/main.ts', import.meta.url))

type PersonasCommand = 'write' | 'check'

/** How one run of the entry ended: its exit code, and the stderr a failure names its cause
 *  in. */
type EntryRun = { readonly code: number | null; readonly stderr: string }

/** Runs one personas command with the fixture repo as its working directory — the repo root
 *  it reads `.pi/agents` from and writes or compares `.claude/agents` in. */
function runPersonas(repo: Repo, command: PersonasCommand): Promise<EntryRun> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--experimental-transform-types', PERSONAS_ENTRY, command], {
      cwd: repo.root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', error => resolve({ code: null, stderr: `${stderr}\n${String(error)}` }))
    child.once('exit', code => resolve({ code, stderr }))
  })
}

// --- fixture personas -----------------------------------------------------------------

/** A pi persona file in the shape `.pi/agents` holds: frontmatter with a tools line, then a
 *  body. */
function piPersona(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: The ${name} persona.`,
    'tools: read, grep, find, bash',
    '---',
    '',
    `You are the **${name}**.`,
    '',
  ].join('\n')
}

/** A fixture repo holding two pi personas and the Claude Code copies generation produced
 *  from them — the matching state every scenario here starts from, reached through the
 *  real generation command so no test hand-writes what generation "would" produce. The
 *  two file names share no substring, so naming one cannot be mistaken for naming the
 *  other. implementer.md's `name:` is not its file stem, so a check that pairs files by
 *  the `name:` field instead of by file name looks for a copy that is not there. */
async function makeGeneratedRepo(): Promise<Repo> {
  const repo = await makeRepo({
    '.pi/agents/explorer.md': piPersona('explorer'),
    '.pi/agents/implementer.md': piPersona('builder'),
  })
  const generation = await runPersonas(repo, 'write')
  expect(generation.code, generation.stderr).toBe(0)
  return repo
}

// Requirement: A check fails when a Claude Code persona file is not what generation would produce
// Scenario: The check passes when every Claude Code persona file is what generation would produce
// GIVEN pi persona files and, for each, the Claude Code persona file generation would produce, and no other Claude Code persona file
// WHEN the check runs
// THEN the check passes
it('the check passes when every Claude Code persona file is what generation would produce', async () => {
  const repo = await makeGeneratedRepo()

  const check = await runPersonas(repo, 'check')

  expect(check.code, check.stderr).toBe(0)
})

// Requirement: A check fails when a Claude Code persona file is not what generation would produce
// Scenario: The check fails, naming the file, when a Claude Code persona file differs from what generation would produce
// GIVEN a Claude Code persona file that differs from what generation would produce from its pi persona file
// WHEN the check runs
// THEN the check fails, naming that Claude Code persona file
it('the check fails, naming the file, when a Claude Code persona file differs from what generation would produce', async () => {
  const repo = await makeGeneratedRepo()
  // The source gains a line after generation, so the copy is stale: only a check that
  // generates afresh — not one comparing against a stored snapshot — can see it.
  await appendFile(join(repo.root, '.pi/agents/explorer.md'), 'A line the source gained after generation.\n')

  const staleSource = await runPersonas(repo, 'check')

  expect(staleSource.code).not.toBe(0)
  expect(staleSource.stderr).toContain('.claude/agents/explorer.md')
  expect(staleSource.stderr).not.toContain('implementer.md')

  // A hand edit to the generated copy leaves the source untouched, so only a check that
  // compares the copy's own content — not the source's timestamp or a stored hash — sees it.
  // The edit swaps one character, so the copy keeps its length and line count and only a
  // byte comparison tells it apart.
  const regeneration = await runPersonas(repo, 'write')
  expect(regeneration.code, regeneration.stderr).toBe(0)
  const copyPath = join(repo.root, '.claude/agents/explorer.md')
  const generatedCopy = await readFile(copyPath, 'utf8')
  const handEdited = generatedCopy.replace('You are the **explorer**.', 'You are the **explorer**!')
  expect(handEdited, 'the hand edit changes the copy').not.toBe(generatedCopy)
  await writeFile(copyPath, handEdited)

  const handEditedCopy = await runPersonas(repo, 'check')

  expect(handEditedCopy.code).not.toBe(0)
  expect(handEditedCopy.stderr).toContain('.claude/agents/explorer.md')
  expect(handEditedCopy.stderr).not.toContain('implementer.md')
})

// Requirement: A check fails when a Claude Code persona file is not what generation would produce
// Scenario: The check fails, naming the file, when a pi persona file has no Claude Code persona file
// GIVEN a pi persona file with no Claude Code persona file of the same name
// WHEN the check runs
// THEN the check fails, naming the pi persona file that has no copy
it('the check fails, naming the file, when a pi persona file has no Claude Code persona file', async () => {
  const repo = await makeGeneratedRepo()
  await rm(join(repo.root, '.claude/agents/explorer.md'))

  const check = await runPersonas(repo, 'check')

  expect(check.code).not.toBe(0)
  expect(check.stderr).toContain('.pi/agents/explorer.md')
  expect(check.stderr).not.toContain('implementer.md')
})

// Requirement: A check fails when a Claude Code persona file is not what generation would produce
// Scenario: The check fails, naming the file, when a Claude Code persona file has no pi persona file
// GIVEN a Claude Code persona file with no pi persona file of the same name
// WHEN the check runs
// THEN the check fails, naming that Claude Code persona file
it('the check fails, naming the file, when a Claude Code persona file has no pi persona file', async () => {
  const repo = await makeGeneratedRepo()
  // The stray copy is byte for byte explorer's generated copy, `name: explorer` included, so
  // a check that pairs files by the `name:` field would call it explorer's copy and pass.
  const explorerCopy = await readFile(join(repo.root, '.claude/agents/explorer.md'), 'utf8')
  await writeFile(join(repo.root, '.claude/agents/stray.md'), explorerCopy)

  const check = await runPersonas(repo, 'check')

  expect(check.code).not.toBe(0)
  expect(check.stderr).toContain('.claude/agents/stray.md')
  expect(check.stderr).not.toContain('explorer.md')
  expect(check.stderr).not.toContain('implementer.md')
})
