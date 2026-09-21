// Capability: build

import { execFile } from 'node:child_process'
import { access, chmod, constants, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

// The test runs from the repo root, but resolve the root from this file so the
// build's cwd does not depend on how vitest was invoked.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const CLI_ENTRY = join(REPO_ROOT, 'dist/cli/main.js')

// A full tsc compile outlasts vitest's 5s default; the build gets a minute.
const BUILD_TIMEOUT_MS = 60_000

const build = () => execFileAsync('pnpm', ['run', 'build'], { cwd: REPO_ROOT })

const isExecutable = () => access(CLI_ENTRY, constants.X_OK).then(() => true, () => false)

// Requirement: A finished build leaves the CLI directly startable
// Scenario: The CLI entry a first build produces is executable
// GIVEN a working copy with no dist/ — nothing from an earlier build survives
// WHEN the project's build script runs to completion
// THEN the CLI entry it leaves in dist/ is executable, so the operating system starts the file directly when asked
it(
  'leaves the CLI entry executable on a first build',
  async () => {
    // The real npm script, not bare tsc — the executable bit is set by the script.
    // Wiping dist/ here (force: a no-op when absent) starts from the state a fresh
    // checkout or CI runner is in — the state whose 644 entry was the original fault.
    await rm(join(REPO_ROOT, 'dist'), { recursive: true, force: true })

    await build()

    expect(await isExecutable()).toBe(true)
  },
  BUILD_TIMEOUT_MS,
)

// Requirement: A finished build leaves the CLI directly startable
// Scenario: The CLI entry the build leaves behind is executable
// GIVEN a working copy whose dist/ already holds a previous build, its entry stripped
//       of the executable bit
// WHEN the project's build script runs to completion
// THEN the CLI entry it leaves in dist/ is executable, so the operating system starts the file directly when asked
it(
  'leaves the CLI entry in dist/ executable',
  async () => {
    // The real npm script, not bare tsc — the executable bit is set by the script.
    // The first run leaves the GIVEN's previous build; stripping its bit here (not
    // by deleting dist/) arranges the prior state inside the test, so no ambient
    // executable entry can mask a script that stopped restoring the bit.
    await build()
    await chmod(CLI_ENTRY, 0o644)

    await build()

    expect(await isExecutable()).toBe(true)
  },
  BUILD_TIMEOUT_MS,
)
