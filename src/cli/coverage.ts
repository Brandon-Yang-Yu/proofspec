import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { TestRun } from '../impact/index.ts'

/**
 * Reading what a test run recorded. The collector writes one JSON object per line while the
 * tests run; this reads them back. Parsed once here, at the boundary, so nothing downstream
 * takes `unknown`.
 */

export type CoverageRead =
  | { readonly ok: true; readonly runs: readonly TestRun[] }
  | { readonly ok: false; readonly reason: string }

export async function readTestRuns(options: {
  readonly cwd: string
  readonly from: string
}): Promise<CoverageRead> {
  const path = resolve(options.cwd, options.from)
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ok: false, reason: `${options.from} could not be read; run the tests with the proofspec collector first` }
  }

  // A test that ran twice — a retry, or two runs appended — is one test: the last record wins,
  // because it is what the code does now.
  const byTest = new Map<string, TestRun>()
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    const run = toRun(line)
    if (run === undefined) return { ok: false, reason: `${options.from} holds a line that is not a test run: ${line.slice(0, 60)}` }
    byTest.set(`${run.file}:${run.line}`, run)
  }
  return { ok: true, runs: [...byTest.values()] }
}

function toRun(line: string): TestRun | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { file, line: at, ran } = parsed as { file?: unknown; line?: unknown; ran?: unknown }
  if (typeof file !== 'string' || typeof at !== 'number' || !Array.isArray(ran)) return undefined
  return {
    file,
    line: at,
    ran: ran.map((one: Record<string, unknown>) => ({
      file: String(one.file ?? ''),
      names: Array.isArray(one.names) ? one.names.map(String) : [],
    })),
  }
}
