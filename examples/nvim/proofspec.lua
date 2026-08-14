-- ProofSpec Neovim Integration
-- Copy this file to your Neovim config (e.g., ~/.config/nvim/lua/proofspec.lua)
-- Then add: require('proofspec') to your init.lua

local M = {}

-- One namespace for every buffer's proofspec diagnostics; created once at load.
local ns_id = vim.api.nvim_create_namespace('proofspec')

-- Configuration
local config = {
  enabled = true,
  check_on_save = true,
  patterns = { 'tests/**/*.test.ts', 'tests/**/*.e2e.test.ts', 'specs/*.md' },
  diagnostics = true,
  quickfix = true,
  notify = true,
}

-- Check proofspec and update diagnostics/quickfix
function M.check()
  local cmd = 'proofspec check --format json'
  local result = vim.fn.system(cmd)
  local ok, data = pcall(vim.json.decode, result)

  if not ok then
    vim.notify('Failed to parse proofspec output', vim.log.levels.ERROR)
    return false
  end

  -- Convert findings to diagnostics
  local diagnostics = {}
  local qf_entries = {}

  for _, f in ipairs(data.findings) do
    local severity = M.severityOf(f)
    local message = M.describeFinding(f)

    if f.file then
      -- Add to diagnostics
      table.insert(diagnostics, {
        lnum = (f.line or 1) - 1,
        col = 0,
        end_lnum = (f.line or 1) - 1,
        end_col = 0,
        severity = severity,
        message = message,
        source = 'proofspec',
        code = f.kind,
      })

      -- Add to quickfix
      table.insert(qf_entries, {
        filename = f.file,
        lnum = f.line or 1,
        col = 0,
        type = severity == vim.diagnostic.severity.ERROR and 'E' or 'W',
        text = message,
      })
    end
  end

  -- Update diagnostics for all open buffers
  if config.diagnostics then
    local bufs = vim.fn.getbuf_info({ buflisted = 1 })
    for _, buf in ipairs(bufs) do
      local buf_diagnostics = {}
      for _, d in ipairs(diagnostics) do
        if d.filename == buf.name or d.filename == vim.fn.fnamemodify(buf.name, ':.') then
          table.insert(buf_diagnostics, d)
        end
      end
      vim.diagnostic.set(ns_id, buf.bufnr, buf_diagnostics, {})
    end
  end

  -- Update quickfix
  if config.quickfix then
    vim.fn.setqflist(qf_entries)
  end

  -- Notify result
  if config.notify then
    local n_errors = vim.tbl_count(vim.tbl_filter(function(d)
      return d.severity == vim.diagnostic.severity.ERROR
    end, diagnostics))

    local n_warnings = vim.tbl_count(vim.tbl_filter(function(d)
      return d.severity == vim.diagnostic.severity.WARN
    end, diagnostics))

    if n_errors > 0 then
      vim.notify(string.format('ProofSpec: %d errors, %d warnings', n_errors, n_warnings), vim.log.levels.ERROR)
    elseif n_warnings > 0 then
      vim.notify(string.format('ProofSpec: %d warnings', n_warnings), vim.log.levels.WARN)
    else
      vim.notify('ProofSpec: all checks passed', vim.log.levels.INFO)
    end
  end

  return #data.findings == 0
end

-- Write spec files from tests
function M.write()
  local cmd = 'proofspec write'
  local result = vim.fn.system(cmd)
  vim.notify('ProofSpec write: ' .. result)
end

-- Describe a finding (human-readable)
function M.describeFinding(finding)
  if finding.capability and finding.requirement and finding.scenario then
    local name = string.format('%s › %s › %s', finding.capability, finding.requirement, finding.scenario)

    if finding.kind == 'scenario-added' then
      return string.format('%s: proven at %s:%d, but the capability file does not record it',
        name, finding.file, finding.line)
    elseif finding.kind == 'scenario-removed' then
      return string.format('%s: recorded against %s, but no test proves it any more',
        name, finding.file)
    elseif finding.kind == 'scenario-moved' then
      return string.format('%s: recorded against %s, now proven at %s:%d',
        name, finding.from, finding.to, finding.line)
    elseif finding.kind == 'unknown-requirement' then
      return string.format('%s: %s:%d tags a requirement the capability file does not declare',
        name, finding.file, finding.line)
    elseif finding.kind == 'duplicate-scenario' then
      local sites = table.concat(vim.tbl_map(function(s)
        return string.format('%s:%d', s.file, s.line)
      end, finding.sites), ' and ')
      return string.format('%s: claimed by %s', name, sites)
    end
  end

  -- Other finding kinds
  if finding.kind == 'uncovered-requirement' then
    return string.format('%s › %s: declared, but no test proves it',
      finding.capability, finding.requirement)
  elseif finding.kind == 'duplicate-requirement' then
    return string.format('%s › %s: declared more than once in the capability file',
      finding.capability, finding.requirement)
  elseif finding.kind == 'no-capability' then
    return string.format('%s › %s: %s:%d sits in a file that declares no capability',
      finding.requirement, finding.scenario, finding.file, finding.line)
  elseif finding.kind == 'no-steps' then
    return string.format('%s › %s: %s:%d has no GIVEN, WHEN or THEN above it',
      finding.requirement, finding.scenario, finding.file, finding.line)
  elseif finding.kind == 'unreadable' then
    return string.format('%s:%d: %s', finding.file, finding.line, finding.message)
  end

  return finding.kind or 'unknown finding'
end

-- Get severity of a finding
function M.severityOf(finding)
  -- Warnings: no-steps, duplicate-requirement
  if finding.kind == 'no-steps' or finding.kind == 'duplicate-requirement' then
    return vim.diagnostic.severity.WARN
  end
  -- Everything else is an error
  return vim.diagnostic.severity.ERROR
end

-- Setup the plugin
function M.setup(user_config)
  config = vim.tbl_extend('force', config, user_config or {})

  -- Create autocommand for on-save checking
  if config.check_on_save then
    vim.api.nvim_create_autocmd('BufWritePost', {
      pattern = config.patterns,
      callback = function()
        M.check()
      end,
    })
  end

  -- Create user commands
  vim.api.nvim_create_user_command('ProofSpecCheck', M.check, {})
  vim.api.nvim_create_user_command('ProofSpecWrite', M.write, {})
  vim.api.nvim_create_user_command('ProofSpecQuickfix', function()
    M.check()
    vim.cmd('copen')
  end, {})

  -- Set up diagnostic namespace
  vim.diagnostic.config({
    virtual_text = true,
    signs = true,
    underline = true,
    update_in_insert = false,
    severity_sort = true,
  })
end

-- Set up with default config
M.setup()

return M