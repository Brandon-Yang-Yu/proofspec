// Capability: schedule
//
// No test here ever spawns `pi` — every scenario supplies a fake `JudgeRunner`, the same
// discipline `end-to-end.test.ts` keeps for a real executor session.

import { expect, it } from 'vitest'
import type { Relationship } from '../../src/inflight/index.ts'
import { judgeProcessFor, judgeWith, MAX_INTENT_CHARS, verdictFrom } from '../../src/schedule/index.ts'
import type { JudgeOutcome, JudgeProcess, JudgeRunner, RelationshipJudgeInput } from '../../src/schedule/index.ts'

function relationship(name: string, tasks: readonly string[]): Relationship {
  return { node: { kind: 'capability', name }, tasks }
}

function inputFor(tasks: readonly string[], intents: Readonly<Record<string, string>>): RelationshipJudgeInput {
  return { relationship: relationship('cli', tasks), intents }
}

const TEST_AGENT = { model: 'zai/glm-5.3:low' }

/** The prompt handed to the fresh agent: the last argument, as `judgeProcessFor` builds it. */
function promptOf(process: JudgeProcess): string {
  return process.args.at(-1) ?? ''
}

function fakeRunner(outcome: JudgeOutcome): { readonly run: JudgeRunner; readonly asked: JudgeProcess[] } {
  const asked: JudgeProcess[] = []
  return {
    asked,
    run: async process => {
      asked.push(process)
      return outcome
    },
  }
}

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A fresh agent is asked in one tool-less, session-less process, naming the model it runs as
// GIVEN a relationship over a shared CAPABILITY_FILE
// WHEN the judge builds the process to ask about it
// THEN the process runs with no tools and no saved session, naming the model it answers as
it('builds a tool-less, session-less process naming the model', () => {
  const process = judgeProcessFor(inputFor(['a', 'b'], { a: 'x', b: 'y' }), TEST_AGENT)

  expect(process.args).toContain('--no-tools')
  expect(process.args).toContain('--no-session')
  expect(process.args).toContain(TEST_AGENT.model)
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: A TASK whose intent could not be read is named as missing in the question, not silently dropped
// GIVEN a relationship naming two TASKs, only one of which has an intent
// WHEN the judge builds the process to ask about it
// THEN the question names the other TASK and says its intent could not be read
it('names a missing intent rather than dropping it silently', () => {
  const process = judgeProcessFor(inputFor(['a', 'b'], { a: 'renames a helper function' }), TEST_AGENT)

  const question = promptOf(process)
  // Pinned to the exact line naming TASK b, not just to the letter "b" appearing somewhere —
  // the fixed phrase "could not be read" already contains a "b", so a looser check would still
  // pass a bug that dropped which TASK is missing.
  expect(question).toContain("TASK b's intent:\nits intent could not be read")
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: The same relationship asks the same question regardless of which TASK's intent arrived first
// GIVEN two relationships over the same node and TASKs, listed in different orders
// WHEN the judge builds the process for each
// THEN the two processes are identical
it('asks the same question regardless of TASK order', () => {
  const first = judgeProcessFor(inputFor(['a', 'b'], { a: 'renames a helper function', b: 'fixes an unrelated typo' }), TEST_AGENT)
  const second = judgeProcessFor(inputFor(['b', 'a'], { a: 'renames a helper function', b: 'fixes an unrelated typo' }), TEST_AGENT)

  expect(second).toEqual(first)
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: An intent past the length cap is truncated rather than left to overflow the process's argument list
// GIVEN a TASK whose intent is far longer than the cap
// WHEN the judge builds the process to ask about it
// THEN the question carries a truncation marker and stays far shorter than the raw intent
it('truncates an intent far longer than the cap', () => {
  const longIntent = 'x'.repeat(50_000)
  const process = judgeProcessFor(inputFor(['a', 'b'], { a: longIntent, b: 'fixes an unrelated typo' }), TEST_AGENT)

  const question = promptOf(process)
  // Bounded tightly against the real cap, not just against the raw 50,000-char intent — a cap
  // set far too high would still shrink the intent and keep the marker, and would still pass a
  // looser "shorter than 50,000" assertion.
  expect(question.length).toBeLessThan(MAX_INTENT_CHARS + 200)
  expect(question.toLowerCase()).toContain('truncat')
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: A plain RESOLVED last line resolves the judgement
// GIVEN a process that exits cleanly with a reply whose last line is exactly RESOLVED
// WHEN the answer is read
// THEN the judgement is resolved
it('resolves a plain RESOLVED last line', () => {
  expect(verdictFrom({ kind: 'ran', code: 0, stdout: 'It looks coincidental.\nRESOLVED' })).toEqual({ kind: 'resolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: A plain UNRESOLVED last line leaves the judgement unresolved
// GIVEN a process that exits cleanly with a reply whose last line is exactly UNRESOLVED
// WHEN the answer is read
// THEN the judgement is unresolved
it('leaves a plain UNRESOLVED last line unresolved', () => {
  expect(verdictFrom({ kind: 'ran', code: 0, stdout: 'Both intend to change the same behavior.\nUNRESOLVED' })).toEqual({
    kind: 'unresolved',
  })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: Prose ending in neither word leaves the judgement unresolved
// GIVEN a process that exits cleanly with prose that ends in neither word
// WHEN the answer is read
// THEN the judgement is unresolved
it('leaves prose ending in neither word unresolved', () => {
  expect(verdictFrom({ kind: 'ran', code: 0, stdout: "I'm not sure what to make of this." })).toEqual({ kind: 'unresolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: Empty output leaves the judgement unresolved
// GIVEN a process that exits cleanly with no output at all
// WHEN the answer is read
// THEN the judgement is unresolved
it('leaves empty output unresolved', () => {
  expect(verdictFrom({ kind: 'ran', code: 0, stdout: '' })).toEqual({ kind: 'unresolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: A reply that discusses both words but ends in RESOLVED still resolves the judgement
// GIVEN a process that exits cleanly with a reply that discusses UNRESOLVED and RESOLVED while
//       reasoning, but whose last line is exactly RESOLVED
// WHEN the answer is read
// THEN the judgement is resolved
it('resolves a reply that discusses both words but ends in RESOLVED', () => {
  const stdout = 'This could be RESOLVED or UNRESOLVED depending on intent — reading both, it is coincidental.\nRESOLVED'
  expect(verdictFrom({ kind: 'ran', code: 0, stdout })).toEqual({ kind: 'resolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: Casing and punctuation around the last line do not change the verdict
// GIVEN a process that exits cleanly with a reply whose last line is "resolved." — lower-cased
//       and followed by a period
// WHEN the answer is read
// THEN the judgement is resolved
it('is not changed by casing or trailing punctuation', () => {
  expect(verdictFrom({ kind: 'ran', code: 0, stdout: 'Looks coincidental.\nresolved.' })).toEqual({ kind: 'resolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: A non-zero exit is never read as an answer, whatever stdout says
// GIVEN a process that exits with a non-zero code, even though its stdout is exactly RESOLVED
// WHEN the answer is read
// THEN the judgement is unresolved
it('never reads a non-zero exit as an answer', () => {
  expect(verdictFrom({ kind: 'ran', code: 1, stdout: 'RESOLVED' })).toEqual({ kind: 'unresolved' })
})

// Requirement: A judgement that is not a clean RESOLVED reads as unresolved, never a third case
// Scenario: A process that never ran leaves the judgement unresolved
// GIVEN a fresh agent's process that never ran at all
// WHEN the answer is read
// THEN the judgement is unresolved
it('leaves a process that never ran unresolved', () => {
  expect(verdictFrom({ kind: 'cannot-run', reason: 'ENOENT: pi not found' })).toEqual({ kind: 'unresolved' })
})

// Requirement: A relationship is judged by a fresh agent before a human is asked
// Scenario: The composed judge factory hands its runner the real process and reads its answer through the real parser
// GIVEN a judge composed from the real process builder, the real parser, and a stand-in runner
// WHEN it judges a relationship
// THEN the runner is handed exactly the process the real builder built, and the judge returns
//      exactly what the real parser reads from the runner's answer
it('hands its runner the real process and reads its answer through the real parser', async () => {
  const input = inputFor(['a', 'b'], { a: 'x', b: 'y' })
  const { run, asked } = fakeRunner({ kind: 'ran', code: 0, stdout: 'RESOLVED' })
  const judge = judgeWith(run, TEST_AGENT)

  const verdict = await judge(input)

  expect(asked).toEqual([judgeProcessFor(input, TEST_AGENT)])
  expect(verdict).toEqual({ kind: 'resolved' })
})
