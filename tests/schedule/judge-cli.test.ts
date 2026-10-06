// Capability: schedule
//
// Unlike `judge.test.ts`, every scenario here really spawns a process — a small stand-in
// script standing in for the judge's binary — because these claims are about the real spawn
// itself (closing stdin, bounding the wait, which binary runs and what it is handed), not
// the domain rules `judge.test.ts` already covers with a fake `JudgeRunner`. Each spawn runs
// the way the bare CLI runs the judge: `piJudge()` called from inside a git main checkout
// holding the settings file, with PROOFSPEC_QUEUE_ROOT unset, on a PATH that reaches only
// stand-ins and the system's own programs — never a real `pi` or `claude`.

import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { judgeTimeoutMs, piJudge } from '../../src/cli/judge.ts'
import { DEFAULT_JUDGE_TIMEOUT_MS } from '../../src/settings.ts'
import { judgeProcessFor } from '../../src/schedule/index.ts'
import type { JudgeAgent, JudgeVerdict, RelationshipJudgeInput } from '../../src/schedule/index.ts'
import { cleanupRepos, makeGitRepo, makeRepo } from '../cli/support.ts'

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A malformed timeout value falls back to the default, rather than silently disabling the timeout
// GIVEN a settings file at the queue root whose judgeTimeoutMs is not a positive number
// WHEN the judge's timeout is read
// THEN it answers the default timeout, not the malformed value
it('falls back to the default timeout on a malformed value', async () => {
  const zero = await makeRepo({ '.proofspec/config.json': JSON.stringify({ judgeTimeoutMs: 0 }) })
  const negative = await makeRepo({ '.proofspec/config.json': JSON.stringify({ judgeTimeoutMs: -500 }) })
  const word = await makeRepo({ '.proofspec/config.json': JSON.stringify({ judgeTimeoutMs: 'many' }) })
  // A string that reads as a number is still not a number: coercing it would take "45000" as such.
  const numericString = await makeRepo({ '.proofspec/config.json': JSON.stringify({ judgeTimeoutMs: '45000' }) })

  // The default must come from reading the file and refusing its value, never from not
  // reading it at all: a well-formed value at a sibling queue root is answered as written.
  const wellFormed = await makeRepo({ '.proofspec/config.json': JSON.stringify({ judgeTimeoutMs: 45_000 }) })
  expect(judgeTimeoutMs(wellFormed.root)).toBe(45_000)

  expect(judgeTimeoutMs(zero.root)).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs(negative.root)).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs(word.root)).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
  expect(judgeTimeoutMs(numericString.root)).toBe(DEFAULT_JUDGE_TIMEOUT_MS)
})

// Generous, not tight: this bounds a process that finishes in milliseconds, so it only needs
// enough headroom that a real spawn under load never brushes it — unlike the other test below,
// which deliberately wants a short bound its stand-in process will actually hit.
const AMPLE_TIMEOUT_MS = 5000
const SHORT_TIMEOUT_MS = 1000

let standInDirs: string[] = []
// PATH and cwd are only ever changed around one judge call and restored whole — a stand-in
// dir left on PATH would shadow the real `pi`/`claude` for every later test, and a cwd left
// inside a deleted repo would break every later spawn.
const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_CWD = process.cwd()
// A session running this suite may carry PROOFSPEC_QUEUE_ROOT pointing at the real queue; the
// bare CLI a person runs has none, and these spawns run as that CLI does.
delete process.env.PROOFSPEC_QUEUE_ROOT

afterEach(cleanupRepos)
afterEach(async () => {
  process.chdir(ORIGINAL_CWD)
  process.env.PATH = ORIGINAL_PATH
  await Promise.all(standInDirs.map(dir => rm(dir, { recursive: true, force: true })))
  standInDirs = []
  delete process.env.PROOFSPEC_QUEUE_ROOT
  delete process.env.PROOFSPEC_JUDGE_REPLY
  delete process.env.PROOFSPEC_JUDGE_RECORD_DIR
})

/** A stand-in binary: a real shell script on disk, so these tests exercise judge's real
 *  process-spawning path rather than a fake runner — named for the binary it stands in for,
 *  `pi` unless a scenario needs another. */
async function standInBinary(script: string, name = 'pi', dir?: string): Promise<string> {
  const home = dir ?? (await standInDir())
  const path = join(home, name)
  await writeFile(path, `#!/bin/sh\n${script}\n`)
  await chmod(path, 0o755)
  return path
}

async function standInDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'proofspec-judge-'))
  standInDirs.push(dir)
  return dir
}

/** A PATH that reaches the given dir first and then only the system's own programs — never a
 *  directory a real `pi` or `claude` is installed in. */
function guardedPath(dir: string): string {
  return `${dir}:/usr/bin:/bin`
}

/** A dir holding a guard `pi` and `claude` that only mark themselves if run, for the
 *  scenarios whose settings name a stand-in by path: whichever program a judge reached for by
 *  name instead is caught by its mark, never a real harness spawned. */
async function guardDir(): Promise<string> {
  const dir = await standInDir()
  for (const name of ['pi', 'claude']) await standInBinary(`touch "$0.ran"\nexit 1`, name, dir)
  return dir
}

/** Runs the real judge the way the bare CLI runs it: `piJudge(agent)` from inside a git main
 *  checkout holding exactly this settings file, PROOFSPEC_QUEUE_ROOT unset, on the given PATH —
 *  and answers its verdict and how long the judge call alone took, the repo's own setup left
 *  off the clock. */
async function judgeFromMainCheckout(
  settings: Readonly<Record<string, unknown>>,
  path: string,
  agent?: JudgeAgent,
): Promise<{ verdict: JudgeVerdict; elapsedMs: number }> {
  const repo = await makeGitRepo({ 'README.md': 'a repo the judge runs in\n' })
  await repo.write('.proofspec/config.json', JSON.stringify(settings))
  delete process.env.PROOFSPEC_QUEUE_ROOT
  process.chdir(repo.root)
  process.env.PATH = path
  const startedAt = Date.now()
  try {
    const verdict = await piJudge(agent)(INPUT)
    return { verdict, elapsedMs: Date.now() - startedAt }
  } finally {
    process.env.PATH = ORIGINAL_PATH
    process.chdir(ORIGINAL_CWD)
  }
}

/** The stand-in the per-binary scenarios run: it records the invocation it was handed — its
 *  own name first, then every argument, NUL-delimited so the multi-line question stays one
 *  entry — and answers with whatever `PROOFSPEC_JUDGE_REPLY` holds. */
const RECORD_AND_REPLY = [
  `printf '%s\\0' "$0" "$@" > "$PROOFSPEC_JUDGE_RECORD_DIR/invocation"`,
  `printf '%s\\n' "$PROOFSPEC_JUDGE_REPLY"`,
].join('\n')

/** Runs the real judge once, a settings file in a throwaway git main checkout holding
 *  `judgeBin` exactly as asked (absent means the default), with a recording stand-in for both
 *  `pi` and `claude` first on a PATH that reaches no real one, and hands back what the stand-in
 *  that ran saw — the binary the judge named, then the argv it handed it — together with the
 *  verdict the reply read to. Both names are stood in so that a judge running the wrong one is
 *  read off the recording, never a real harness spawned. */
async function judgedInvocation(
  standInName: 'pi' | 'claude',
  judgeBin: string | undefined,
  reply: string,
): Promise<{ name: string; args: string[]; verdict: JudgeVerdict }> {
  const binary = await standInBinary(RECORD_AND_REPLY, standInName)
  await standInBinary(RECORD_AND_REPLY, standInName === 'pi' ? 'claude' : 'pi', dirname(binary))
  const recordDir = await standInDir()
  process.env.PROOFSPEC_JUDGE_RECORD_DIR = recordDir
  process.env.PROOFSPEC_JUDGE_REPLY = reply

  // One fresh main checkout per build: the settings file is the variable under test, so no
  // build ever reads an earlier build's file.
  const { verdict } = await judgeFromMainCheckout(judgeBin === undefined ? {} : { judgeBin }, guardedPath(dirname(binary)), TEST_AGENT)

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
  // The stand-in marks that it ran, so the verdict is read off the stand-in the settings file
  // names — never off some other program that happened to answer.
  const standIn = await standInBinary('touch "$0.ran"; cat >/dev/null; echo RESOLVED')
  const guards = await guardDir()

  const { verdict } = await judgeFromMainCheckout({ judgeBin: standIn, judgeTimeoutMs: AMPLE_TIMEOUT_MS }, guardedPath(guards))

  expect(existsSync(`${standIn}.ran`)).toBe(true)
  expect(existsSync(join(guards, 'pi.ran'))).toBe(false)
  expect(verdict).toEqual({ kind: 'resolved' })
}, 10_000)

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: A process that never answers is not waited on past the configured timeout
// GIVEN a stand-in binary that never exits on its own
// WHEN judge runs it, bounded by a short configured timeout
// THEN the outcome reads as unresolved once the timeout elapses, not once the process would eventually exit
it(
  'does not wait past the configured timeout for a process that never answers',
  async () => {
    // The stand-in marks that it ran before it sleeps, so the timeout is read off the
    // never-answering stand-in the settings file names — never off some other program that
    // exited at once.
    const standIn = await standInBinary('touch "$0.ran"\nexec sleep 100')
    const guards = await guardDir()

    const { verdict, elapsedMs } = await judgeFromMainCheckout({ judgeBin: standIn, judgeTimeoutMs: SHORT_TIMEOUT_MS }, guardedPath(guards))

    expect(existsSync(`${standIn}.ran`)).toBe(true)
    expect(existsSync(join(guards, 'pi.ran'))).toBe(false)
    expect(verdict).toEqual({ kind: 'unresolved' })
    // Additive, not multiplicative, headroom: the window holds the judge's own git lookup of the
    // main checkout plus spawn and kill, which together reach a few hundred ms on a loaded
    // machine, so +700ms leaves room for that — yet stays under twice the configured value, so a
    // mutation that silently doubles or triples it still fails here.
    expect(elapsedMs).toBeLessThan(SHORT_TIMEOUT_MS + 700)
    // Nor killed early: a wait shorter than the configured one, or one fixed regardless of it,
    // fails here or in tests/cli/config.test.ts, whose window shares no number with this one.
    expect(elapsedMs).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS - 50)
  },
  10_000,
)

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: With the settings file naming no judgeBin, or naming pi, the judge process is the pinned one-shot pi process
// GIVEN a settings file at the queue root holding no judgeBin key, and then one naming pi
// WHEN the judge process for a relationship is built
// THEN each time the process it names is pi, run as the one-shot, tool-less,
//      session-less process the judge requirements pin
it('runs the pinned one-shot pi process when the settings file names no judgeBin, and when it names pi', async () => {
  // The default must survive the argv becoming per-binary, not silently drift the moment the
  // binary name starts being read from the settings file. The pin is read against the pure
  // builder's own assembly of it, byte for byte, both times.
  const pinned = judgeProcessFor(INPUT, TEST_AGENT).args

  const absentKey = await judgedInvocation('pi', undefined, 'RESOLVED')
  expect(absentKey.name).toBe('pi')
  expect(absentKey.args).toEqual(pinned)

  const named = await judgedInvocation('pi', 'pi', 'RESOLVED')
  expect(named.name).toBe('pi')
  expect(named.args).toEqual(pinned)
})

// Requirement: The bare CLI's judge asks a fresh one-shot process per relationship, its stdin closed so it cannot hang
// Scenario: The settings file's judgeBin naming claude runs one headless one-shot claude process
// GIVEN a settings file at the queue root whose judgeBin names claude
// WHEN the judge process for a relationship is built
// THEN the process it names is claude, run as one headless one-shot process
it('runs one headless one-shot claude process when the settings file names claude as its judgeBin', async () => {
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
