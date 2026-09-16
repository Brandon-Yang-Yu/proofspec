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
      stateAgeSeconds: 90,
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
 * Runs the page's own inline script the way a browser runs it: a document to render into, a
 * `fetch` that answers the fixture, and a timer list that records what the page asked to
 * repeat. Asserting against the page's script — not a reimplementation of it — is what keeps
 * this a proof about the page rather than a claim about a copy of it.
 */
async function renderPageWith(answer: unknown) {
  const elements = new Map<string, PageElement>()
  const element = (id: string): PageElement => {
    const found = elements.get(id)
    if (found !== undefined) return found
    const made: PageElement = { innerHTML: '', hidden: false }
    elements.set(id, made)
    return made
  }
  const fetched: string[] = []
  const timers: number[] = []
  const renewals: Array<() => void> = []
  const flush = async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const context = {
    document: { getElementById: element },
    fetch: async (url: string) => {
      fetched.push(url)
      return { json: async () => answer }
    },
    setInterval: (renew: () => void, every: number) => {
      timers.push(every)
      renewals.push(renew)
    },
  }
  createContext(context)
  runInContext(pageScript(), context)
  // The first refresh is asynchronous; let it land before the assertions read the page.
  await flush()
  return { elements, fetched, timers, renewals, flush }
}

/** The page's own script, lifted out of the page unchanged. */
function pageScript(): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(docketPage())
  if (match === null) throw new Error('the docket page holds no inline script')
  return match[1]!
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
// GIVEN an answer whose TASK has stood in its word for 7541 seconds and last moved 90 seconds ago
// WHEN the page renders it
// THEN the row shows each of the two ages spelled from the answered numbers — the word's age and the move's age each on their own — and the page holds no clock of its own that could advance a number between answers
it('shows every age exactly as the last answer held it', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rows = elements.get('rows')?.innerHTML ?? ''

  // Two spellings that cannot be substrings of one another, so each age is pinned on its own.
  expect(rows).toContain('2h 5m 41s')
  expect(rows).toContain('1m 30s')
  expect(rows).toContain('no heartbeat')
  expect(docketPage()).not.toContain('Date.now')
  expect(docketPage()).not.toContain('new Date')
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
// WHEN it is read as the HTML it is
// THEN it offers no control that runs anything — no control element, no handler attribute whatever event it names, and no request by any door other than its one refresh of /docket
it('offers no control that runs anything', async () => {
  const page = docketPage()

  for (const control of ['<button', '<form', '<input', '<select', '<textarea', '<a ', 'javascript:']) {
    expect(page).not.toContain(control)
  }
  // A handler attribute of any name — a shape, not a list of spellings a mutant could walk around.
  expect(page).not.toMatch(/\son[a-z]+\s*=/i)
  // The other doors a script could put a request through; the one it uses is the fetch below.
  expect(page).not.toMatch(/XMLHttpRequest|EventSource|WebSocket|sendBeacon|addEventListener/)
  expect(page.match(/fetch\(/g)).toEqual(['fetch('])
  expect(page).toContain(`fetch('/docket')`)
})
