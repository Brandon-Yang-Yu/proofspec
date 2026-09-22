// Capability: schedule
//
// Unlike `judge.test.ts`, every scenario here really spawns a process — a small stand-in
// script standing in for the judge's binary — because these claims are about the real spawn
// itself (closing stdin, bounding the wait, which binary runs and what it is handed), not
// the domain rules `judge.test.ts` already covers with a fake `JudgeRunner`.

import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DEFAULT_JUDGE_TIMEOUT_MS, judgeTimeoutMs, piJudge } from '../../src/cli/judge.ts'
import { judgeProcessFor } from '../../src/schedule/index.ts'
import type { JudgeAgent, JudgeVerdict, RelationshipJudgeInput } from '../../src/schedule/index.ts'

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
// PATH is only ever prepended to and restored whole — a stand-in dir left at its front
// would shadow the real `pi`/`claude` for every test that runs after one of these.
let originalPath: string | undefined

afterEach(async () => {
  await Promise.all(standInDirs.map(dir => rm(dir, { recursive: true, force: true })))
  standInDirs = []
  delete process.env.PROOFSPEC_JUDGE_BIN
  delete process.env.PROOFSPEC_JUDGE_TIMEOUT_MS
  delete process.env.PROOFSPEC_JUDGE_REPLY
  delete process.env.PROOFSPEC_JUDGE_RECORD_DIR
  if (originalPath !== undefined) {
    process.env.PATH = originalPath
    originalPath = undefined
  }
})

/** A stand-in binary: a real shell script on disk, so these tests exercise judge's real
 *  process-spawning path rather than a fake runner — named for the binary it stands in for,
 *  `pi` unless a scenario needs another. */
async function standInBinary(script: string, name = 'pi'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'proofspec-judge-'))
  standInDirs.push(dir)
  const path = join(dir, name)
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return path
}

/** The stand-in the per-binary scenarios run: it records the invocation it was handed — its
 *  own name first, then every argument, NUL-delimited so the multi-line question stays one
 *  entry — and answers with whatever `PROOFSPEC_JUDGE_REPLY` holds. */
const RECORD_AND_REPLY = [
  `printf '%s\\0' "$0" "$@" > "$PROOFSPEC_JUDGE_RECORD_DIR/invocation"`,
  `printf '%s\\n' "$PROOFSPEC_JUDGE_REPLY"`,
].join('\n')

/** Runs the real judge once, `PROOFSPEC_JUDGE_BIN` held exactly as asked (absent means the
 *  default), against a stand-in of the named binary placed first on PATH, and hands back what
 *  that stand-in saw — the binary the judge named, then the argv it handed it — together with
 *  the verdict the reply read to. */
async function judgedInvocation(
  standInName: 'pi' | 'claude',
  judgeBin: string | undefined,
  reply: string,
): Promise<{ name: string; args: string[]; verdict: JudgeVerdict }> {
  const binary = await standInBinary(RECORD_AND_REPLY, standInName)
  const recordDir = await mkdtemp(join(tmpdir(), 'proofspec-judge-'))
  standInDirs.push(recordDir)
  process.env.PROOFSPEC_JUDGE_RECORD_DIR = recordDir
  process.env.PROOFSPEC_JUDGE_REPLY = reply
  if (originalPath === undefined) originalPath = process.env.PATH
  process.env.PATH = `${dirname(binary)}:${process.env.PATH}`
  if (judgeBin === undefined) delete process.env.PROOFSPEC_JUDGE_BIN
  else process.env.PROOFSPEC_JUDGE_BIN = judgeBin

  const verdict = await piJudge(TEST_AGENT)(INPUT)

  const recorded = (await readFile(join(recordDir, 'invocation'), 'utf8')).split('\0')
  return { name: basename(recorded[0] ?? ''), args: recorded.slice(1, -1), verdict }
}

const INPUT: RelationshipJudgeInput = {
  relationship: { node: { kind: 'capability', name: 'demo' }, tasks: ['a', 'b'] },
  intents: { a: 'renames a helper', b: 'fixes a typo' },
}

/** The agent the per-binary scenarios run under: passing it to `piJudge` makes the pure
 *  builder's own assembly of the pinned argv for this same agent the exact oracle the
 *  recordings are read against — the model knob included, not just the flags around it. */
const TEST_AGENT: JudgeAgent = { model: 'zai/glm-5.3:low' }

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A process that never closes its own stdin still returns instead of hanging, because judge closes it first
// GIVEN a stand-in binary that only answers after reading its stdin to EOF
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
// GIVEN a stand-in binary that never exits on its own
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

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: With PROOFSPEC_JUDGE_BIN unset, or naming pi, the judge process is the pinned one-shot pi process
// GIVEN PROOFSPEC_JUDGE_BIN unset, and then set to name pi
// WHEN the judge process for a relationship is built
// THEN each time the process it names is pi, run as the one-shot, tool-less,
//      session-less process the judge requirements pin
it('runs the pinned one-shot pi process whenever PROOFSPEC_JUDGE_BIN is unset, and when it names pi', async () => {
  // The default must survive the argv becoming per-binary, not silently drift the moment the
  // binary name starts being read — the same guard the unset executor case carries. The pin
  // is read against the pure builder's own assembly of it, byte for byte, both times.
  const pinned = judgeProcessFor(INPUT, TEST_AGENT).args

  const unset = await judgedInvocation('pi', undefined, 'RESOLVED')
  expect(unset.name).toBe('pi')
  expect(unset.args).toEqual(pinned)

  const named = await judgedInvocation('pi', 'pi', 'RESOLVED')
  expect(named.name).toBe('pi')
  expect(named.args).toEqual(pinned)
})

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: PROOFSPEC_JUDGE_BIN naming claude runs one headless one-shot claude process
// GIVEN PROOFSPEC_JUDGE_BIN naming claude
// WHEN the judge process for a relationship is built
// THEN the process it names is claude, run as one headless one-shot process
it('runs one headless one-shot claude process when PROOFSPEC_JUDGE_BIN names claude', async () => {
  const invocation = await judgedInvocation('claude', 'claude', 'the shared file is touched for unrelated reasons\nRESOLVED')

  // The binary that ran is claude itself, in its headless one-shot mode — claude's own print
  // flag, exactly once, never an interactive session left sitting at its input box.
  expect(invocation.name).toBe('claude')
  expect(invocation.args.filter(arg => arg === '-p' || arg === '--print')).toHaveLength(1)
  // And the invocation is claude's own, not the pinned pi argv wearing claude's name: the
  // flags below are pi's pinned ones, and a claude handed them is a claude that cannot even
  // start — the argv is built for the binary it names, which is this scenario's whole claim.
  for (const piFlag of ['--no-tools', '--no-session', '--no-context-files']) {
    expect(invocation.args).not.toContain(piFlag)
  }
})

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: Whichever binary runs, the same relationship is asked the same question
// GIVEN one relationship, and the judge process built once for pi and once for claude
// WHEN the question each process is handed is read
// THEN the two questions are the same — the binary changes nothing about what is asked
it('asks the same question whichever binary runs', async () => {
  const pi = await judgedInvocation('pi', 'pi', 'RESOLVED')
  const claude = await judgedInvocation('claude', 'claude', 'RESOLVED')
  // The comparison only means anything across two builds: a claude handed exactly pi's argv
  // makes "the same question" one build agreed with itself. The guard fails first, naming
  // the missing per-binary build, rather than letting the claim pass vacuously.
  expect(claude.args).not.toEqual(pi.args)

  // One question per invocation — the entry naming the shared node, not some flag's value
  // around it — and the same one either way: the ask the pure rules assemble, unchanged.
  const question = judgeProcessFor(INPUT, TEST_AGENT).args.at(-1)!
  for (const invocation of [pi, claude]) {
    expect(invocation.args.filter(arg => arg.includes('Shared CAPABILITY_FILE'))).toEqual([question])
  }
})

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: Whichever binary runs, the answer is read to the same verdict
// GIVEN the judge process built once for pi and once for claude, and one reply text at a
//      time — first a reply ending in a clean RESOLVED, then one that does not
// WHEN each binary's process hands that reply back and its answer is read
// THEN the verdict follows the reply, never the binary — the RESOLVED-ending reply
//      reads resolved through either process, the one that does not reads unresolved through
//      either
it('reads the answer to the same verdict whichever binary runs', async () => {
  const resolvedReply = 'the shared file is touched for unrelated reasons\nRESOLVED'
  const unresolvedReply = 'both TASKs mean to change the same behavior\nUNRESOLVED'
  const piResolved = await judgedInvocation('pi', 'pi', resolvedReply)
  const claudeResolved = await judgedInvocation('claude', 'claude', resolvedReply)
  const piUnresolved = await judgedInvocation('pi', 'pi', unresolvedReply)
  const claudeUnresolved = await judgedInvocation('claude', 'claude', unresolvedReply)
  // The same guard the question scenario carries: "through either process" is one process
  // twice unless the two builds really differ.
  expect(claudeResolved.args).not.toEqual(piResolved.args)

  expect(piResolved.verdict).toEqual({ kind: 'resolved' })
  expect(claudeResolved.verdict).toEqual({ kind: 'resolved' })
  expect(piUnresolved.verdict).toEqual({ kind: 'unresolved' })
  expect(claudeUnresolved.verdict).toEqual({ kind: 'unresolved' })
})
