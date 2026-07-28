// Capability: cli

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { render } from '../../src/cli/index.ts'
import { CAPABILITY, cleanupRepos, makeRepo, REQUIREMENT, specFile, testFile, unreadableTestFile } from './support.ts'

afterEach(cleanupRepos)

const SCENARIO = 'A first behavior'
const TEST_PATH = 'tests/demo.test.ts'

/** A repo whose one capability file and its test agree, so a render has something to read. */
function inSync(): Readonly<Record<string, string>> {
  return {
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [SCENARIO] }),
    [TEST_PATH]: testFile([SCENARIO]),
  }
}

// Requirement: A command renders the spec into an output directory
// Scenario: The render command writes to the default directory when none is given
// GIVEN a repo whose capability files and tests agree
// WHEN the render command runs with no output directory
// THEN an index page, one page per capability, and a code page per test are written under the
//      default `build/`, and the outcome names the files it wrote
it('writes an index, a page per capability, and a code page per test under build/', async () => {
  const repo = await makeRepo(inSync())

  const outcome = await render({ cwd: repo.root })

  expect(outcome).toEqual({ kind: 'wrote', files: ['build/index.md', `build/${CAPABILITY}.md`, `build/${TEST_PATH}.md`] })
  expect(await repo.read('build/index.md')).toContain(CAPABILITY)
  const capabilityPage = await repo.read(`build/${CAPABILITY}.md`)
  expect(capabilityPage).toContain(REQUIREMENT)
  expect(capabilityPage).toContain(SCENARIO)
})

// Requirement: A command renders the spec into an output directory
// Scenario: The render command writes into a chosen directory
// GIVEN a repo whose capability files and tests agree
// WHEN the render command runs with an output directory
// THEN the pages are written under that directory and the outcome names them, so a project
//      can keep the generated pages where it wants
it('writes the pages into a chosen output directory', async () => {
  const repo = await makeRepo(inSync())

  const outcome = await render({ cwd: repo.root, out: 'docs/spec' })

  expect(outcome).toEqual({
    kind: 'wrote',
    files: ['docs/spec/index.md', `docs/spec/${CAPABILITY}.md`, `docs/spec/${TEST_PATH}.md`],
  })
  expect(await repo.read(`docs/spec/${CAPABILITY}.md`)).toContain(SCENARIO)
})

// Requirement: A command renders the spec into an output directory
// Scenario: An absolute output directory is written to exactly
// GIVEN a repo whose capability files and tests agree
// WHEN the render command runs with an absolute output directory
// THEN the pages exist under exactly that directory, the outcome names them where they
//      were written, and nothing appears under the repo itself
it('writes into an absolute output directory exactly', async () => {
  const repo = await makeRepo(inSync())
  // An absolute directory outside the repo, cleaned up with the other fixtures.
  const out = (await makeRepo({})).root

  const outcome = await render({ cwd: repo.root, out })

  expect(outcome).toEqual({
    kind: 'wrote',
    files: [join(out, 'index.md'), join(out, `${CAPABILITY}.md`), join(out, `${TEST_PATH}.md`)],
  })
  expect(await readFile(join(out, `${CAPABILITY}.md`), 'utf8')).toContain(SCENARIO)
  // `join` glues the absolute out onto the repo root — the exact place the pre-fix code
  // buried the pages. Neither it nor the default directory may exist: the pages went to
  // the absolute out and nowhere else.
  const buried = join(repo.root, out)
  await expect(access(buried)).rejects.toThrow()
  await expect(access(join(repo.root, 'build'))).rejects.toThrow()
})

// Requirement: A command renders the spec into an output directory
// Scenario: The render command reports it cannot run on unreadable inputs
// GIVEN a specs directory that cannot be read, and separately a test the scan cannot read
// WHEN the render command runs on each
// THEN both outcomes are cannot-run with a reason, told apart from pages it could produce,
//      the same way check and write refuse inputs they cannot read
it('reports cannot-run when its inputs cannot be read', async () => {
  const repo = await makeRepo(inSync())
  const unreadable = await makeRepo({
    [`specs/${CAPABILITY}.md`]: specFile({ recorded: [SCENARIO] }),
    [TEST_PATH]: unreadableTestFile(),
  })

  const missingSpecs = await render({ cwd: repo.root, specsDir: 'nowhere' })
  const unreadableTest = await render({ cwd: unreadable.root })

  expect(missingSpecs.kind).toBe('cannot-run')
  expect(unreadableTest.kind).toBe('cannot-run')
})
