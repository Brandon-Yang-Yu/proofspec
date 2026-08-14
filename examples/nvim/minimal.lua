-- Minimal ProofSpec Neovim Integration
-- Quick setup with quickfix list only

-- Key mappings
vim.keymap.set('n', '<leader>psc', function()
  local result = vim.fn.system('proofspec check --format quickfix')
  if result and result ~= '' then
    local qf = {}
    for line in result:gmatch('[^\r\n]+') do
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

    vim.fn.setqflist(qf)
    vim.notify(string.format('ProofSpec: %d findings', #qf), vim.log.levels.INFO)
    vim.cmd('copen')
  else
    vim.notify('ProofSpec: all checks passed', vim.log.levels.INFO)
  end
end, { desc = 'ProofSpec check' })

vim.keymap.set('n', '<leader>psw', function()
  local result = vim.fn.system('proofspec write')
  vim.notify('ProofSpec write: ' .. result)
end, { desc = 'ProofSpec write' })

-- Auto-check on save
vim.api.nvim_create_autocmd('BufWritePost', {
  pattern = { 'tests/**/*.test.ts', 'specs/*.md' },
  callback = function()
    vim.cmd('silent !proofspec check --format quickfix 2>/dev/null')
  end,
})

-- Create commands
vim.api.nvim_create_user_command('ProofSpecCheck', '<leader>psc', {})
vim.api.nvim_create_user_command('ProofSpecWrite', '<leader>psw', {})