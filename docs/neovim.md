# ProofSpec for Neovim

This document describes how to use proofspec with Neovim, including quickfix integration and LSP diagnostics support.

## Quickfix Integration

The `quickfix` output format produces output compatible with Neovim's quickfix list:

```
file:line:E: error message
file:line:W: warning message
```

### Example Configuration

Add this to your Neovim config (Lua):

```lua
-- Run proofspec check on save for test files
vim.api.nvim_create_autocmd('BufWritePost', {
  pattern = 'tests/**/*.test.ts',
  callback = function()
    local cmd = 'proofspec check --format quickfix'
    vim.fn.jobstart(cmd, {
      stdout_buffered = true,
      on_stdout = function(_, data)
        if #data == 0 then return end
        -- Parse quickfix format: file:line:E: message
        local qf = {}
        for _, line in ipairs(data) do
          local file, linestr, severity, message = line:match('^(.+):(%d+):([EW]):%s*(.+)$')
          if file then
            table.insert(qf, {
              filename = file,
              lnum = tonumber(linestr),
              col = 0,
              type = severity,
              text = message,
            })
          end
        end
        if #qf > 0 then
          vim.fn.setqflist(qf)
          vim.api.nvim_echo({{format('%d proofspec findings', #qf), 'WarningMsg'}}, false, {})
          vim.cmd('copen')
        end
      end,
    })
  end,
})
```

### Using makeprg

Alternatively, set `makeprg` and `errorformat`:

```lua
-- For proofspec check
vim.opt.makeprg = 'proofspec check --format quickfix'
vim.opt.errorformat = '%f:%l:%t:%m'

-- Run :make to check specs
vim.keymap.set('n', '<leader>sc', '<cmd>make<CR>', { desc = 'Spec check' })
vim.keymap.set('n', '<leader>sq', '<cmd>copen<CR>', { desc = 'Spec quickfix' })
```

## LSP Diagnostics Format

The `diagnostics` output format produces JSON compatible with LSP diagnostics:

```json
{
  "diagnostics": [
    {
      "severity": 1,  // 1 = Error, 2 = Warning
      "range": {
        "start": { "line": 0, "character": 0 },
        "end": { "line": 0, "character": 0 }
      },
      "message": "error message",
      "source": "proofspec",
      "code": "scenario-added"
    }
  ]
}
```

### Creating a Custom LSP Client

You can create a simple LSP client that wraps proofspec:

```lua
local proofspec_lsp = {}

function proofspec_lsp.check()
  local cmd = { 'proofspec', 'check', '--format', 'diagnostics' }
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      if #data == 0 then return end
      local json_str = table.concat(data, '')
      local ok, result = pcall(vim.json.decode, json_str)
      if not ok or not result.diagnostics then return end

      -- Convert to vim.diagnostic format
      local diagnostics = {}
      for _, d in ipairs(result.diagnostics) do
        table.insert(diagnostics, {
          lnum = d.range.start.line,
          col = d.range.start.character,
          end_lnum = d.range.end.line,
          end_col = d.range.end.character,
          severity = d.severity,
          message = d.message,
          source = d.source,
          code = d.code,
        })
      end

      -- Set diagnostics for current buffer
      local bufnr = vim.api.nvim_get_current_buf()
      vim.diagnostic.set('proofspec', bufnr, diagnostics, {})
    end,
  })
end

-- Run proofspec on save
vim.api.nvim_create_autocmd('BufWritePost', {
  pattern = 'tests/**/*.test.ts',
  callback = function()
    proofspec_lsp.check()
  end,
})

return proofspec_lsp
```

## Commands

```lua
-- Create custom commands
vim.api.nvim_create_user_command('ProofSpecCheck', function()
  vim.cmd('make!')
  if #vim.fn.getqflist() > 0 then
    vim.cmd('copen')
  end
end, {})

vim.api.nvim_create_user_command('ProofSpecWrite', function()
  local result = vim.fn.system('proofspec write --format json')
  vim.notify('ProofSpec write: ' .. result)
end, {})

-- Key mappings
vim.keymap.set('n', '<leader>psc', '<cmd>ProofSpecCheck<CR>', { desc = 'ProofSpec check' })
vim.keymap.set('n', '<leader>psw', '<cmd>ProofSpecWrite<CR>', { desc = 'ProofSpec write' })
```

## Status Line Integration

Show proofspec status in your status line:

```lua
-- For lualine
local function proofspec_status()
  local cmd = 'proofspec check --format json 2>/dev/null'
  local result = vim.fn.system(cmd)
  local ok, data = pcall(vim.json.decode, result)
  if not ok or not data.findings then return '✓' end

  local errors = 0
  local warnings = 0
  for _, f in ipairs(data.findings) do
    if f.kind ~= 'no-steps' and f.kind ~= 'duplicate-requirement' then
      errors = errors + 1
    else
      warnings = warnings + 1
    end
  end

  if errors > 0 then
    return string.format('✗ %dE %dW', errors, warnings)
  elseif warnings > 0 then
    return string.format('⚠ %dW', warnings)
  else
    return '✓'
  end
end

-- Add to lualine sections
require('lualine').setup({
  sections = {
    lualine_c = { proofspec_status },
  },
})
```

## Telescope Integration (Optional)

Search through proofspec findings with telescope:

```lua
local telescope = require('telescope')

-- Custom picker for proofspec findings
local proofspec_picker = function()
  local cmd = 'proofspec check --format json'
  vim.fn.jobstart(cmd, {
    stdout_buffered = true,
    on_stdout = function(_, data)
      local json_str = table.concat(data, '')
      local ok, result = pcall(vim.json.decode, json_str)
      if not ok or not result.findings then return end

      local entries = {}
      for _, f in ipairs(result.findings) do
        table.insert(entries, {
          filename = f.file,
          lnum = f.line,
          col = 0,
          text = f.kind .. ': ' .. require('proofspec').describeFinding(f),
        })
      end

      telescope.builtin.quickfix({ items = entries })
    end,
  })
end

vim.keymap.set('n', '<leader>pfs', proofspec_picker, { desc = 'ProofSpec findings' })
```

## Usage Tips

1. **On-save checking**: Automatically run proofspec check when saving test or spec files
2. **Quick navigation**: Use quickfix to jump between findings
3. **Commit hooks**: Use as a pre-commit hook to prevent drift
4. **CI integration**: Use JSON format in CI for structured output

## See Also

- Main README.md for proofspec overview
- docs/design.md for design decisions
- docs/spec.md for spec file format