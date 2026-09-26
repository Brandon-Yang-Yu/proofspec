// Capability: mcp

import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { compareStrings } from '../../src/order.ts'
import { cleanupRepos, makeRepo, type Repo } from '../cli/support.ts'

afterEach(cleanupRepos)

// --- driving the generation entry -----------------------------------------------------

/** The persona entry's own source, run as a real process the way the `personas:write`
 *  script runs it: generation's contract is what it does to a repo's folders on disk. */
const PERSONAS_ENTRY = fileURLToPath(new URL('../../src/personas/main.ts', import.meta.url))

/** This product's own checkout, whose shipped persona folders the last scenario reads. */
const PRODUCT_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const PI_AGENTS = '.pi/agents'
const CLAUDE_AGENTS = '.claude/agents'

/** How one generation run ended: its exit code and the stderr that names a failure's cause. */
type GenerationRun = { readonly code: number | null; readonly stderr: string }

/** Runs generation as a real process in the given repo root, which is where it reads
 *  `.pi/agents` and writes `.claude/agents`. */
function runGeneration(root: string): Promise<GenerationRun> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--experimental-transform-types', PERSONAS_ENTRY, 'write'], {
      cwd: root,
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

// --- persona fixtures -----------------------------------------------------------------

/** A pi persona file with the given tools line; the rest is a realistic, fixed frontmatter
 *  and body, so a scenario only has to say what it varies. */
function piPersona(options: { readonly name: string; readonly tools: string }): string {
  return [
    '---',
    `name: ${options.name}`,
    'description: >-',
    `  The ${options.name} persona, used by the generation tests.`,
    `tools: ${options.tools}`,
    '---',
    '',
    `You are the ${options.name}.`,
    '',
  ].join('\n')
}

/** A file split at its frontmatter fences: the lines between the two `---` lines, and every
 *  byte after the closing fence. */
type PersonaParts = { readonly frontmatterLines: readonly string[]; readonly body: string }

const FENCE = '---\n'

function splitPersona(content: string): PersonaParts {
  expect(content.startsWith(FENCE), 'a persona file opens with a frontmatter fence').toBe(true)
  const closingFence = content.indexOf(`\n${FENCE}`, FENCE.length - 1)
  expect(closingFence, 'a persona file closes its frontmatter').toBeGreaterThan(-1)
  const frontmatter = content.slice(FENCE.length, closingFence)
  const body = content.slice(closingFence + 1 + FENCE.length)
  return { frontmatterLines: frontmatter.split('\n'), body }
}

const TOOLS_PREFIX = 'tools:'

/** The names a persona file's frontmatter `tools:` line lists, in the order it lists them. */
function toolNames(content: string): readonly string[] {
  // Exactly one: a generator that adds the translated line but keeps the pi line would
  // otherwise pass, since the byte-for-byte test ignores every tools line.
  const toolsLines = splitPersona(content).frontmatterLines.filter(line => line.startsWith(TOOLS_PREFIX))
  expect(toolsLines, 'a persona file carries exactly one tools line').toHaveLength(1)
  return (toolsLines[0] ?? '')
    .slice(TOOLS_PREFIX.length)
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')
}

/** The generated persona for a one-file fixture repo whose pi persona lists `tools`. */
async function generateOne(tools: string): Promise<string> {
  const repo = await makeRepo({ [`${PI_AGENTS}/solo.md`]: piPersona({ name: 'solo', tools }) })
  const run = await runGeneration(repo.root)
  expect(run.code, run.stderr).toBe(0)
  return repo.read(`${CLAUDE_AGENTS}/solo.md`)
}

async function markdownNames(dir: string): Promise<readonly string[]> {
  const entries = await readdir(dir)
  return entries.filter(entry => entry.endsWith('.md')).sort(compareStrings)
}

/** The markdown files in a folder, or none when generation never created the folder. */
async function markdownNamesIfPresent(dir: string): Promise<readonly string[]> {
  try {
    return await markdownNames(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

// --- scenarios ------------------------------------------------------------------------

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation writes one Claude Code persona file for each pi persona file, under the same name
// GIVEN a set of pi persona files
// WHEN generation runs
// THEN there is exactly one Claude Code persona file for each pi persona file, carrying the same file name as its pi persona file
it('writes one Claude Code persona file per pi persona file, under the same name', async () => {
  // beta.md's frontmatter `name:` is not its file stem, so only naming each copy after its
  // pi persona's file name — not after the `name:` field — yields beta.md.
  const repo = await makeRepo({
    [`${PI_AGENTS}/alpha.md`]: piPersona({ name: 'alpha', tools: 'read' }),
    [`${PI_AGENTS}/beta.md`]: piPersona({ name: 'omega-runner', tools: 'bash' }),
    [`${PI_AGENTS}/gamma-delta.md`]: piPersona({ name: 'gamma-delta', tools: 'grep, edit' }),
  })

  const run = await runGeneration(repo.root)

  expect(run.code, run.stderr).toBe(0)
  expect(await markdownNames(join(repo.root, CLAUDE_AGENTS))).toEqual(['alpha.md', 'beta.md', 'gamma-delta.md'])
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation keeps the body and every frontmatter line other than the tools line byte for byte
// GIVEN a pi persona file with a frontmatter block holding a tools line and other lines, and a body after it
// WHEN generation runs
// THEN the generated Claude Code persona file's body and every frontmatter line other than the tools line are byte for byte the source's
it('keeps the body and every non-tools frontmatter line byte for byte', async () => {
  // The body holds text that looks like a tools line and a stray fence, and keeps trailing
  // spaces and a missing final newline, so only a byte-for-byte copy survives it.
  const source = [
    '---',
    'name: keeper',
    'description: >-',
    '  Keeps things exactly — including "quotes", `ticks`, and a trailing space. ',
    'tools: read, bash',
    'model: opus',
    '---',
    '',
    'You are the **keeper**.   ',
    '',
    'tools: read, write',
    '---',
    '\tIndented with a tab.',
    'Last line without a newline',
  ].join('\n')
  const repo = await makeRepo({ [`${PI_AGENTS}/keeper.md`]: source })

  const run = await runGeneration(repo.root)

  expect(run.code, run.stderr).toBe(0)
  const generated = splitPersona(await repo.read(`${CLAUDE_AGENTS}/keeper.md`))
  const original = splitPersona(source)
  expect(generated.body).toBe(original.body)
  const withoutTools = (lines: readonly string[]): readonly string[] => lines.filter(line => !line.startsWith(TOOLS_PREFIX))
  expect(withoutTools(generated.frontmatterLines)).toEqual(withoutTools(original.frontmatterLines))
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation translates each pi tool name to its own Claude Code name
// GIVEN a pi persona file whose tools line lists only `<pi name>`
// WHEN generation runs
// THEN the generated file's tools line is exactly `<Claude Code name>`, with no other name
it.each([
  { piName: 'read', claudeName: 'Read' },
  { piName: 'write', claudeName: 'Write' },
  { piName: 'edit', claudeName: 'Edit' },
  { piName: 'grep', claudeName: 'Grep' },
  { piName: 'find', claudeName: 'Glob' },
  { piName: 'ls', claudeName: 'Glob' },
  { piName: 'bash', claudeName: 'Bash' },
  { piName: 'subagent', claudeName: 'Agent' },
  { piName: 'enqueue_task', claudeName: 'mcp__proofspec__enqueue_task' },
  { piName: 'census_in_flight', claudeName: 'mcp__proofspec__census_in_flight' },
])('translates the pi tool $piName to $claudeName', async ({ piName, claudeName }) => {
  const generated = await generateOne(piName)

  expect(toolNames(generated)).toEqual([claudeName])
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation lists the Claude Code name of every name on a tools line holding several names
// GIVEN a pi persona file whose tools line lists `read`, `write`, `grep`, and `bash`
// WHEN generation runs
// THEN the generated file's tools line lists exactly `Read`, `Write`, `Grep`, and `Bash`, in any order, and no other name
it('translates every name on a tools line holding several names', async () => {
  const generated = await generateOne('read, write, grep, bash')

  const listed = [...toolNames(generated)].sort(compareStrings)
  expect(listed).toEqual(['Bash', 'Grep', 'Read', 'Write'])
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: A Claude Code name reached from two pi names appears once on the tools line
// GIVEN a pi persona file whose tools line lists both `find` and `ls`, and no other name
// WHEN generation runs
// THEN the generated file's tools line is exactly `Glob`, listed once, with no other name
it('lists a Claude Code name reached from two pi names once', async () => {
  const generated = await generateOne('find, ls')

  expect(toolNames(generated)).toEqual(['Glob'])
})

// A name no mapping row carries, placed between two known names so a translation that
// skips it silently would still produce a plausible tools line.
const UNKNOWN_TOOL = 'teleport_widget'

async function makeRepoWithUnknownTool(): Promise<Repo> {
  return makeRepo({
    [`${PI_AGENTS}/stray.md`]: piPersona({ name: 'stray', tools: `read, ${UNKNOWN_TOOL}, bash` }),
  })
}

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation fails, naming a tool name the mapping does not carry
// GIVEN a pi persona file whose tools line lists a name the mapping does not carry
// WHEN generation runs
// THEN generation fails, and its output names that tool name
it('fails, naming a tool name the mapping does not carry', async () => {
  const repo = await makeRepoWithUnknownTool()

  const run = await runGeneration(repo.root)

  expect(run.code).not.toBe(0)
  expect(run.code).not.toBeNull()
  expect(run.stderr).toContain(UNKNOWN_TOOL)
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: Generation writes no Claude Code persona file that drops a tool name the mapping does not carry
// GIVEN a pi persona file whose tools line lists a name the mapping does not carry
// WHEN generation runs
// THEN no Claude Code persona file for it holds a tools line with that name dropped
it('writes no Claude Code persona file that drops a tool name the mapping does not carry', async () => {
  const repo = await makeRepoWithUnknownTool()

  const run = await runGeneration(repo.root)

  // Writing nothing satisfies this scenario, so only a run that got as far as refusing the
  // unknown name — not one that crashed before reading any persona — may pass it.
  expect(run.code, run.stderr).not.toBeNull()
  expect(run.stderr, 'generation ran and refused the unknown tool name').toContain(UNKNOWN_TOOL)
  const produced = await markdownNamesIfPresent(join(repo.root, CLAUDE_AGENTS))
  for (const name of produced) {
    const content = await readFile(join(repo.root, CLAUDE_AGENTS, name), 'utf8')
    expect(toolNames(content), `${CLAUDE_AGENTS}/${name} drops ${UNKNOWN_TOOL}`).toContain(UNKNOWN_TOOL)
  }
})

// Requirement: Each Claude Code persona file is generated from its pi persona file, with the tools line translated
// Scenario: The Claude Code persona files this product ships are what generation produces from its pi persona files
// GIVEN this product's own `.pi/agents` and `.claude/agents` folders
// WHEN each shipped Claude Code persona file is compared with what generation produces from its pi persona file
// THEN every one matches, and no pi persona file lacks one
it("matches this product's shipped Claude Code persona files against fresh generation", async () => {
  // Generation runs on a copy, so proving the shipped files never rewrites them.
  const piNames = await markdownNames(join(PRODUCT_ROOT, PI_AGENTS))
  const copies = await Promise.all(
    piNames.map(async name => [`${PI_AGENTS}/${name}`, await readFile(join(PRODUCT_ROOT, PI_AGENTS, name), 'utf8')] as const),
  )
  const copy = await makeRepo(Object.fromEntries(copies))

  const run = await runGeneration(copy.root)

  expect(run.code, run.stderr).toBe(0)
  const shippedNames = await markdownNames(join(PRODUCT_ROOT, CLAUDE_AGENTS))
  expect(shippedNames).toEqual(piNames)
  for (const name of piNames) {
    const shipped = await readFile(join(PRODUCT_ROOT, CLAUDE_AGENTS, name), 'utf8')
    expect(shipped, `${CLAUDE_AGENTS}/${name}`).toBe(await copy.read(`${CLAUDE_AGENTS}/${name}`))
  }
})
