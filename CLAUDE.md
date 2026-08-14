# ProofSpec Project

A tool that makes your test suite the living spec. Tests are read from `tests/`
and capability files from `specs/` by default.

---

## Project Rules

### Rule 1: Tests are the spec
- Each behavior is written as Gherkin (GIVEN/WHEN/THEN) directly above the test that proves it
- One scenario ↔ one proof site (a bijection)
- Behavior text lives only in the test; requirement files record *where* scenarios are
- Use `pnpm spec:check` to verify spec/test consistency, `pnpm spec:write` to record scenarios

### Rule 2: English only for behavior text
- All Gherkin steps (GIVEN/WHEN/THEN) must be in plain English
- UI copy, commit messages, and code comments must be in English
- Chinese is allowed only in `.md` documentation files

### Rule 3: YAGNI
- Build only what the current task needs
- No empty placeholders or speculative abstractions
- Wait for a second real use before abstracting (Rule of Three)

### Rule 4: TypeScript style
- Read `docs/typescript-style.md` before writing TypeScript — it is the authority
- Readability > correctness > performance > brevity
- Use discriminated unions, not optional fields plus flags
- Guard clauses and early returns; happy path down the left edge
- At most 2-3 params and **no boolean params** — use an options object
- Comments say **why**, not what. Delete dead commented code
- Immutable by default (`readonly`, return copies)
- Expected errors are values (`{ ok: true } | { ok: false; reason }`); `throw` only for real bugs

### Rule 5: Always use `/createworktree` to create a worktree
- Start a task in its own worktree
- The worktree dir name is a throwaway label — rename the branch to match the task

## How we work

- **Specs are ProofSpec**: the test suite is the living spec
- Run `pnpm test` before any change; run it again after to verify
- Conventional commits with a scope: `feat(cli):`, `fix(spec-tree):`, `chore(docs):`
- Language: all code, comments, config, and commit messages are in **English**
- Use codebase-memory-mcp to explore the codebase: `codebase-memory-mcp cli list_projects 2>/dev/null` → pick `Users-yang-Projects-proofspec`