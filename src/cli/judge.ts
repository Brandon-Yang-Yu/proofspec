import { execFile } from 'node:child_process'
import { judgeWith } from '../schedule/index.ts'
import type { JudgeAgent, JudgeOutcome, JudgeProcess, ScheduleActions } from '../schedule/index.ts'

// Exported so a test can assert a fallback against this value instead of a duplicated literal.
export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000
// A reasoning reply is short; this only avoids ever truncating a real one.
const MAX_JUDGE_OUTPUT = 1024 * 1024

// The live vendor/model choice, an operational knob owned here beside `PROOFSPEC_JUDGE_BIN` —
// `schedule/judge.ts` stays domain rules only, with no default agent of its own.
const DEFAULT_JUDGE_AGENT: JudgeAgent = { model: 'zai/glm-5.3:low' }

/**
 * The real one-shot agent run: a fresh `pi` process per relationship, saving no session. The
 * pure rules of asking and reading live in `schedule/judge.ts`; this is the one thing that
 * actually spawns a process, the same boundary `graph.ts` keeps for the codebase-memory CLI.
 */
export function piJudge(agent: JudgeAgent = DEFAULT_JUDGE_AGENT): NonNullable<ScheduleActions['judge']> {
  return judgeWith(runJudgeProcess, agent)
}

/**
 * A hung agent must not hang a whole scheduling pass, which awaits one judge call at a time —
 * `raw` is `PROOFSPEC_JUDGE_TIMEOUT_MS`, read fresh by the caller on every call the same as
 * `PROOFSPEC_JUDGE_BIN` below, since a module-level constant would freeze whatever the env
 * held at first import, before a test ever gets to set it. Anything short of a positive number
 * falls back to the default rather than silently disabling the timeout: `execFile`'s own
 * `timeout` option only arms when it is greater than zero, so a malformed override would
 * otherwise reintroduce the exact hang this exists to prevent.
 */
export function judgeTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_JUDGE_TIMEOUT_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_JUDGE_TIMEOUT_MS
}

async function runJudgeProcess(judgeProcess: JudgeProcess): Promise<JudgeOutcome> {
  const binary = process.env.PROOFSPEC_JUDGE_BIN ?? 'pi'
  const timeoutMs = judgeTimeoutMs(process.env.PROOFSPEC_JUDGE_TIMEOUT_MS)
  try {
    const stdout = await execFileWithClosedStdin(binary, judgeProcess.args, timeoutMs)
    return { kind: 'ran', code: 0, stdout }
  } catch (error) {
    return outcomeFor(error, timeoutMs)
  }
}

/**
 * `execFile` never closes the child's stdin on its own — a promisified call hides the
 * `ChildProcess` handle needed to do it. Without that, `pi` (which reads stdin when it is not
 * a TTY) blocks waiting for input that will never arrive, and every real call burns the full
 * timeout before ever answering. Ending stdin the instant the process starts gives it an
 * immediate EOF, the same as if nothing were piped into it on a real terminal.
 */
function execFileWithClosedStdin(binary: string, args: readonly string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: MAX_JUDGE_OUTPUT }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
    // Never null with the options above (no `stdio` override). Asserting rather than `?.`-ing
    // past it means a future edit that does add one gets a loud failure here — the exact hang
    // this function exists to prevent, reintroduced with zero signal, is what optional chaining
    // would otherwise hide.
    if (child.stdin === null) throw new Error('judge: pi process was spawned with no stdin to close')
    child.stdin.end()
  })
}

/**
 * `verdictFrom` never consults `stdout` once `code !== 0`, so a non-zero exit is reported with
 * no stdout of its own rather than reaching for it from the rejected call — Node's own
 * `execFile` error does not reliably carry it. `.code` means three different things here: a
 * spawn failure (the binary was never found) carries a string errno like `ENOENT`, a timeout
 * kill carries `null` (told apart from a spawn failure by `.killed`, below), and an exited
 * process carries its numeric exit code. Only the last is `ran`; both others are `cannot-run`.
 * Also logs one diagnostic line to `stderr` in either case — the parser stays pure and total,
 * so this is the one place "pi isn't installed" (or "pi never answered in time") is visible to
 * anyone watching the process, even though every outcome still safely reads as
 * unresolved.
 */
function outcomeFor(error: unknown, timeoutMs: number): JudgeOutcome {
  const code = exitCodeOf(error)
  if (code === undefined) {
    const reason = wasKilledByTimeout(error) ? `pi did not answer within ${timeoutMs}ms` : messageOf(error)
    process.stderr.write(`judge: could not run pi: ${reason}\n`)
    return { kind: 'cannot-run', reason }
  }
  process.stderr.write(`judge: pi exited ${code}\n`)
  return { kind: 'ran', code, stdout: '' }
}

function exitCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as Record<string, unknown>)['code']
  return typeof code === 'number' ? code : undefined
}

/** Node reports the `timeout` option firing as a `code: null` error, indistinguishable from a
 * spawn failure by `.code` alone — but it also sets `.killed`, only ever true when this module's
 * own timeout killed the process. Told apart so the diagnostic says what actually happened,
 * never "could not run pi" for a process that did run and simply never answered in time. */
function wasKilledByTimeout(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as Record<string, unknown>)['killed'] === true
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
