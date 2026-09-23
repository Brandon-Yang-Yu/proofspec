import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { compareStrings } from '../../src/order.ts'

const execFileAsync = promisify(execFile)

/**
 * `cli` is the one capability that owns the filesystem, so its tests give it a real one: a
 * throwaway directory laid out like a repo. Everything else in ProofSpec is proven against
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
  const root = await mkdtemp(join(tmpdir(), 'proofspec-cli-'))
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
 * A test file the scan cannot read: an AND sits where a step keyword belongs. Both the
 * write and the render must refuse a repo holding one, so the fixture lives here once.
 */
export function unreadableTestFile(): string {
  return [
    `// Capability: ${CAPABILITY}`,
    '',
    `// Requirement: ${REQUIREMENT}`,
    '// Scenario: A first behavior',
    '// WHEN something happens',
    '// AND another thing happens',
    '// THEN the demonstrated claim holds',
    "it('a first behavior', () => {",
    '  expect(true).toBe(true)',
    '})',
  ].join('\n')
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

/**
 * A fixture repo under git, its files committed on `main` — the branch point `touched`
 * compares against. `commit.gpgsign` is forced off and the identity set on the repo itself,
 * so the fixture does not depend on whatever the machine running the suite has configured.
 */
export type GitRepo = Repo & {
  /** Overwrites a file in the working tree, creating its directory when it is new. */
  write(path: string, content: string): Promise<void>
  /** Runs git in the repo and returns its stdout, trimmed. */
  git(args: readonly string[]): Promise<string>
}

export async function makeGitRepo(files: Readonly<Record<string, string>>): Promise<GitRepo> {
  const repo = await makeRepo(files)
  const git = async (args: readonly string[]): Promise<string> => {
    const { stdout } = await execFileAsync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo.root })
    return stdout.trim()
  }
  await git(['init', '-b', 'main'])
  await git(['config', 'user.email', 'proofspec@example.com'])
  await git(['config', 'user.name', 'ProofSpec'])
  await git(['add', '-A'])
  await git(['commit', '-m', 'base'])
  return {
    ...repo,
    git,
    write: async (path, content) => {
      const full = join(repo.root, path)
      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, content)
    },
  }
}

/**
 * Enters a task into the conventional queue directory, on its own branch — off `main` unless
 * `onto` names another branch to build it from instead. The MANIFEST records the given
 * `blocked` exactly, and no field at all when none is given. Shared by `cli` and `inflight`'s
 * own end-to-end tests, since both prove behaviour of the same command against the same
 * fixture shape.
 */
export async function enterTask(
  repo: GitRepo,
  task: string,
  options: {
    readonly edit: string
    readonly blocked?: { readonly task: string; readonly reason: string }
    readonly onto?: string
  },
): Promise<void> {
  await repo.git(['checkout', options.onto ?? 'main'])
  await repo.git(['checkout', '-b', `work/${task}`])
  await repo.write(options.edit, `${await repo.read(options.edit)}\nchanged by ${task}\n`)
  await repo.git(['add', options.edit])
  await repo.git(['commit', '-m', `${task}: edit`])
  await repo.git(['checkout', 'main'])

  const manifest = options.blocked === undefined
    ? { intentRef: 'docs/x.md', branch: `work/${task}` }
    : { intentRef: 'docs/x.md', branch: `work/${task}`, blocked: options.blocked }
  await repo.write(`.proofspec/dispatch/${task}/MANIFEST`, JSON.stringify(manifest))
  await repo.write(`.proofspec/dispatch/${task}/state`, 'queued')
}

/**
 * A test file proving two scenarios inside one test — the layout that shares a GIVEN/WHEN.
 * The shared steps sit above the `it(` and the shared setup below it, while each scenario
 * tags a statement of its own. Every other fixture here tags a whole test, so this is the
 * only one that can hold a report to account for keeping one scenario's lines out of
 * another's.
 */
export function sharedTestFile(scenarios: readonly [string, string], tags: Tags = {}): string {
  const requirement = tags.requirement ?? REQUIREMENT
  return [
    `// Capability: ${tags.capability ?? CAPABILITY}`,
    '',
    '// GIVEN a shared arrangement',
    '// WHEN the shared action runs',
    `it('one action, two promises', () => {`,
    '  const outcome = act()',
    '',
    `  // Requirement: ${requirement}`,
    `  // Scenario: ${scenarios[0]}`,
    '  // THEN the first demonstrated claim holds',
    '  expect(outcome.first).toBe(true)',
    '',
    `  // Requirement: ${requirement}`,
    `  // Scenario: ${scenarios[1]}`,
    '  // THEN the second demonstrated claim holds',
    '  expect(outcome.second).toBe(true)',
    '})',
  ].join('\n')
}
