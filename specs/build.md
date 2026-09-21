# build

Turns the TypeScript source into the runnable tree a global command points at.

Every fresh compile writes `dist/cli/main.js` with read and write permission only
— no executable bit, the mark that lets the operating system start a file as a
program. A global `proofspec` command is a symlink to that file, so without the
bit the command answers `Permission denied` no matter how correct the code
inside is.

### Requirement: A finished build leaves the CLI directly startable

The build SHALL leave the CLI entry it produces executable.

The compiler grants the entry no executable bit of its own, so restoring the
bit is the build script's own last step, not a repair anyone performs by hand.
The guarantee covers a working copy in any state: with no `dist/` at all, and
with a `dist/` already holding a previous entry — even one stripped of the bit
— the next build leaves a startable entry.

<!-- scenarios: generated -->
- "The CLI entry a first build produces is executable" → tests/build/executable-bit.test.ts
- "The CLI entry the build leaves behind is executable" → tests/build/executable-bit.test.ts
<!-- /scenarios -->
