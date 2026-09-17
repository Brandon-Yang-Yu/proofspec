// Capability: docket

import { createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { docketPage, PAGE_REFRESH_MILLISECONDS } from '../../src/docket/index.ts'

/** An answer worth a second screen: a working TASK with a session, a problem, and a debt. */
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
  ],
  problems: [{ task: 'broken', reason: 'task broken has no MANIFEST' }],
  outstanding: [
    {
      node: { kind: 'capability', name: 'spec-tree' },
      tasks: ['alpha', 'beta'],
      key: 'capability:spec-tree:alpha,beta',
      answerWith: `proofspec schedule --ruling "<your ruling>" 'capability:spec-tree:alpha,beta'`,
    },
  ],
}

/** One element the page's script renders into, as the script itself sees it. */
type PageElement = { innerHTML: string; hidden: boolean }

/**
 * Runs the page's own inline script the way a browser runs it, recording its whole reach:
 * every global it touches by name, every property it reads or writes on the document, and
 * every property it writes on any element. Asserting against the page's script — not a
 * reimplementation of it — is what keeps this a proof about the page rather than a claim
 * about a copy of it, and the inventories are what let a test hold a shape ("nothing but
 * these") instead of a list of spellings a mutant could walk around.
 */
async function renderPageWith(answer: unknown) {
  const elements = new Map<string, PageElement>()
  const elementWrites = new Set<string>()
  const element = (id: string): PageElement => {
    const found = elements.get(id)
    if (found !== undefined) return found
    const made: PageElement = { innerHTML: '', hidden: false }
    const guarded = new Proxy(made, {
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
  return { elements, elementWrites, documentReads, documentWrites, fetched, timers, renewals, touched, flush }
}

/** The page's own script, lifted out of the page unchanged. */
function pageScript(): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(docketPage())
  if (match === null) throw new Error('the docket page holds no inline script')
  return match[1]!
}

/** The static markup of the page — everything before the script, where an attribute could
 *  point a request. */
function staticMarkup(): string {
  const page = docketPage()
  const upTo = page.indexOf('<script>')
  return upTo === -1 ? page : page.slice(0, upTo)
}

/** The shapes a control or a request door takes, held identically against the static page
 *  and against every run of HTML the page's script renders — HTML's parser is
 *  case-insensitive, so the shapes are too. */
function holdsNoControl(html: string): void {
  // A control element of any name on the list, whatever case it is spelled in.
  expect(html).not.toMatch(/<(button|form|input|select|textarea|a)\b/i)
  // A handler attribute of any name — a shape, not a list of spellings a mutant could walk around.
  expect(html).not.toMatch(/\son[a-z]+\s*=/i)
  // An attribute that names a target, or a stylesheet url(): a request by markup is a door
  // only one of these opens.
  expect(html).not.toMatch(/\s(src|href|action)\s*=|url\(/i)
  expect(html).not.toMatch(/javascript:/i)
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
// GIVEN the docket's page
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it
// THEN it offers no control that runs anything — no control element whatever its case, neither in the markup it ships nor in the HTML it renders, no handler attribute whatever event it names, no request-pointing attribute or stylesheet url anywhere, no element or valued attribute on the static markup beyond the ones it was written with, and its script reaches nowhere but the element lookup, the text and visibility it renders, the one fetch of /docket, the timer that renews it, and the arithmetic it spells ages with
it('offers no control that runs anything', async () => {
  const page = docketPage()
  const run = await renderPageWith(ANSWER)

  holdsNoControl(page)
  for (const element of run.elements.values()) holdsNoControl(element.innerHTML)

  // The static markup's whole inventory of elements and valued attributes: every name the
  // page was written with, and nothing a mutant could add — a control, a request door, or
  // any element at all, arrives as a name this list would have to carry.
  const tags = [...new Set([...staticMarkup().matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)].map(match => match[1]!.toLowerCase()))]
  expect([...tags].sort()).toEqual(['body', 'h1', 'h2', 'head', 'html', 'meta', 'p', 'style', 'table', 'tbody', 'th', 'thead', 'title', 'tr', 'ul'])
  const attributes = [...new Set([...staticMarkup().matchAll(/\s([a-zA-Z-]+)=/g)].map(match => match[1]!))]
  expect([...attributes].sort()).toEqual(['charset', 'id', 'lang'])
  // The one request the page makes here is its first refresh, and it makes it to /docket —
  // the page's requests are its refreshes, nothing else.
  expect(run.fetched).toEqual(['/docket'])
  // The script's whole reach: every global it touches by name, every document property it
  // reads or writes, and every element property it writes. A control wired in script — a
  // handler set on the document or an element, a request by any other means — is a touch
  // this inventory would have to carry, and the claim above with it.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentReads]).toEqual(['getElementById'])
  expect([...run.documentWrites]).toEqual([])
  expect([...run.elementWrites].sort()).toEqual([
    'empty.hidden',
    'problems-heading.hidden',
    'problems.innerHTML',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.innerHTML',
  ])
})
