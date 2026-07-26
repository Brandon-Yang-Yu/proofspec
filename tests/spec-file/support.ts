import type { CapabilitySpec, RequirementSpec } from '../../src/spec-file/index.ts'
import type { ScenarioNode } from '../../src/spec-tree/index.ts'

/** The capability every fixture is read under, named once because the read gives it back. */
export const CAPABILITY = 'spec-file'

/**
 * A Markdown code fence. Fixtures interpolate this rather than escaping backticks inside
 * a template literal, because a fixture showing an example of the format is exactly what
 * the fence rules are about and it has to stay readable.
 */
export const FENCE = '```'

export function onlyRequirement(spec: CapabilitySpec): RequirementSpec {
  const [requirement, ...rest] = spec.requirements
  if (requirement === undefined || rest.length > 0) {
    throw new Error(`expected exactly one requirement, got ${spec.requirements.length}`)
  }
  return requirement
}

export function requirementNames(spec: CapabilitySpec): string[] {
  return spec.requirements.map(requirement => requirement.requirement)
}

/** The entries recorded for one requirement. Missing throws, so a typo cannot pass as empty. */
export function entriesOf(spec: CapabilitySpec, name: string): readonly ScenarioNode[] {
  const found = spec.requirements.find(requirement => requirement.requirement === name)
  if (found === undefined) throw new Error(`the file declares no requirement named ${JSON.stringify(name)}`)
  return found.scenarios
}
