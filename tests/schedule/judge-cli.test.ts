// Capability: schedule
//
// Unlike `judge.test.ts`, every scenario here really spawns a process — a small stand-in
// script standing in for `pi` — because these two claims are about the real spawn itself
// (closing stdin, bounding the wait), not the domain rules `judge.test.ts` already covers
// with a fake `JudgeRunner`.

import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DEFAULT_JUDGE_TIMEOUT_MS, judgeTimeoutMs, piJudge } from '../../src/cli/judge.ts'
import type { RelationshipJudgeInput } from '../../src/schedule/index.ts'

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A malformed timeout override falls back to the default, rather than silently disabling the timeout
// GIVEN a PROOFSPEC_JUDGE_TIMEOUT_MS value that is not a positive number
// WHEN judgeTimeoutMs reads it
// THEN it answers the default timeout, not the malformed value or NaN
it('falls back to the default timeout on a malformed override, not NaN', () => {
  expect(judgeTimeoutMs('not-a-number')).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs('0')).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs('-500')).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs(undefined)).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs('500')).toBe(500)
})

// Generous, not tight: this bounds a process that finishes in milliseconds, so it only needs
// enough headroom that a real spawn under load never brushes it — unlike the other test below,
// which deliberately wants a short bound its stand-in process will actually hit.
const AMPLE_TIMEOUT_MS = '5000'
const SHORT_TIMEOUT_MS = '300'

let standInDirs: string[] = []

afterEach(async () => {
  await Promise.all(standInDirs.map(dir => rm(dir, { recursive: true, force: true })))
  standInDirs = []
  delete process.env.PROOFSPEC_JUDGE_BIN
  delete process.env.PROOFSPEC_JUDGE_TIMEOUT_MS
})

/** A stand-in `pi` binary: a real shell script on disk, so these tests exercise judge's real
 *  process-spawning path rather than a fake runner. */
async function standInBinary(script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'proofspec-judge-'))
  standInDirs.push(dir)
  const path = join(dir, 'pi')
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return path
}

const INPUT: RelationshipJudgeInput = {
  relationship: { node: { kind: 'capability', name: 'demo' }, tasks: ['a', 'b'] },
  intents: { a: 'renames a helper', b: 'fixes a typo' },
}

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A process that never closes its own stdin still returns instead of hanging, because judge closes it first
// GIVEN a stand-in pi that only answers after reading its stdin to EOF
// WHEN judge runs it, bounded by an ample configured timeout
// THEN it answers RESOLVED well inside that timeout, because judge closed stdin itself
it('closes stdin so a process reading it to EOF does not hang', async () => {
  process.env.PROOFSPEC_JUDGE_BIN = await standInBinary('cat >/dev/null; echo RESOLVED')
  process.env.PROOFSPEC_JUDGE_TIMEOUT_MS = AMPLE_TIMEOUT_MS

  const verdict = await piJudge()(INPUT)

  expect(verdict).toEqual({ kind: 'resolved' })
})

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A process that never answers is not waited on past the configured timeout
// GIVEN a stand-in pi that never exits on its own
// WHEN judge runs it, bounded by a short configured timeout
// THEN the outcome reads as unresolved once the timeout elapses, not once the process would eventually exit
it(
  'does not wait past the configured timeout for a process that never answers',
  async () => {
    process.env.PROOFSPEC_JUDGE_BIN = await standInBinary('sleep 100')
    process.env.PROOFSPEC_JUDGE_TIMEOUT_MS = SHORT_TIMEOUT_MS
    const startedAt = Date.now()

    const verdict = await piJudge()(INPUT)

    expect(verdict).toEqual({ kind: 'unresolved' })
    // Additive, not multiplicative, headroom: real spawn/kill overhead measures ~10-20ms, so
    // +300ms leaves ~20x margin for that — but stays tight enough to catch a mutation that
    // silently doubles or triples the configured value, which a looser multiplicative bound
    // (e.g. 5x the configured value) would let slip through undetected.
    expect(Date.now() - startedAt).toBeLessThan(Number(SHORT_TIMEOUT_MS) + 300)
  },
  10_000,
)
