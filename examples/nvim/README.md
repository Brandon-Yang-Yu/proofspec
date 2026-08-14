# Neovim Examples

This directory contains example Neovim configurations for integrating proofspec.

## Files

- `minimal.lua` - Minimal setup with quickfix list only (copy-paste ready)
- `proofspec.lua` - Full-featured plugin with diagnostics, autocommands, and more

## Quick Start

### Minimal Setup

Add this to your `init.lua`:

```lua
-- Load minimal proofspec integration
dofile(vim.fn.stdpath('config') .. '/proofspec-minimal.lua')
-- or copy the content directly
```

Then use:
- `<leader>psc` - Run proofspec check
- `<leader>psw` - Run proofspec write

### Full Plugin Setup

1. Copy `proofspec.lua` to `~/.config/nvim/lua/proofspec.lua`
2. Add to your `init.lua`:

```lua
require('proofspec').setup({
  check_on_save = true,
  patterns = { 'tests/**/*.test.ts', 'specs/*.md' },
  diagnostics = true,
  quickfix = true,
})
```

3. Use commands:
- `:ProofSpecCheck` - Run check and update diagnostics
- `:ProofSpecWrite` - Write spec files
- `:ProofSpecQuickfix` - Run check and open quickfix

## Features

- Quickfix integration (jump to findings)
- LSP diagnostics (inline errors/warnings)
- Auto-check on file save
- Status notifications
- Customizable patterns and behavior

## Documentation

See `docs/neovim.md` for full documentation.