/**
 * Requirement: Every place that asks git about the BASE_BRANCH reads one name (specs/cli.md)
 *
 * The one resolution of the BASE_BRANCH's name: the branch the `PROOFSPEC_BASE_BRANCH`
 * environment variable names, or `main` when that variable is unset (specs/glossary.md).
 * Every place that asks git about the base reads it from here — a caller that spelled the
 * name for itself would ask about a different branch than the rest once the variable is set.
 */
export function baseBranch(): string {
  return process.env.PROOFSPEC_BASE_BRANCH ?? 'main'
}
