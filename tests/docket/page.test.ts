// Capability: docket

import { createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { docketPage, PAGE_REFRESH_MILLISECONDS } from '../../src/docket/index.ts'
import type { ArchiveRecord, Docket, OutstandingRuling } from '../../src/docket/index.ts'

/** An answer worth a second screen, walking every rendering branch the page holds: a
 *  working TASK with a session, a merged TASK with no heartbeat, a TASK stacked on another,
 * a problem, a debt with its named node, and one whose key names no node at all — so no
 *  literal the script could emit goes unrendered. */
/** The exact attach command one row carries, named once so the answer that carries it and
 *  the test that reads it back cannot drift apart. */
const ATTACH = 'tmux -L proofspec attach-session -t alpha'

/** The one debt worth a second screen, with the exact command that pays it. */
const RULING: OutstandingRuling = {
  node: { kind: 'capability', name: 'spec-tree' },
  tasks: ['alpha', 'beta'],
  key: 'capability:spec-tree:alpha,beta',
  answerWith: `proofspec schedule --ruling "<your ruling>" 'capability:spec-tree:alpha,beta'`,
}

const ANSWER: Docket = {
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

/** The archive the completed section answers, walking its rendering branches: two finished
 *  TASKs — one built on main, one stacked on another TASK — with milliseconds on the second's
 *  moments, so the page's trim of them is pinned, and lived durations the page's own age()
 *  spelling has to spell. */
const ARCHIVE: readonly ArchiveRecord[] = [
  {
    task: 'first',
    branch: 'work/first',
    base: { kind: 'main' },
    enqueuedAt: '2025-01-01T09:00:00.000Z',
    settledAt: '2025-01-01T10:30:00.000Z',
    livedSeconds: 90 * 60,
  },
  {
    task: 'second',
    branch: 'work/second',
    base: { kind: 'task', task: 'first', reason: 'stacked on it' },
    enqueuedAt: '2025-01-01T09:30:00.123Z',
    settledAt: '2025-01-01T10:45:00.123Z',
    livedSeconds: 75 * 60,
  },
]

/** The answer /archive carries for `ARCHIVE` — the shape the page's script reads. */
const ARCHIVE_ANSWER = { records: ARCHIVE }

/** One element the page's script renders into, as the script itself sees it. */
type PageElement = { innerHTML: string; hidden: boolean; parentNode: PageElement | null }

/**
 * Runs the page's own inline script the way a browser runs it, recording its whole reach:
 * every global it touches by name, every property it reads or writes on the document, and
 * every property it reads or writes on any element. Asserting against the page's script —
 * not a reimplementation of it — is what keeps this a proof about the page rather than a
 * claim about a copy of it, and the inventories are what let a test hold a shape ("nothing
 * but these") instead of a list of spellings a mutant could walk around.
 */
/** How one page run feeds its fetches: the two answers to render, or a network that always
 *  fails — the refresh's failure branch is shipped code, and its reach belongs in the
 *  inventories as much as the answering path's does. */
type PageMode =
  | { readonly kind: 'answered'; readonly docket: unknown; readonly archive: unknown }
  | { readonly kind: 'offline' }

async function renderPageWith(docket: unknown, archive: unknown = ARCHIVE_ANSWER) {
  return await runPage({ kind: 'answered', docket, archive })
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
  // The page's elements as the browser nests them: everything the script can hold a
  // selection inside hangs off the body, so the selection guard's walk up the tree arrives.
  const bodyElement: PageElement = { innerHTML: '', hidden: false, parentNode: null }
  const element = (id: string): PageElement => {
    const found = elements.get(id)
    if (found !== undefined) return found
    const made: PageElement = { innerHTML: '', hidden: false, parentNode: bodyElement }
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
  // The selection the page's guard asks about: collapsed (no copy in progress) until a test
  // opens one, the browser's own ordinary state on load.
  let selection: { isCollapsed: boolean; anchorNode: unknown } = { isCollapsed: true, anchorNode: null }
  // The answer the next fetch returns — held in a box so a test can move the queue between
  // refreshes, the way a real queue moves under a page left open.
  let current = mode
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
    document: new Proxy({ getElementById: element, getSelection: () => selection, body: bodyElement }, {
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
      const modeNow = current
      if (modeNow.kind === 'offline') throw new Error('the network is down')
      // Each path answers its own read — the docket's rows never arrive at /archive's door.
      return { json: async () => (url === '/archive' ? modeNow.archive : modeNow.docket) }
    },    setInterval: (renew: () => void, every: number) => {
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
  return {
    elements,
    elementReads: scriptElementReads,
    elementWrites,
    documentReads,
    documentWrites,
    fetched,
    timers,
    renewals,
    touched,
    flush,
    selectWithin(id: string): void {
      selection = { isCollapsed: false, anchorNode: elements.get(id) }
    },
    clearSelection(): void {
      selection = { isCollapsed: true, anchorNode: null }
    },
    setAnswer(answer: unknown): void {
      current = { kind: 'answered', docket: answer, archive: ARCHIVE_ANSWER }
    },
  }
}

/** The page's own script, lifted out of the page unchanged. */
function pageScript(): string {
  const match = /<script>([\s\S]*)<\/script>/.exec(docketPage(ANSWER, ARCHIVE))
  if (match === null) throw new Error('the docket page holds no inline script')
  return match[1]!
}

/** The markup the page ships with its script lifted out — everything a browser parses as
 *  elements, before and after the script alike. */
function shippedMarkup(report: Docket = ANSWER, archive: readonly ArchiveRecord[] = ARCHIVE): string {
  const page = docketPage(report, archive)
  const script = /<script>[\s\S]*<\/script>/.exec(page)
  return script === null ? page : page.slice(0, script.index) + page.slice(script.index + script[0].length)
}

/** The content shipped inside the element with the given id, up to that element's own
 *  closing tag — what a browser shows of it before any script runs. The element's own tag
 *  names the closer because the content itself holds no element of the same kind: rows live
 *  in the one tbody, problems and rulings in their own ul. */
function shippedInner(html: string, id: string, tag: string): string {
  const match = new RegExp(`<${tag} id="${id}">([\\s\\S]*?)</${tag}>`).exec(html)
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
// THEN it asked for /docket and /archive at once, asked for both again the moment the interval fired, and asked on the short interval of its own choosing — the refresh is the page's job, not the reader's
it('asks for the docket again on its own, on a short interval', async () => {
  const { fetched, timers, renewals, flush } = await renderPageWith(ANSWER)

  expect(fetched).toEqual(['/docket', '/archive'])
  expect(timers).toEqual([PAGE_REFRESH_MILLISECONDS])

  renewals[0]!()
  await flush()

  expect(fetched).toEqual(['/docket', '/archive', '/docket', '/archive'])
})

// Requirement: The page refreshes itself, and its numbers move only when an answer does
// Scenario: Every age is shown exactly as the last answer held it, never advanced in the browser
// GIVEN an answer whose TASK has stood in its phase for 6000 seconds and last moved 90 seconds ago, a TASK 250 seconds into its phase that last moved 12 seconds ago, and a TASK with neither a heartbeat nor a phase
// WHEN the page renders it, and its interval fires holding the same answer
// THEN the rows show the two ages the page carries — the phase age and the heartbeat age, each spelled from its own answered number — and spell the missing heartbeat and the missing phase as absences, and no number moved when the timer fired: the page touches no global that can read a time
it('shows every age exactly as the last answer held it', async () => {
  const page = await renderPageWith(ANSWER)
  const rows = page.elements.get('rows')?.innerHTML ?? ''

  // Spellings that cannot be substrings of one another, so each age is pinned on its own.
  expect(rows).toContain('1h 40m 0s')
  expect(rows).toContain('1m 30s')
  expect(rows).toContain('4m 10s')
  expect(rows).toContain('12s')
  expect(rows).toContain('no heartbeat')
  // The missing phase age is spelled as its own absence — the dash — never as a repeat of
  // another number the row carries: the settled row's state age standing in would pass
  // every other assertion here.
  expect(rows).toContain('—')

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
// GIVEN an answer holding a TASK at phase test-review round 2 for 6000 seconds, a TASK at phase plan round 1, and a TASK with no phase file
// WHEN the page renders it
// THEN every phased row shows the phase word with its round beside it — round 1 as much as round 2 — and the phase age spelled from the answered number; the TASK with no phase file spells the absence as an absence, the same way a missing heartbeat is spelled, never the state word or a number standing in for it; and the state word and its age appear nowhere in the rows — the page carries the phase word where the state word stood
it('shows the phase word, its round, and its age on the row', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rows = elements.get('rows')?.innerHTML ?? ''

  // The phase word stands where the state word stood — the cell right after the TASK's —
  // with its round on it, and each phased row's age from its own answered number: the
  // round-1 row's age as much as the round-2 row's.
  expect(rows).toContain('<td>alpha</td><td>test-review round 2</td>')
  expect(rows).toContain('<td>stacked</td><td>plan round 1</td>')
  expect(rows).toContain('<td>1h 40m 0s</td><td>1m 30s</td>')
  expect(rows).toContain('<td>4m 10s</td><td>12s</td>')
  // The no-phase TASK's absences are spelled as absences — the word's own absence and
  // the phase age's dash, the word-spelled way a missing heartbeat is — never the state
  // word or a number standing in: a renderer standing the row's state age into the open
  // cell passes every expectation above.
  expect(rows).toContain('no phase')
  expect(rows).toContain('no heartbeat')
  expect(rows).toContain('—')

  // The state word and its age are the JSON's facts, not the page's: every state word the
  // fixture carries and every one of its three state-age spellings is asserted absent —
  // each row's own age included, so no age can stand in anywhere another cell leaves open.
  // The same-bytes test equates this half with the shipped one, so one assertion pins both
  // renderers.
  expect(rows).not.toContain('building')
  expect(rows).not.toContain('merged')
  expect(rows).not.toContain('queued')
  expect(rows).not.toContain('2h 5m 41s')
  expect(rows).not.toContain('45s')
  expect(rows).not.toContain('5m 0s')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The page renders the archive's records as a completed section beside its live rows
// GIVEN an archive answer holding two completed TASKs, the earlier start first, and a live row standing on the queue
// WHEN the page renders it
// THEN the completed section stands beside the live rows — each record's TASK, branch, and base shown, the moments spelled without milliseconds, and how long each TASK lived as its own column in the page's own age spelling — with the records in start order, earliest first
it('renders the archive records as a completed section beside its live rows', async () => {
  const page = await renderPageWith(ANSWER)
  const rows = page.elements.get('rows')?.innerHTML ?? ''
  const archived = page.elements.get('archive-rows')?.innerHTML ?? ''

  expect(rows).toContain('<td>alpha</td>')
  expect(archived).toContain('<td>first</td><td>work/first <span class="muted">from main</span></td>')
  expect(archived).toContain('<td>work/second <span class="muted">from first</span></td>')
  // The lived column, in the page's own age spelling — ninety minutes and seventy-five.
  expect(archived).toContain('<td>1h 30m 0s</td>')
  expect(archived).toContain('<td>1h 15m 0s</td>')
  // Start order: the earlier start stands above the later, whatever the names say.
  expect(archived.indexOf('<td>first</td>')).toBeLessThan(archived.indexOf('<td>second</td>'))
  // The moments as the page spells them — milliseconds trimmed, a precision the JSON keeps and the page does not.
  expect(archived).toContain('<td>2025-01-01T09:30:00Z</td>')
  expect(archived).not.toContain('.123Z')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: An empty archive is shown as an absence
// GIVEN an archive holding no completed TASK
// WHEN the page is written with it, and its script renders the same answer the way a browser runs it
// THEN the completed section stands open with its absence spelled plainly — never a section silently missing — and the rows the script renders are the same none the page shipped
it('shows an empty archive as a visible absence', async () => {
  const markup = shippedMarkup(ANSWER, [])
  const page = await renderPageWith(ANSWER, { records: [] })

  expect(markup).toContain('<h2>completed</h2>')
  expect(markup).toContain('<p id="archive-empty">no completed TASK yet</p>')
  expect(page.elements.get('archive-empty')?.hidden).toBe(false)
  expect(shippedInner(markup, 'archive-rows', 'tbody')).toBe(page.elements.get('archive-rows')?.innerHTML)
  expect(page.elements.get('archive-rows')?.innerHTML).toBe('')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The completed rows the page ships and the rows its script renders are the same HTML for the same answer
// GIVEN one archive answer
// WHEN the page is written with it, and its script renders the same answer the way a browser runs it
// THEN the shipped completed rows are byte for byte the HTML the script renders — the two renderers cannot drift apart here any more than the live rows can
it('ships the same completed rows its script renders for the same answer', async () => {
  const markup = shippedMarkup()
  const page = await renderPageWith(ANSWER)

  expect(shippedInner(markup, 'archive-rows', 'tbody')).toBe(page.elements.get('archive-rows')?.innerHTML)
})

// Requirement: The docket answers on a page
// Scenario: The page a request answers carries the docket's facts as visible content
// GIVEN a docket answer holding rows, completed records, a problem, and an outstanding ruling
// WHEN the page is written with it
// THEN its markup carries every fact as content a browser shows before any script runs — the page is the view asked again, not an empty shell around a script
it('carries the docket\'s facts as visible content in the markup it ships', () => {
  const markup = shippedMarkup()

  expect(markup).toContain(htmlEscaped(ATTACH))
  expect(markup).toContain('test-review')
  expect(markup).toContain('round 2')
  expect(markup).toContain(htmlEscaped('task broken has no MANIFEST'))
  expect(markup).toContain(htmlEscaped(RULING.answerWith))
  // The completed section ships as content too — the records, their order, and the lived
  // column — with the empty note hidden because records stand.
  expect(markup).toContain('<td>first</td>')
  expect(markup).toContain('<td>1h 30m 0s</td>')
  expect(markup).toContain('<p id="archive-empty" hidden>')
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

  expect(shippedInner(markup, 'rows', 'tbody')).toBe(page.elements.get('rows')?.innerHTML)
  expect(shippedInner(markup, 'problems', 'ul')).toBe(page.elements.get('problems')?.innerHTML)
  expect(shippedInner(markup, 'rulings', 'ul')).toBe(page.elements.get('rulings')?.innerHTML)
})

// Requirement: The docket answers on a page
// Scenario: The page ships the same shape for an empty docket, its absences spelled as absences
// GIVEN a docket answer holding no row, no problem, and no outstanding ruling, and an archive holding no completed TASK
// WHEN the page is written with them, and its script renders the same answers the way a browser runs it
// THEN the empty notes stand open — the queue's and the completed section's alike — the problem and ruling sections stand hidden, and the rows the script renders are the same none the page shipped
// The empty branch is the one the branch-walking answer never reaches; an inverted visibility
// in either renderer would ship silently without a fixture that walks it.
it('ships an empty docket with its absences spelled as absences', async () => {
  const empty: Docket = { rows: [], problems: [], outstanding: [] }
  const markup = shippedMarkup(empty, [])
  const page = await renderPageWith(empty, { records: [] })

  expect(markup).toContain('<p id="empty">')
  expect(markup).toContain('<p id="archive-empty">')
  expect(markup).toContain('<h2 id="problems-heading" hidden>')
  expect(markup).toContain('<h2 id="rulings-heading" hidden>')
  expect(shippedInner(markup, 'rows', 'tbody')).toBe(page.elements.get('rows')?.innerHTML)
  expect(page.elements.get('rows')?.innerHTML).toBe('')
})

/** Each table the page ships, read as its own header-and-body pair — the live rows and the
 *  completed records are two tables, and a header must answer for its own rows alone. */
function tablesOf(html: string): { readonly bodyId: string; readonly headerCells: number; readonly firstRow: string }[] {
  const pattern = /<thead>[\s\S]*?<\/thead>\s*<tbody id="([^"]+)">([\s\S]*?)<\/tbody>/g
  return [...html.matchAll(pattern)].map(match => ({
    bodyId: match[1]!,
    headerCells: (match[0].match(/<th scope="col">/g) ?? []).length,
    firstRow: /<tr>[\s\S]*?<\/tr>/.exec(match[2]!)?.[0] ?? '',
  }))
}

// Requirement: The docket answers on a page
// Scenario: Every column the header names is a cell every row carries
// GIVEN the page shipped over a branch-walking answer, holding both of its tables
// WHEN each table's header is read against the first row it shipped
// THEN each row carries exactly one cell per its own header's columns — the headers and the two renderers cannot drift apart end to end, in either table
it('carries one cell per column each table\'s header names', () => {
  const tables = tablesOf(shippedMarkup())

  expect(tables.map(table => table.bodyId)).toEqual(['rows', 'archive-rows'])
  for (const table of tables) {
    expect(table.headerCells).toBeGreaterThan(0)
    expect((table.firstRow.match(/<td>/g) ?? []).length).toBe(table.headerCells)
  }
})

// Requirement: The page shows commands and offers no control that runs them
// Scenario: A live text selection inside the rows holds the refresh's swap, so a copy in progress survives
// GIVEN a page rendered over one answer, and a non-collapsed text selection inside its rows — a copy of the attach command in progress
// WHEN the refresh lands a different answer — the TASKs' branches changed — and then another lands with no selection live
// THEN the rows stand as the copied answer held them through the first refresh, and the second swaps them — the page's own refresh never defeats the page's copy affordance
it('holds the rows while a selection lives inside them', async () => {
  const page = await renderPageWith(ANSWER)
  const copied = page.elements.get('rows')?.innerHTML
  page.selectWithin('rows')
  page.setAnswer({ ...ANSWER, rows: ANSWER.rows.map(row => ({ ...row, branch: 'work/renamed' })) })

  page.renewals[0]!()
  await page.flush()
  expect(page.elements.get('rows')?.innerHTML).toBe(copied)

  page.clearSelection()
  page.renewals[0]!()
  await page.flush()
  expect(page.elements.get('rows')?.innerHTML).toContain('work/renamed')
})

// Requirement: The page shows commands and offers no control that runs anything
// Scenario: No control on the page attaches, rules, holds, or starts anything
// GIVEN the docket's page, and answers that walk every rendering branch it holds
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it — against answers, and against a network that fails
// THEN it offers no control that runs anything — no element beyond the ones it was written with, in the markup it ships or the HTML it renders, nor any attribute that carries a value beyond the ones it was written with, nor any stylesheet import or url or javascript: scheme anywhere, and its script touches no global but the document, the fetches of /docket and /archive, the timer that renews them, and the arithmetic it spells ages with — whether the fetches answer or fail — reads nothing off the document but the element lookup, nothing off an element at all, and writes nothing to one but the text and visibility it renders
it('offers no control that runs anything', async () => {
  const page = docketPage(ANSWER, ARCHIVE)
  const run = await renderPageWith(ANSWER)
  const rendered = [...run.elements.values()].map(element => element.innerHTML).join('')
  const offline = await renderPageOffline()

  // The whole inventory of the markup it ships: every element name and every valued
  // attribute the page was written with, before and after its script alike. A control, a
  // request door, or any element at all, arrives as a name this list would have to carry —
  // the shipped rows, completed records, problems, and rulings included, for they are
  // content, not controls.
  expect(elementNames(shippedMarkup())).toEqual(['body', 'br', 'code', 'h1', 'h2', 'head', 'html', 'li', 'meta', 'p', 'span', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'title', 'tr', 'ul'])
  expect(valuedAttributeNames(shippedMarkup())).toEqual(['charset', 'class', 'id', 'lang', 'scope'])
  // The same inventory of the HTML its script renders for the branch-walking answer —
  // nothing the page can build carries an element or a valued attribute beyond these.
  expect(elementNames(rendered)).toEqual(['br', 'code', 'li', 'span', 'td', 'tr'])
  expect(valuedAttributeNames(rendered)).toEqual(['class'])
  // Content-level targets, in the shipped markup and the rendered HTML alike.
  holdsNoContentTarget(shippedMarkup())
  holdsNoContentTarget(rendered)
  // The page's first round of requests is its two refreshes, to /docket and /archive —
  // the page's requests are its refreshes, nothing else.
  expect(run.fetched).toEqual(['/docket', '/archive'])
  // The script's whole reach: every global it touches by name, every document property it
  // reads or writes, and every element property it reads or writes. A control wired in
  // script — a handler read off an element, a request by any other means — is a touch this
  // inventory would have to carry, and the claim above with it.
  // 'body' joins this inventory only while a selection is live — the guard's walk up the
  // tree reads it, the collapsed check before it does not.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentReads].sort()).toEqual(['getElementById', 'getSelection'])
  expect([...run.documentWrites]).toEqual([])
  expect(run.elementReads).toEqual([])
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'empty.hidden',
    'problems-heading.hidden',
    'problems.innerHTML',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.innerHTML',
  ])
  // The failed fetches run the refresh's catch branches — shipped code with a reach of
  // their own. Nothing renders there, and the branches still touch nothing but the fetches
  // and the timer: no retry machinery of their own, no door the answering paths keep closed.
  expect(offline.fetched).toEqual(['/docket', '/archive'])
  expect([...offline.touched].sort()).toEqual(['fetch', 'setInterval'])
  expect([...offline.documentReads]).toEqual([])
  expect([...offline.documentWrites]).toEqual([])
  expect(offline.elementReads).toEqual([])
  expect([...offline.elementWrites]).toEqual([])
})
