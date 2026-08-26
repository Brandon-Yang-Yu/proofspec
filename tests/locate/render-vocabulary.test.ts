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

/** One term's entry on the vocabulary page: from its heading to the next one. */
function entry(vocabulary: string, term: string): string {
  const from = vocabulary.indexOf(`## Term: ${term}`)
  const to = vocabulary.indexOf('\n## Term:', from + 1)
  return vocabulary.slice(from, to === -1 ? undefined : to)
}

const TURN: TermSpec = { term: 'TURN', definition: 'One exchange of request and reply.' }
const REPLY: TermSpec = { term: 'REPLY', definition: 'The answer half of a TURN.' }

/** A chain: REPLY leans on TURN, TURN on MARGIN — one edge direct, one reached through
 * another term's definition. */
const CHAIN: readonly TermSpec[] = [
  { term: 'MARGIN', definition: 'The space a page leaves empty.' },
  { term: 'TURN', definition: 'One exchange, framed by a MARGIN.' },
  { term: 'REPLY', definition: 'The answer half of a TURN.' },
]

// Requirement: The vocabulary is rendered as one page, linked from the index
// Scenario: The vocabulary page holds every TERM in name order
// GIVEN a CAPABILITY_FILE declaring its TERM out of name order
// WHEN the site is rendered
// THEN one vocabulary page holds every TERM with its definition, in name order, so a
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
// GIVEN a site rendered from specs that define TERM, and one rendered from specs that
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
// GIVEN a site rendered from specs that define TERM
// WHEN the whole-spec page is read
// THEN it carries the vocabulary with it, because a model handed the one file is handed
//      the meanings along with the PROMISE
it('carries the vocabulary on the whole-spec page', () => {
  const whole = page(renderSite([spec({ capability: 'demo', terms: [TURN, REPLY] })], [], []), 'spec.md')

  expect(whole).toContain('## Vocabulary')
  expect(whole).toContain('One exchange of request and reply.')
  expect(whole).toContain('The answer half of a TURN.')
})

// Requirement: The vocabulary is rendered as one page, linked from the index
// Scenario: A TERM's entry shows what it leans on and what a change to it reaches
// GIVEN TERM whose definitions lean on one another, one through another TERM's definition
// WHEN the vocabulary page is read
// THEN each entry says what its TERM leans on and what a change to it reaches, both
//      through other TERM definitions, and the whole-spec page carries the definitions
//      alone, because a model handed the one file wants the meanings, not the map
it('shows each term what it leans on and what a change to it reaches', () => {
  const site = renderSite([spec({ capability: 'demo', terms: CHAIN })], [], [])
  const vocabulary = page(site, 'vocabulary.md')

  const turn = entry(vocabulary, 'TURN')
  expect(turn).toContain('- leans on: MARGIN')
  expect(turn).toContain('- a change reaches: REPLY')

  const reply = entry(vocabulary, 'REPLY')
  expect(reply).toContain('- leans on: MARGIN, TURN')
  expect(reply).not.toContain('a change reaches')

  const margin = entry(vocabulary, 'MARGIN')
  expect(margin).not.toContain('leans on')
  expect(margin).toContain('- a change reaches: REPLY, TURN')

  const whole = page(site, 'spec.md')
  expect(whole).toContain('The answer half of a TURN.')
  expect(whole).not.toContain('leans on')
})
