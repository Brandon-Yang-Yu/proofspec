// Capability: docket

import { createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { docketPage, PAGE_REFRESH_MILLISECONDS } from '../../src/docket/index.ts'

/** An answer worth a second screen, walking every rendering branch the page holds: a
 *  working TASK with a session, a merged TASK with no heartbeat, a TASK stacked on another,
 * a problem, a debt with its named node, and one whose key names no node at all — so no
 *  literal the script could emit goes unrendered. */
const ANSWER = {
  rows: [
    {
      task: 'alpha',
      state: 'building',
      branch: 'work/alpha',
      base: { kind: 'main' },
      stateAgeSeconds: 7541,
      heartbeatAgeSeconds: 90,
      session: { listed: true, attach: 'tmux -L proofspec attach-session -t alpha' },
    },
    {
      task: 'settled',
      state: 'merged',
      branch: 'work/settled',
      base: { kind: 'main' },
      stateAgeSeconds: 45,
      heartbeatAgeSeconds: null,
      session: { listed: false },
    },
    {
      task: 'stacked',
      state: 'queued',
      branch: 'work/stacked',
      base: { kind: 'task', task: 'other-task', reason: 'stacked on it' },
      stateAgeSeconds: 300,
      heartbeatAgeSeconds: 12,
      session: { listed: false },
    },
  ],
  problems: [{ task: 'broken', reason: 'task broken has no MANIFEST' }],
  outstanding: [
    {
      node: { kind: 'capability', name: 'spec-tree' },
      tasks: ['alpha', 'beta'],
      key: 'capability:spec-tree:alpha,beta',
      answerWith: `proofspec schedule --ruling "<your ruling>" 'capability:spec-tree:alpha,beta'`,
    },
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
async function renderPageWith(answer: unknown) {
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
      return { json: async () => answer }
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
  const match = /<script>([\s\S]*)<\/script>/.exec(docketPage())
  if (match === null) throw new Error('the docket page holds no inline script')
  return match[1]!
}

/** The markup the page ships with its script lifted out — everything a browser parses as
 *  elements, before and after the script alike. */
function shippedMarkup(): string {
  const page = docketPage()
  const script = /<script>[\s\S]*<\/script>/.exec(page)
  return script === null ? page : page.slice(0, script.index) + page.slice(script.index + script[0].length)
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
// GIVEN an answer whose TASK has stood in its word for 7541 seconds and last moved 90 seconds ago, and a second TASK 45 seconds into its word with no heartbeat
// WHEN the page renders it, and its interval fires holding the same answer
// THEN the row shows each age spelled from the answered numbers — the word's age and the move's age each on their own — and no number moved when the timer fired: the page touches no global that can read a time
it('shows every age exactly as the last answer held it', async () => {
  const page = await renderPageWith(ANSWER)
  const rows = page.elements.get('rows')?.innerHTML ?? ''

  // Spellings that cannot be substrings of one another, so each age is pinned on its own.
  expect(rows).toContain('2h 5m 41s')
  expect(rows).toContain('1m 30s')
  expect(rows).toContain('45s')
  expect(rows).toContain('no heartbeat')

  page.renewals[0]!()
  await page.flush()
  expect(page.elements.get('rows')?.innerHTML).toBe(rows)

  // No clock of its own is a fact about what the script can reach: arithmetic, the
  // document, the fetch, the timer — nothing in that inventory reads a time.
  expect([...page.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
})

// Requirement: The page shows commands and offers no control that runs them
// Scenario: The attach command of a listed session and the ruling command of an outstanding relationship are shown as copyable text
// GIVEN an answer holding a TASK whose session is listed and a ruling still outstanding
// WHEN the page renders it
// THEN the attach command and the ruling command stand on the page as text a person can copy
it('shows the attach command and the ruling command as copyable text', async () => {
  const { elements } = await renderPageWith(ANSWER)

  expect(elements.get('rows')?.innerHTML).toContain('<code>tmux -L proofspec attach-session -t alpha</code>')
  const rulings = elements.get('rulings')?.innerHTML ?? ''
  expect(rulings).toContain('proofspec schedule --ruling')
  // The key rides along escaped — the page is HTML, and the browser reads the command back
  // exactly as the answer held it once the entities are decoded.
  expect(rulings).toContain('&#39;capability:spec-tree:alpha,beta&#39;')
  expect(rulings).toContain('<code>')
})

// Requirement: The page shows commands and offers no control that runs them
// Scenario: No control on the page attaches, rules, holds, or starts anything
// GIVEN the docket's page, and an answer that walks every rendering branch it holds
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it
// THEN it offers no control that runs anything — no element beyond the ones it was written with, in the markup it ships or the HTML it renders, nor any attribute that carries a value beyond the ones it was written with, nor any stylesheet import or url or javascript: scheme anywhere, and its script touches no global but the document, the one fetch of /docket, the timer that renews it, and the arithmetic it spells ages with, reads nothing off the document but the element lookup, nothing off an element at all, and writes nothing to one but the text and visibility it renders
it('offers no control that runs anything', async () => {
  const page = docketPage()
  const run = await renderPageWith(ANSWER)
  const rendered = [...run.elements.values()].map(element => element.innerHTML).join('')

  // The whole inventory of the markup it ships: every element name and every valued
  // attribute the page was written with, before and after its script alike. A control, a
  // request door, or any element at all, arrives as a name this list would have to carry.
  expect(elementNames(shippedMarkup())).toEqual(['body', 'h1', 'h2', 'head', 'html', 'meta', 'p', 'style', 'table', 'tbody', 'th', 'thead', 'title', 'tr', 'ul'])
  expect(valuedAttributeNames(shippedMarkup())).toEqual(['charset', 'id', 'lang'])
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
})
