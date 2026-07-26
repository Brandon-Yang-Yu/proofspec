import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { compareStrings } from '../../src/order.ts'

/**
 * `cli` is the one capability that owns the filesystem, so its tests give it a real one: a
 * throwaway directory laid out like a repo. Everything else in OpenTDD is proven against
 * strings, but "checking never writes" and "runs with no configuration" are claims about
 * files on disk, and only a disk can hold them to account.
 */

/** The capability every fixture repo declares, named once because the scan reads it back. */
export const CAPABILITY = 'demo'

/** The requirement every fixture scenario is tagged with. */
export const REQUIREMENT = 'A demonstrated promise'

/** Where a fixture's tests live unless a test keeps them somewhere else. */
export const TEST_PATH = 'tests/demo.test.ts'

export type Repo = {
  readonly root: string
  /** The current bytes of a file, by its path within the repo. */
  read(path: string): Promise<string>
}

const toClean: string[] = []

/**
 * Writes the given files into a fresh temp directory and hands back its root. Registers the
 * directory for `cleanupRepos` so a test does not have to unwind it by hand.
 */
export async function makeRepo(files: Readonly<Record<string, string>>): Promise<Repo> {
  const root = await mkdtemp(join(tmpdir(), 'opentdd-cli-'))
  toClean.push(root)
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, content)
  }
  return {
    root,
    read: path => readFile(join(root, path), 'utf8'),
  }
}

/** Removes every repo made this far. A test file wires this into `afterEach`. */
export async function cleanupRepos(): Promise<void> {
  const roots = toClean.splice(0)
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
}

/** How a fixture names the capability and requirement its scenarios sit under. */
type Tags = {
  readonly capability?: string
  readonly requirement?: string
}

/**
 * A test file proving one scenario per title, each carrying a THEN so it is a proof site
 * with a claim rather than a stepless one. The tags sit in comments, which is what a real
 * proof site looks like; the file needs no imports because the scan parses, never runs it.
 * A second capability can be given so a repo can hold more than one.
 */
export function testFile(scenarios: readonly string[], tags: Tags = {}): string {
  const requirement = tags.requirement ?? REQUIREMENT
  const blocks = scenarios.map(scenario =>
    [
      `// Requirement: ${requirement}`,
      `// Scenario: ${scenario}`,
      `// THEN the demonstrated claim holds`,
      `it(${JSON.stringify(scenario)}, () => {`,
      `  expect(true).toBe(true)`,
      `})`,
    ].join('\n'),
  )
  return [`// Capability: ${tags.capability ?? CAPABILITY}`, '', ...blocks].join('\n')
}

/**
 * A capability file recording the given scenarios, each against the test file that proves
 * them. Entries come out in title order — the order the write-back keeps them in — so a
 * file built here that already agrees with its tests is byte-for-byte what the write-back
 * would produce.
 */
export function specFile(options: { recorded: readonly string[]; testPath?: string } & Tags): string {
  const testPath = options.testPath ?? TEST_PATH
  const requirement = options.requirement ?? REQUIREMENT
  const entries = [...options.recorded]
    .sort(compareStrings)
    .map(scenario => `- "${scenario}" → ${testPath}`)
  return [
    `# ${options.capability ?? CAPABILITY}`,
    '',
    `### Requirement: ${requirement}`,
    'The tool SHALL demonstrate the pipeline end to end.',
    '',
    '<!-- scenarios: generated -->',
    ...entries,
    '<!-- /scenarios -->',
    '',
  ].join('\n')
}
