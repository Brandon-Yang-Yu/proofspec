# build

Turns the TypeScript source into the runnable tree a global command points at.

The compiler writes `dist/cli/main.js` with read and write permission only — no
executable bit, the mark that lets the operating system start a file as a program.
A global `proofspec` command is a symlink to that file, so without the bit the
command answers `Permission denied` no matter how correct the code inside is.

### Requirement: A finished build leaves the CLI directly startable

The build SHALL leave the CLI entry it produces executable.

Every build recreates `dist/cli/main.js` at mode 644, so restoring the bit is the
build script's own last step, not a repair anyone performs by hand. The guarantee
holds from any prior state: the script wipes `dist/` before compiling, so a
stale executable entry from an earlier build cannot mask a broken one.

<!-- scenarios: generated -->
- "The CLI entry the build leaves behind is executable" → tests/build/executable-bit.test.ts
<!-- /scenarios -->
