import { assertNever } from '../assert-never.ts'
import type { Placement, ScenarioIdentity } from '../spec-tree/index.ts'
import type { Finding, FindingSeverity } from './types.ts'

/**
 * Which findings stop a build. Kept in one place rather than as a field on every finding,
 * so the answer to "what fails the build?" is read once and cannot drift between kinds.
 */
export function severityOf(finding: Finding): FindingSeverity {
  // A site with no Gherkin is co-location in name only: there is a tag, but no claim to
  // judge the test against. Worth saying, not worth stopping for (design.md §7 rule 7).
  return finding.kind === 'no-steps' ? 'warn' : 'fail'
}

/**
 * One line a reader can act on. The point of putting a claim next to its proof is that the
 * distance between knowing something is wrong and seeing it is short, so every message
 * names what it is about and where to look.
 */
export function describeFinding(finding: Finding): string {
  switch (finding.kind) {
    case 'scenario-added':
      return `${nameOf(finding)}: proven at ${siteOf(finding)}, but the capability file does not record it`
    case 'scenario-removed':
      return `${nameOf(finding)}: recorded against ${finding.file}, but no test proves it any more`
    case 'scenario-moved':
      return `${nameOf(finding)}: recorded against ${finding.from}, now proven at ${finding.to}:${finding.line}`
    case 'unknown-requirement':
      return `${nameOf(finding)}: ${siteOf(finding)} tags a requirement the capability file does not declare`
    case 'uncovered-requirement':
      return `${finding.capability} › ${finding.requirement}: declared, but no test proves it`
    case 'duplicate-scenario':
      return `${nameOf(finding)}: claimed by ${finding.sites.map(siteOf).join(' and ')}`
    case 'no-capability':
      return `${finding.requirement} › ${finding.scenario}: ${siteOf(finding)} sits in a file that declares no capability`
    case 'no-steps':
      return `${finding.requirement} › ${finding.scenario}: ${siteOf(finding)} has no GIVEN, WHEN or THEN above it`
    case 'unreadable':
      return `${siteOf(finding)}: ${finding.message}`
    default:
      return assertNever(finding)
  }
}

/** A scenario named the way the tree reads: capability, then requirement, then scenario. */
function nameOf(identity: ScenarioIdentity): string {
  return `${identity.capability} › ${identity.requirement} › ${identity.scenario}`
}

function siteOf(site: Placement): string {
  return `${site.file}:${site.line}`
}
