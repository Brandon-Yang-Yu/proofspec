import { defineConfig } from 'vitest/config'

/**
 * The ordinary suite plus the per-test recording `proofspec impact --coverage` reads. It is a
 * separate config because instrumenting every module costs a run that `pnpm test` should not
 * pay: this one is run on purpose, when you want to know which scenarios ran a change.
 *
 * `includeTaskLocation` is what gives each test the line it opens on, which is how a record
 * joins back to the scenario that proves it.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    includeTaskLocation: true,
    setupFiles: ['src/test-run/vitest-setup.ts'],
    globalSetup: ['src/test-run/vitest-global.ts'],
    coverage: { enabled: true, provider: 'istanbul', include: ['src/**'], reporter: [] },
  },
})
