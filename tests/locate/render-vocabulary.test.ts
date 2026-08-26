// Capability: locate

import { expect, it } from 'vitest'
import { renderSite } from '../../src/locate/index.ts'
import type { RenderedPage } from '../../src/locate/index.ts'
import type { CapabilitySpec, TermSpec } from '../../src/spec-file/index.ts'

/** A capability spec as `spec-file` hands it over, with a vocabulary to render. */
function spec(fields: {
  readonly capability: string
  readonly terms?: readonly TermSpec[]
}): CapabilitySpec {
  return {
    capability: fields.capability,
    requirements: [],
    terms: fields.terms ?? [],
  }
}

/** The content of the page at `path`, or '' when the site holds no such page. */
function page(pages: readonly RenderedPage[], path: string): string {
  return pages.find(one => one.path === path)?.content ?? ''
}

const TURN: TermSpec = { term: 'TURN', definition: 'One exchange of request and reply.' }
const REPLY: TermSpec = { term: 'REPLY', definition: 'The answer half of a TURN.' }

// Requirement: The vocabulary is rendered as one page, linked from the index
// Scenario: The vocabulary page holds every term in name order
// GIVEN a capability file declaring its terms out of name order
// WHEN the site is rendered
// THEN one vocabulary page holds every term with its definition, in name order, so a
//      reader looking for a word finds it in the one place words are defined
it('renders every term on one vocabulary page in name order', () => {
  const vocabulary = page(renderSite([spec({ capability: 'demo', terms: [TURN, REPLY] })], [], []), 'vocabulary.md')

  const reply = vocabulary.indexOf('## Term: REPLY')
  const turn = vocabulary.indexOf('## Term: TURN')
  expect(vocabulary).toContain('The answer half of a TURN.')
  expect(vocabulary).toContain('One exchange of request and reply.')
  expect(reply).toBeGreaterThan(-1)
  expect(turn).toBeGreaterThan(reply)
})

// Requirement: The vocabulary is rendered as one page, linked from the index
// Scenario: The index links the vocabulary page
// GIVEN a site rendered from specs that define terms, and one rendered from specs that
//       define none
// WHEN the index of each is read
// THEN the first links the vocabulary page and the second does not, because a repository
//      with no glossary is rendered exactly as it was before glossaries existed
it('links the vocabulary page from the index, and only when terms exist', () => {
  const withTerms = renderSite([spec({ capability: 'demo', terms: [TURN] })], [], [])
  const withoutTerms = renderSite([spec({ capability: 'demo' })], [], [])

  expect(page(withTerms, 'index.md')).toContain('[vocabulary](vocabulary.md)')
  expect(page(withoutTerms, 'index.md')).not.toContain('vocabulary')
  expect(withoutTerms.map(one => one.path)).not.toContain('vocabulary.md')
})

// Requirement: The vocabulary is rendered as one page, linked from the index
// Scenario: The whole-spec page carries the vocabulary
// GIVEN a site rendered from specs that define terms
// WHEN the whole-spec page is read
// THEN it carries the vocabulary with it, because a model handed the one file is handed
//      the meanings along with the promises
it('carries the vocabulary on the whole-spec page', () => {
  const whole = page(renderSite([spec({ capability: 'demo', terms: [TURN, REPLY] })], [], []), 'spec.md')

  expect(whole).toContain('## Vocabulary')
  expect(whole).toContain('One exchange of request and reply.')
  expect(whole).toContain('The answer half of a TURN.')
})
