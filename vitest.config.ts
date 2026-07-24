import { defineConfig } from 'vitest/config'

// Only `tests/**/*.test.ts` is a test file, and that is also the set OpenTDD scans for
// proof sites. Helpers live beside them as plain `.ts` so the scan never sees them.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
