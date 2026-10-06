import { execFile } from 'node:child_process'
import { judgeWith } from '../schedule/index.ts'
import type { JudgeAgent, JudgeOutcome, JudgeProcess, ScheduleActions } from '../schedule/index.ts'
import { DEFAULT_JUDGE_TIMEOUT_MS, readCommandSettings, settingsOrThrow } from '../settings.ts'

// Exported so a test can assert a fallback against this value instead of a duplicated literal.
export { DEFAULT_JUDGE_TIMEOUT_MS }
// A reasoning reply is short; this only avoids ever truncating a real one.
const MAX_JUDGE_OUTPUT = 1024 * 1024

// The live vendor/model choice, an operational knob owned here beside the settings file's `judgeBin` —
// `schedule/judge.ts` stays domain rules only, with no default agent of its own.
const DEFAULT_JUDGE_AGENT: JudgeAgent = { model: 'zai/glm-5.3:low' }

/**
 * The real one-shot agent run: a fresh process per relationship — `pi` by default,
 * `claude` headless when the settings file's `judgeBin` names it — saving no session. The pure rules of
 * asking and reading live in `schedule/judge.ts`; this is the one thing that actually
 * spawns a process, the same boundary `graph.ts` keeps for the codebase-memory CLI.
 */
export function piJudge(agent: JudgeAgent = DEFAULT_JUDGE_AGENT): NonNullable<ScheduleActions['judge']> {
  return judgeWith(runJudgeProcess, agent)
}

/**
 * A hung agent must not hang a whole scheduling pass, which awaits one judge call at a time —
 * the timeout is the settings file's `judgeTimeoutMs` at `queueRoot`, read fresh on every
 * call, since a module-level constant would freeze whatever the file held at first import.
 * Anything short of a positive number falls back to the default rather than silently
 * disabling the timeout (`src/settings.ts`): `execFile`'s own `timeout` option only arms when
 * it is greater than zero.
 */
export async function judgeTimeoutMs(queueRoot: string): Promise<number> {
  return settingsOrThrow(queueRoot).judgeTimeoutMs
}

/**
 * The judge runs inside the bare CLI's scheduling pass, which stands in the queue's checkout,
 * so its settings are the ones a command a person runs reads there. A settings file that
 * cannot be read throws naming the file — the judge's caller has no value to carry it in, and
 * running the default program instead would be the quiet run on defaults the file forbids.
 */
async function runJudgeProcess(judgeProcess: JudgeProcess): Promise<JudgeOutcome> {
  const read = await readCommandSettings(process.cwd())
  if (!read.ok) throw new Error(read.reason)
  const binary = read.settings.judgeBin
  const timeoutMs = read.settings.judgeTimeoutMs
  try {
    const stdout = await execFileWithClosedStdin(binary, judgeArgsFor(binary, judgeProcess.args), timeoutMs)
    return { kind: 'ran', code: 0, stdout }
  } catch (error) {
    return outcomeFor(error, timeoutMs, binary)
  }
}

/**
 * The argv the judge's process runs, per binary. The pure builder (`schedule/judge.ts`)
 * assembles the pinned `pi` argv — and with it everything the ask needs: the system prompt
 * and the question sit inside it, so the per-binary choice is only which harness's argv
 * carries them. `claude` runs headless one-shot (`-p`, once): the same system prompt, the
 * same question, never the `pi` flags a `claude` binary cannot even start under. Anything
 * else keeps the pinned argv untouched.
 */
function judgeArgsFor(binary: string, pinned: readonly string[]): readonly string[] {
  if (binary !== 'claude') return pinned
  const question = pinned.at(-1)
  if (question === undefined) throw new Error('judge: the pinned argv carries no question to ask')
  const promptAt = pinned.indexOf('--system-prompt')
  const systemPrompt = promptAt === -1 ? undefined : pinned[promptAt + 1]
  return systemPrompt === undefined ? ['-p', question] : ['-p', '--system-prompt', systemPrompt, question]
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
function outcomeFor(error: unknown, timeoutMs: number, binary: string): JudgeOutcome {
  const code = exitCodeOf(error)
  if (code === undefined) {
    const reason = wasKilledByTimeout(error) ? `${binary} did not answer within ${timeoutMs}ms` : messageOf(error)
    process.stderr.write(`judge: could not run ${binary}: ${reason}\n`)
    return { kind: 'cannot-run', reason }
  }
  process.stderr.write(`judge: ${binary} exited ${code}\n`)
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
