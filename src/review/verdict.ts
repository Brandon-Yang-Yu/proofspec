import type { Verdict } from './types.ts'

export const VERDICTS: readonly Verdict[] = ['ok', 'gap', 'drift']

/**
 * Whether a string names a verdict. `review` owns what a verdict is, so it owns the question —
 * and putting it here rather than in the argument parser is what puts the decision somewhere a
 * test can reach it.
 */
export function isVerdict(value: string): value is Verdict {
  return VERDICTS.includes(value as Verdict)
}
