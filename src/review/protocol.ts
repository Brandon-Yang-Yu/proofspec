import type { ReviewProtocol } from './types.ts'

/**
 * How the scenarios under a requirement are to be judged, handed over with them.
 *
 * The wording is the tool's rather than the caller's for the same reason the proving source
 * is: a reviewer who has to remember how to ask will not. And the asking is not incidental —
 * a reviewer asked "is this claim honest?" answers yes, and one asked to find the
 * overstatement goes looking. Only one of those two questions finds anything.
 */
export const REVIEW_PROTOCOL: ReviewProtocol = {
  judge:
    'For each scenario below, find where its claim promises more than its proof actually asserts. ' +
    'Read the THEN against the proving lines and name the line that asserts it. ' +
    'Record a pass only if you genuinely cannot find the overstatement.',
  pass: 'proofspec review <key> --verdict ok --proves <line> --by <who>',
  report: 'proofspec review <key> --verdict gap|drift --note <what you found> --by <who>',
}
