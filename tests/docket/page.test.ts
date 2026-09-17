// Capability: docket

import { createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { docketPage, PAGE_REFRESH_MILLISECONDS } from '../../src/docket/index.ts'

/** An answer worth a second screen, walking every rendering branch the page holds: a
 *  working TASK with a session, a merged TASK with no heartbeat, a TASK stacked on another,
 * a problem, a debt with its named node, and one whose key names no node at all — so no
 *  literal the script could emit goes unrendered. */
/** The exact attach command one row carries, named once so the answer that carries it and
 *  the test that reads it back cannot drift apart. */
const ATTACH = 'tmux -L proofspec attach-session -t alpha'

/** The one debt worth a second screen, with the exact command that pays it. */
const RULING = {
  node: { kind: 'capability', name: 'spec-tree' },
  tasks: ['alpha', 'beta'],
  key: 'capability:spec-tree:alpha,beta',
  answerWith: `proofspec schedule --ruling "<your ruling>" 'capability:spec-tree:alpha,beta'`,
}

const ANSWER = {
  rows: [
    {
      task: 'alpha',
      state: 'building',
      phase: 'test-review',
      round: 2,
      branch: 'work/alpha',
      base: { kind: 'main' },
      stateAgeSeconds: 7541,
      heartbeatAgeSeconds: 90,
      phaseAgeSeconds: 6000,
      session: { listed: true, attach: ATTACH },
    },
    {
      task: 'settled',
      state: 'merged',
      phase: null,
      round: null,
      branch: 'work/settled',
      base: { kind: 'main' },
      stateAgeSeconds: 45,
      heartbeatAgeSeconds: null,
      phaseAgeSeconds: null,
      session: { listed: false },
    },
    {
      task: 'stacked',
      state: 'queued',
      phase: 'plan',
      round: 1,
      branch: 'work/stacked',
      base: { kind: 'task', task: 'other-task', reason: 'stacked on it' },
      stateAgeSeconds: 300,
      heartbeatAgeSeconds: 12,
      phaseAgeSeconds: 250,
      session: { listed: false },
    },
  ],
  problems: [{ task: 'broken', reason: 'task broken has no MANIFEST' }],
  outstanding: [
    RULING,
    {
      node: null,
      tasks: [],
      key: 'odd:shape',
      answerWith: `proofspec schedule --ruling "<your ruling>" 'odd:shape'`,
    },
  ],
}

/** One element the page's script renders into, as the script itself sees it. */
type PageElement = { innerHTML: string; hidden: boolean }

/**
 * Runs the page's own inline script the way a browser runs it, recording its whole reach:
 * every global it touches by name, every property it reads or writes on the document, and
 * every property it reads or writes on any element. Asserting against the page's script —
 * not a reimplementation of it — is what keeps this a proof about the page rather than a
 * claim about a copy of it, and the inventories are what let a test hold a shape ("nothing
 * but these") instead of a list of spellings a mutant could walk around.
 */
/** How one page run feeds its fetch: an answer to render, or a network that always
 *  fails — the refresh's failure branch is shipped code, and its reach belongs in the
 *  inventories as much as the answering path's does. */
type PageMode =
  | { readonly kind: 'answered'; readonly answer: unknown }
  | { readonly kind: 'offline' }

async function renderPageWith(answer: unknown) {
  return await runPage({ kind: 'answered', answer })
}

/** The page run against a fetch that always fails: the catch branch runs, nothing
 *  renders, and whatever that branch reaches for still lands in the inventories. */
async function renderPageOffline() {
  return await runPage({ kind: 'offline' })
}

async function runPage(mode: PageMode) {
  const elements = new Map<string, PageElement>()
  const elementReads = new Set<string>()
  const elementWrites = new Set<string>()
  const element = (id: string): PageElement => {
    const found = elements.get(id)
    if (found !== undefined) return found
    const made: PageElement = { innerHTML: '', hidden: false }
    const guarded = new Proxy(made, {
      get(target, prop) {
        if (typeof prop === 'string') elementReads.add(`${id}.${prop}`)
        return Reflect.get(target, prop)
      },
      set(target, prop, value) {
        if (typeof prop === 'string') elementWrites.add(`${id}.${prop}`)
        return Reflect.set(target, prop, value)
      },
    })
    elements.set(id, guarded)
    return guarded
  }
  const documentReads = new Set<string>()
  const documentWrites = new Set<string>()
  const fetched: string[] = []
  const timers: number[] = []
  const renewals: Array<() => void> = []
  const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  // The page's whole reach, recorded: every global its script touches by name routes through
  // this proxy, then is answered — from the stubs when the harness holds one, from the
  // language's own when it is an intrinsic — so the run proceeds exactly as in a browser
  // while the inventory holds what the page can reach for.
  const touched = new Set<string>()
  const globals: Record<string, unknown> = {
    document: new Proxy({ getElementById: element }, {
      get(target, prop) {
        if (typeof prop === 'string') documentReads.add(prop)
        return Reflect.get(target, prop)
      },
      set(target, prop, value) {
        if (typeof prop === 'string') documentWrites.add(prop)
        return Reflect.set(target, prop, value)
      },
    }),
    fetch: async (url: string) => {
      fetched.push(url)
      if (mode.kind === 'offline') throw new Error('the network is down')
      return { json: async () => mode.answer }
    },
    setInterval: (renew: () => void, every: number) => {
      timers.push(every)
      renewals.push(renew)
    },
  }
  const context = new Proxy(globals, {
    get(target, name) {
      if (typeof name === 'string') touched.add(name)
      return name in target ? Reflect.get(target, name) : Reflect.get(globalThis, name)
    },
  })
  createContext(context)
  runInContext(pageScript(), context)
  // The first refresh is asynchronous; let it land before the assertions read the page.
  await flush()
  // Snapshotted before anything is handed back: the caller's own reads of an element must
  // not land in the script's inventory.
  const scriptElementReads = [...elementReads]
  return { elements, elementReads: scriptElementReads, elementWrites, documentReads, documentWrites, fetched, timers, renewals, touched, flush }
}

/** The page's own script, lifted out of the page unchanged. */
function pageScript(): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(docketPage(ANSWER))
  if (match === null) throw new Error('the docket page holds no inline script')
  return match[1]!
}

/** The markup the page ships with its script lifted out — everything a browser parses as
 *  elements, before and after the script alike. */
function shippedMarkup(): string {
  const page = docketPage(ANSWER)
  const script = /<script>[\s\S]*<\/script>/.exec(page)
  return script === null ? page : page.slice(0, script.index) + page.slice(script.index + script[0].length)
}

/** The content shipped inside the element with the given id — what a browser shows of it
 *  before any script runs. */
function shippedInner(html: string, id: string): string {
  const match = new RegExp(`<[^>]*id="${id}"[^>]*>([\s\S]*?)<\/`, 'i').exec(html)
  if (match === null) throw new Error(`the shipped markup holds no element #${id}`)
  return match[1]!
}

/** The element names a stretch of HTML holds, lowercased as HTML's own case-insensitive
 *  parser reads them. */
function elementNames(html: string): readonly string[] {
  return [...new Set([...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map(match => match[1]!.toLowerCase()))].sort()
}

/** The attribute names that carry values, lowercased. A request door in markup is an
 *  attribute with a value to point somewhere (src, href, srcset, data, ...) or content a
 *  stylesheet can name a target with — and these inventories hold the whole family by
 *  holding every name, not some of them by naming a few. */
function valuedAttributeNames(html: string): readonly string[] {
  return [...new Set([...html.matchAll(/\s([a-zA-Z-]+)\s*=/g)].map(match => match[1]!.toLowerCase()))].sort()
}

/** Content-level targets — the two ways markup content itself names a target without an
 *  attribute carrying it. */
function holdsNoContentTarget(html: string): void {
  expect(html).not.toMatch(/url\(|@import|javascript:/i)
}

// Requirement: The page refreshes itself, and its numbers move only when an answer does
// Scenario: The page asks the server for the docket again on its own, on a short interval
// GIVEN the docket's page
// WHEN its script runs, the way a browser runs it, and the interval it asked for fires
// THEN it asked for /docket at once, asked again the moment the interval fired, and asked on the short interval of its own choosing — the refresh is the page's job, not the reader's
it('asks for the docket again on its own, on a short interval', async () => {
  const { fetched, timers, renewals, flush } = await renderPageWith(ANSWER)

  expect(fetched).toEqual(['/docket'])
  expect(timers).toEqual([PAGE_REFRESH_MILLISECONDS])

  renewals[0]!()
  await flush()

  expect(fetched).toEqual(['/docket', '/docket'])
})

// Requirement: The page refreshes itself, and its numbers move only when an answer does
// Scenario: Every age is shown exactly as the last answer held it, never advanced in the browser
// GIVEN an answer whose TASK has stood in its word for 7541 seconds, last moved 90 seconds ago, and stood in its phase for 6000 seconds, and a second TASK 45 seconds into its word with no heartbeat and no phase
// WHEN the page renders it, and its interval fires holding the same answer
// THEN the row shows each age spelled from the answered numbers — the word's age, the move's age, and the phase's age each on their own — and no number moved when the timer fired: the page touches no global that can read a time
it('shows every age exactly as the last answer held it', async () => {
  const page = await renderPageWith(ANSWER)
  const rows = page.elements.get('rows')?.innerHTML ?? ''

  // Spellings that cannot be substrings of one another, so each age is pinned on its own.
  expect(rows).toContain('2h 5m 41s')
  expect(rows).toContain('1m 30s')
  expect(rows).toContain('45s')
  expect(rows).toContain('no heartbeat')
  expect(rows).toContain('1h 40m 0s')

  page.renewals[0]!()
  await page.flush()
  expect(page.elements.get('rows')?.innerHTML).toBe(rows)

  // No clock of its own is a fact about what the script can reach: arithmetic, the
  // document, the fetch, the timer — nothing in that inventory reads a time.
  expect([...page.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
})

/** The HTML-escaped spelling of a string, as the page's own escaping writes it — the five
 *  characters HTML gives entities to. */
function htmlEscaped(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

// Requirement: The page shows commands and offers no control that runs them
// Scenario: The attach command of a listed session and the ruling command of an outstanding relationship are shown as copyable text
// GIVEN an answer holding a TASK whose session is listed and a ruling still outstanding
// WHEN the page renders it
// THEN the attach command and the ruling command stand on the page as text a person can copy — each one whole, in a single copyable run, exactly as the answer held it
it('shows the attach command and the ruling command as copyable text', async () => {
  const { elements } = await renderPageWith(ANSWER)

  expect(elements.get('rows')?.innerHTML).toContain(`<code>${htmlEscaped(ATTACH)}</code>`)
  expect(elements.get('rulings')?.innerHTML).toContain(`<code>${htmlEscaped(RULING.answerWith)}</code>`)
})

// Requirement: The docket answers on a page
// Scenario: The page shows the TASK's phase word, its round, and how long it has stood there
// GIVEN an answer holding a TASK at phase test-review round 2 for 6000 seconds, and a TASK with no phase file
// WHEN the page renders it
// THEN the first row shows the phase word and its round and the phase age spelled from the answered number, and the second spells the absence as an absence — never a word or a number invented for it
it('shows the phase word, its round, and its age on the row', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rows = elements.get('rows')?.innerHTML ?? ''

  expect(rows).toContain('test-review')
  expect(rows).toContain('round 2')
  expect(rows).toContain('1h 40m 0s')
  expect(rows).toContain('no phase')
})

// Requirement: The docket answers on a page
// Scenario: The page a request answers carries the docket's facts as visible content
// GIVEN a docket answer holding rows, a problem, and an outstanding ruling
// WHEN the page is written with it
// THEN its markup carries every fact as content a browser shows before any script runs — the page is the view asked again, not an empty shell around a script
it('carries the docket\'s facts as visible content in the markup it ships', () => {
  const markup = shippedMarkup()

  expect(markup).toContain(htmlEscaped(ATTACH))
  expect(markup).toContain('test-review')
  expect(markup).toContain('round 2')
  expect(markup).toContain(htmlEscaped('task broken has no MANIFEST'))
  expect(markup).toContain(htmlEscaped(RULING.answerWith))
  // Rows stand, so the empty note is hidden and the problem and ruling sections stand open —
  // the same visibility the script would set, already true in the markup itself.
  expect(markup).toContain('<p id="empty" hidden>')
  expect(markup).toContain('id="problems-heading">')
  expect(markup).toContain('id="rulings-heading">')
})

// Requirement: The docket answers on a page
// Scenario: The rows the page ships and the rows its script renders are the same HTML for the same answer
// GIVEN one docket answer
// WHEN the page is written with it, and its script renders the same answer the way a browser runs it
// THEN the shipped rows, problems, and rulings are byte for byte the HTML the script renders — two renderers, one shape, so the page the server answers and the page the refresh draws cannot drift apart
it('ships the same rows its script renders for the same answer', async () => {
  const markup = shippedMarkup()
  const page = await renderPageWith(ANSWER)

  expect(shippedInner(markup, 'rows')).toBe(page.elements.get('rows')?.innerHTML)
  expect(shippedInner(markup, 'problems')).toBe(page.elements.get('problems')?.innerHTML)
  expect(shippedInner(markup, 'rulings')).toBe(page.elements.get('rulings')?.innerHTML)
})

// Requirement: The page shows commands and offers no control that runs them
// Scenario: No control on the page attaches, rules, holds, or starts anything
// GIVEN the docket's page, and an answer that walks every rendering branch it holds
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it — against an answer, and against a network that fails
// THEN it offers no control that runs anything — no element beyond the ones it was written with, in the markup it ships or the HTML it renders, nor any attribute that carries a value beyond the ones it was written with, nor any stylesheet import or url or javascript: scheme anywhere, and its script touches no global but the document, the one fetch of /docket, the timer that renews it, and the arithmetic it spells ages with — whether the fetch answers or fails — reads nothing off the document but the element lookup, nothing off an element at all, and writes nothing to one but the text and visibility it renders
it('offers no control that runs anything', async () => {
  const page = docketPage(ANSWER)
  const run = await renderPageWith(ANSWER)
  const rendered = [...run.elements.values()].map(element => element.innerHTML).join('')
  const offline = await renderPageOffline()

  // The whole inventory of the markup it ships: every element name and every valued
  // attribute the page was written with, before and after its script alike. A control, a
  // request door, or any element at all, arrives as a name this list would have to carry —
  // the shipped rows, problems, and rulings included, for they are content, not controls.
  expect(elementNames(shippedMarkup())).toEqual(['body', 'br', 'code', 'h1', 'h2', 'head', 'html', 'li', 'meta', 'p', 'span', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'title', 'tr', 'ul'])
  expect(valuedAttributeNames(shippedMarkup())).toEqual(['charset', 'class', 'id', 'lang'])
  // The same inventory of the HTML its script renders for the branch-walking answer —
  // nothing the page can build carries an element or a valued attribute beyond these.
  expect(elementNames(rendered)).toEqual(['br', 'code', 'li', 'span', 'td', 'tr'])
  expect(valuedAttributeNames(rendered)).toEqual(['class'])
  // Content-level targets, in the shipped markup and the rendered HTML alike.
  holdsNoContentTarget(shippedMarkup())
  holdsNoContentTarget(rendered)
  // The one request the page makes here is its first refresh, and it makes it to /docket —
  // the page's requests are its refreshes, nothing else.
  expect(run.fetched).toEqual(['/docket'])
  // The script's whole reach: every global it touches by name, every document property it
  // reads or writes, and every element property it reads or writes. A control wired in
  // script — a handler read off an element, a request by any other means — is a touch this
  // inventory would have to carry, and the claim above with it.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentReads]).toEqual(['getElementById'])
  expect([...run.documentWrites]).toEqual([])
  expect(run.elementReads).toEqual([])
  expect([...run.elementWrites].sort()).toEqual([
    'empty.hidden',
    'problems-heading.hidden',
    'problems.innerHTML',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.innerHTML',
  ])
  // The failed fetch runs the refresh's catch branch — shipped code with a reach of its
  // own. Nothing renders there, and the branch still touches nothing but the fetch and
  // the timer: no retry machinery of its own, no door the answering path keeps closed.
  expect(offline.fetched).toEqual(['/docket'])
  expect([...offline.touched].sort()).toEqual(['fetch', 'setInterval'])
  expect([...offline.documentReads]).toEqual([])
  expect([...offline.documentWrites]).toEqual([])
  expect(offline.elementReads).toEqual([])
  expect([...offline.elementWrites]).toEqual([])
})
