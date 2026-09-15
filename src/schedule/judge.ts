import { assertNever } from '../assert-never.ts'
import { compareStrings } from '../order.ts'
import type { JudgeVerdict, RelationshipJudgeInput, ScheduleActions } from './types.ts'

/**
 * Requirements: A relationship is judged by a fresh agent before a human is asked /
 * A judgement that is not a clean RESOLVED reads as unresolved, never a third case
 *
 * The real ask: a fresh, tool-less, session-less one-shot process, and the total rule that
 * turns whatever it comes back with into a `JudgeVerdict`. Judging is the first thing in this
 * capability that is not a pure function of git and the queue — the same relationship can be
 * judged differently on two passes. The safe direction (resolved on one pass, unresolved on a
 * later one) only costs a relationship being raised that a still-earlier pass let go; the
 * unsafe direction (raised, ruled, then later read as resolved) is already guarded by the
 * raised-relationships ledger, which never lets a judgement erase a human's own ruling.
 */

/** One process the judge asks to have run, assembled here and executed by whoever was injected.
 * No binary: resolving and spawning it is `cli`'s job, the same boundary `execFile` sits at
 * for every other process this repo runs. */
export type JudgeProcess = { readonly args: readonly string[] }

/** What asking came back with: what the process said, or why it never said anything. `cannot-run`
 * is a real case (the process never started) rather than a fabricated exit code — the operating
 * system never produces one for "the binary was not found." */
export type JudgeOutcome =
  | { readonly kind: 'ran'; readonly code: number; readonly stdout: string }
  | { readonly kind: 'cannot-run'; readonly reason: string }

/** How the judge runs a process. Injected, so the rules of asking and reading are testable
 * without ever really starting an agent. */
export type JudgeRunner = (process: JudgeProcess) => Promise<JudgeOutcome>

/** Which model answers. A narrow yes/no judgement buys the cheap tier. The default model is
 * `cli/judge.ts`'s to name, the same operational knob as the binary itself — this file holds
 * only the domain rules, never a live vendor/model choice. */
export type JudgeAgent = { readonly model: string }

/** Intents run unbounded through argv, which does not: past this length an intent is truncated
 * with a visible marker rather than risking the process failing to start at all. Exported so a
 * test can bound a truncated question tightly against the real cap, not just against "shorter
 * than the raw intent." */
export const MAX_INTENT_CHARS = 8_000
const TRUNCATION_MARKER = '…[truncated]'

const JUDGE_SYSTEM_PROMPT = [
  'You judge whether two in-flight coding tasks in one repository share ground by coincidence',
  'or by real conflict. You are given the file or term they both touch, and each task’s own',
  'stated intent. The same file touched for two unrelated reasons is coincidence, not a',
  'conflict. Both tasks intending to change the same behavior is a conflict.',
  'Write your reasoning, then end your reply with exactly one word alone on the last line:',
  'RESOLVED if this is coincidental and no human needs to look, or UNRESOLVED if a human',
  'should look at it.',
].join(' ')

/** The one-shot, tool-less, session-less agent run that asks whether a relationship is a real
 * conflict. No project files are read, so nothing here needs a working directory of its own. */
export function judgeProcessFor(input: RelationshipJudgeInput, agent: JudgeAgent): JudgeProcess {
  return {
    args: ['--no-tools', '--no-session', '--no-context-files', '--model', agent.model, '--system-prompt', JUDGE_SYSTEM_PROMPT, '-p', questionFor(input)],
  }
}

function questionFor(input: RelationshipJudgeInput): string {
  const nodeLabel = input.relationship.node.kind === 'capability' ? 'CAPABILITY_FILE' : 'TERM'
  const tasks = [...input.relationship.tasks].sort(compareStrings)
  const intentLines = tasks.map(task => `TASK ${task}'s intent:\n${intentTextFor(input.intents[task])}`)
  return [`Shared ${nodeLabel}: "${input.relationship.node.name}"`, ...intentLines].join('\n\n')
}

function intentTextFor(intent: string | undefined): string {
  if (intent === undefined) return 'its intent could not be read'
  return intent.length > MAX_INTENT_CHARS ? `${intent.slice(0, MAX_INTENT_CHARS)}${TRUNCATION_MARKER}` : intent
}

/**
 * Only an exact last-line match resolves. The system prompt necessarily names both words, since
 * it has to say what each one means, so a reply can easily discuss both while reasoning; reading
 * only the last line, and only an exact match, is what keeps that discussion from being misread
 * as the verdict. There is no third value: `unresolved` is already this domain's safe default —
 * it still reaches a human, the same as a judgement the fresh agent frankly could not decide — so
 * every hazard (a failed run, a non-zero exit, empty output, a reply that answers neither word)
 * collapses onto the value that costs one human glance, never onto the one that would bury a
 * real conflict.
 */
export function verdictFrom(outcome: JudgeOutcome): JudgeVerdict {
  switch (outcome.kind) {
    case 'cannot-run':
      return { kind: 'unresolved' }
    case 'ran':
      return outcome.code === 0 && lastLineOf(outcome.stdout) === 'RESOLVED' ? { kind: 'resolved' } : { kind: 'unresolved' }
    default:
      return assertNever(outcome)
  }
}

function lastLineOf(stdout: string): string {
  const lines = stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  const lastLine = lines.at(-1) ?? ''
  return lastLine.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toUpperCase()
}

/**
 * The composed real judge: build the process, run it through whatever `JudgeRunner` was
 * injected, read the answer. Kept separate from `piJudge` (`cli/judge.ts`) so a test can
 * compose this same factory with a fake runner, proving the wiring without ever crossing into
 * the one file allowed to actually spawn a process.
 */
export function judgeWith(run: JudgeRunner, agent: JudgeAgent): ScheduleActions['judge'] {
  return async input => verdictFrom(await run(judgeProcessFor(input, agent)))
}
