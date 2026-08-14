# How I read code (pi global convention)

`codebase-memory-mcp` is a code-graph index. I use it to **locate** code, never as
the source of truth for what code **does** — the on-disk file is always truth.

## Setup
- Binary: `~/.local/bin/codebase-memory-mcp`. Not wired into pi as an MCP server;
  call it from bash with the `cli <tool>` subcommand.
- Pass args via `--args-file <path>` or piped stdin. Raw JSON args are deprecated.
- The project name is not constant across worktrees/branches. Run `list_projects`
  and match the current cwd; do not hardcode a name.
- For proofspec, use project `Users-yang-Projects-proofspec` from `list_projects`.

## Two-phase reading
1. **Locate / explore** — query the index first (faster and more semantic than grep):
   - `search_graph --query "natural language"` — BM25 + structural ranking (main tool).
   - `search_graph --semantic-query '["kw1","kw2"]'` — embedding similarity over functions.
   - `search_code --pattern <regex>` — enhanced grep; returns signatures + optional source.
   - `get_architecture` / `trace_path` — graph overview / call chains.
2. **Read / edit** — open the real file with `read`. The index only points; the file
  is what I edit against. Never trust the index for the current behavior of code I
  am about to change.

## Trust
The index is a snapshot. Before relying on it, check freshness with `index_status`
or `detect_changes`. If **code** files have drifted, re-index or fall back to
`rg`/`read` for those files. Drift in docs doesn't matter; drift in code does.