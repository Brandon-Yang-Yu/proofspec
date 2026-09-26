#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compareStrings } from '../order.ts'
import { generateClaudePersona } from './generate.ts'

/**
 * The persona entry, run with the repo root as its working directory:
 * `write` regenerates every `.claude/agents` file from its `.pi/agents` source, and
 * `check` fails, naming each file, when a `.claude/agents` file is not what `write`
 * would produce.
 */

const PI_AGENTS = '.pi/agents'
const CLAUDE_AGENTS = '.claude/agents'

type GeneratedPersona = { readonly fileName: string; readonly content: string }

type GenerationOutcome =
  | { readonly ok: true; readonly personas: readonly GeneratedPersona[] }
  | { readonly ok: false; readonly problems: readonly string[] }

/** Every pi persona's generated copy, or every reason one could not be generated — all
 *  sources are generated before anything is written, so one bad source writes nothing. */
async function generateAll(root: string): Promise<GenerationOutcome> {
  const fileNames = await markdownFileNames(join(root, PI_AGENTS))
  const personas: GeneratedPersona[] = []
  const problems: string[] = []
  for (const fileName of fileNames) {
    const source = await readFile(join(root, PI_AGENTS, fileName), 'utf8')
    const result = generateClaudePersona(source)
    if (result.ok) personas.push({ fileName, content: result.content })
    else problems.push(`${PI_AGENTS}/${fileName}: ${result.reason}`)
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, personas }
}

async function markdownFileNames(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir)
    return entries.filter(entry => entry.endsWith('.md')).sort(compareStrings)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writePersonas(root: string): Promise<readonly string[]> {
  const generation = await generateAll(root)
  if (!generation.ok) return generation.problems

  await mkdir(join(root, CLAUDE_AGENTS), { recursive: true })
  for (const persona of generation.personas) {
    await writeFile(join(root, CLAUDE_AGENTS, persona.fileName), persona.content)
  }
  return []
}

async function checkPersonas(root: string): Promise<readonly string[]> {
  const generation = await generateAll(root)
  if (!generation.ok) return generation.problems

  const claudeFileNames = await markdownFileNames(join(root, CLAUDE_AGENTS))
  const problems: string[] = []
  for (const persona of generation.personas) {
    if (!claudeFileNames.includes(persona.fileName)) {
      problems.push(`${PI_AGENTS}/${persona.fileName}: has no generated copy in ${CLAUDE_AGENTS}`)
      continue
    }
    const copy = await readFile(join(root, CLAUDE_AGENTS, persona.fileName), 'utf8')
    if (copy !== persona.content) problems.push(`${CLAUDE_AGENTS}/${persona.fileName}: differs from what generation produces`)
  }
  const sourceFileNames = new Set(generation.personas.map(persona => persona.fileName))
  for (const fileName of claudeFileNames) {
    if (!sourceFileNames.has(fileName)) problems.push(`${CLAUDE_AGENTS}/${fileName}: has no pi persona file in ${PI_AGENTS}`)
  }
  return problems
}

const USAGE = 'usage: personas <write|check>'

const COMMANDS: Readonly<Record<string, (root: string) => Promise<readonly string[]>>> = {
  write: writePersonas,
  check: checkPersonas,
}

async function main(commandName: string | undefined): Promise<number> {
  const command = commandName === undefined ? undefined : COMMANDS[commandName]
  if (command === undefined) {
    console.error(USAGE)
    return 2
  }
  const problems = await command(process.cwd())
  for (const problem of problems) console.error(problem)
  if (problems.length > 0) return 1
  return 0
}

process.exitCode = await main(process.argv[2])
