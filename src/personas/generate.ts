/**
 * Each pi tool name and the Claude Code tool it stands for. A persona's limits are set by
 * its tools, so a name missing here must stop generation rather than vanish from the copy.
 */
const CLAUDE_TOOL_BY_PI_TOOL: ReadonlyMap<string, string> = new Map([
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['grep', 'Grep'],
  ['find', 'Glob'],
  ['ls', 'Glob'],
  ['bash', 'Bash'],
  ['subagent', 'Agent'],
  ['enqueue_task', 'mcp__proofspec__enqueue_task'],
  ['census_in_flight', 'mcp__proofspec__census_in_flight'],
])

const OPENING_FENCE = '---\n'
const CLOSING_FENCE = '\n---\n'
const TOOLS_PREFIX = 'tools:'

export type GenerationResult = { readonly ok: true; readonly content: string } | { readonly ok: false; readonly reason: string }

/**
 * The Claude Code persona file for one pi persona file: the same bytes, except the
 * frontmatter `tools:` line, whose names are translated to Claude Code's.
 */
export function generateClaudePersona(piPersona: string): GenerationResult {
  if (!piPersona.startsWith(OPENING_FENCE)) return { ok: false, reason: 'it does not open with a frontmatter fence' }
  const closingFenceAt = piPersona.indexOf(CLOSING_FENCE, OPENING_FENCE.length - 1)
  if (closingFenceAt === -1) return { ok: false, reason: 'its frontmatter is never closed' }

  const frontmatterLines = piPersona.slice(OPENING_FENCE.length, closingFenceAt).split('\n')
  const toolsLineIndex = frontmatterLines.findIndex(line => line.startsWith(TOOLS_PREFIX))
  if (toolsLineIndex === -1) return { ok: false, reason: 'its frontmatter has no tools line' }

  const translation = translateToolsLine(frontmatterLines[toolsLineIndex] ?? '')
  if (!translation.ok) return translation

  const generatedFrontmatter = frontmatterLines.with(toolsLineIndex, translation.content).join('\n')
  const rest = piPersona.slice(closingFenceAt)
  return { ok: true, content: OPENING_FENCE + generatedFrontmatter + rest }
}

function translateToolsLine(toolsLine: string): GenerationResult {
  const piNames = toolsLine
    .slice(TOOLS_PREFIX.length)
    .split(',')
    .map(name => name.trim())
    .filter(name => name !== '')

  const unknownNames = piNames.filter(name => !CLAUDE_TOOL_BY_PI_TOOL.has(name))
  if (unknownNames.length > 0) return { ok: false, reason: `unknown tool name(s): ${unknownNames.join(', ')}` }

  // `find` and `ls` both become `Glob`; a Set keeps first-seen order and lists it once.
  const claudeNames = new Set(piNames.map(name => CLAUDE_TOOL_BY_PI_TOOL.get(name) ?? name))
  return { ok: true, content: `${TOOLS_PREFIX} ${[...claudeNames].join(', ')}` }
}
