// Capability: docket

import { createContext, runInContext } from 'node:vm'
import { expect, it } from 'vitest'
import { docketPage, PAGE_REFRESH_MILLISECONDS } from '../../src/docket/index.ts'
import type {
  ArchiveRecord,
  Docket,
  DocketRow,
  OutstandingRuling,
  PhaseAccountEntry,
  PhaseHistoryEntry,
} from '../../src/docket/index.ts'

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

/** The moment the fixtures' numbers were read at — every `since` a history records and every
 *  age a row shows is measured from one spelled now, so the account a fixture carries and
 *  the ages beside it cannot drift apart. */
const READ_AT = Date.UTC(2025, 0, 1, 12, 0, 0)

/** One hour in the milliseconds the history's `since` moments are spelled in. */
const HOUR = 3_600_000

/** An answer worth a second screen, walking every rendering branch the page holds: a
 *  working TASK with a session, a held TASK waiting on one still working, a TASK released
 *  from a merged blocker, a merged TASK a released entry still names, a merged TASK no
 *  entry names, a TASK whose `blocked` names a TASK not on the queue, a problem, a debt
 *  with its named node, and one whose key names no node at all — so no literal the script
 *  could emit goes unrendered. Its rows also walk the phase account's every branch: alpha
 *  carries a returning word (implement stood, left, and stood again) with a loop past
 *  round 1 and a live standing word, stacked carries a single-word account at round 1,
 *  and settled carries no history at all — so the account column's presence and its
 *  absence are both content the parity assertions compare, not one of them alone. */
const ANSWER: Docket = {
  rows: [
    {
      task: 'alpha',
      state: 'building',
      phase: 'test-review',
      round: 2,
      branch: 'work/alpha',
      blocked: undefined,
      stateAgeSeconds: 7541,
      heartbeatAgeSeconds: 90,
      phaseAgeSeconds: 6000,
      // The account that history holds at READ_AT: implement's two runs (eight hours to
      // three ago, two hours to the 6000-second mark) sum to 5h 20m under the one word and
      // reached round 3; test-review's two runs sum to 2h 40m, reached round 2, and are the
      // standing word — live.
      phaseHistory: [
        { phase: 'implement', round: 1, since: READ_AT - 8 * HOUR },
        { phase: 'test-review', round: 1, since: READ_AT - 3 * HOUR },
        { phase: 'implement', round: 3, since: READ_AT - 2 * HOUR },
        { phase: 'test-review', round: 2, since: READ_AT - 6_000_000 },
      ],
      phaseAccount: [
        { word: 'implement', totalSeconds: 5 * 3600 + 20 * 60, roundsReached: 3, live: false },
        { word: 'test-review', totalSeconds: 2 * 3600 + 40 * 60, roundsReached: 2, live: true },
      ],
      session: { listed: true, attach: ATTACH },
    },
    {
      // A merged entry a pass has not pruned: its own muted row, its name beside the
      // landed badge, carrying every fact a row carries.
      task: 'base-task',
      state: 'merged',
      phase: 'scout',
      round: 1,
      branch: 'work/base-task',
      blocked: undefined,
      stateAgeSeconds: 90_000,
      heartbeatAgeSeconds: null,
      phaseAgeSeconds: 20_000,
      phaseHistory: [{ phase: 'scout', round: 1, since: READ_AT - 20_000_000 }],
      phaseAccount: [{ word: 'scout', totalSeconds: 20_000, roundsReached: 1, live: true }],
      session: { listed: false },
    },
    {
      // The held group's blocker: still working, so the TASK waiting on it is held.
      task: 'early',
      state: 'building',
      phase: null,
      round: null,
      branch: 'work/early',
      blocked: undefined,
      stateAgeSeconds: 4321,
      heartbeatAgeSeconds: null,
      phaseAgeSeconds: null,
      phaseHistory: null,
      phaseAccount: null,
      session: { listed: false },
    },
    {
      // Released from a merged blocker: not held, so its mark keeps the muted spelling of
      // a recorded fact rather than the waiting look.
      task: 'frontier',
      state: 'building',
      phase: 'build-green',
      round: 1,
      branch: 'work/frontier',
      blocked: { task: 'base-task', reason: 'built on it' },
      stateAgeSeconds: 8000,
      heartbeatAgeSeconds: 30,
      phaseAgeSeconds: 500,
      phaseHistory: [{ phase: 'build-green', round: 1, since: READ_AT - 500_000 }],
      phaseAccount: [{ word: 'build-green', totalSeconds: 500, roundsReached: 1, live: true }],
      session: { listed: false },
    },
    {
      // The held row itself: waiting on a TASK still working, its mark reading as a
      // waiting state, standing below the Held subheading.
      task: 'late',
      state: 'queued',
      phase: null,
      round: null,
      branch: 'work/late',
      blocked: { task: 'early', reason: 'built on it' },
      stateAgeSeconds: 999,
      heartbeatAgeSeconds: 5,
      phaseAgeSeconds: null,
      phaseHistory: null,
      phaseAccount: null,
      session: { listed: false },
    },
    {
      task: 'settled',
      state: 'merged',
      phase: null,
      round: null,
      branch: 'work/settled',
      blocked: undefined,
      stateAgeSeconds: 45,
      heartbeatAgeSeconds: null,
      phaseAgeSeconds: null,
      phaseHistory: null,
      phaseAccount: null,
      session: { listed: false },
    },
    {
      task: 'stacked',
      state: 'queued',
      phase: 'plan',
      round: 1,
      branch: 'work/stacked',
      blocked: { task: 'other-task', reason: 'stacked on it' },
      stateAgeSeconds: 300,
      heartbeatAgeSeconds: 12,
      phaseAgeSeconds: 250,
      phaseHistory: [{ phase: 'plan', round: 1, since: READ_AT - 250_000 }],
      phaseAccount: [{ word: 'plan', totalSeconds: 250, roundsReached: 1, live: true }],
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

/** One row for a local fixture, spelled with only what its scenario leans on: everything
 *  unlisted is an honest absence — no phase, no heartbeat, no session, no history — on a
 *  plain building TASK blocked by nothing, so a blocked-row scenario's rows read as the
 *  names, states, and links they are about. */
function fixtureRow(task: string, overrides: Partial<Omit<DocketRow, 'task'>> = {}): DocketRow {
  return {
    task,
    state: 'building',
    phase: null,
    round: null,
    branch: `work/${task}`,
    blocked: undefined,
    stateAgeSeconds: 0,
    heartbeatAgeSeconds: null,
    phaseAgeSeconds: null,
    phaseHistory: null,
    phaseAccount: null,
    session: { listed: false },
    ...overrides,
  }
}

/** The archive the completed section answers, walking its rendering branches: two finished
 *  TASKs held latest start first, the order the archive's answer arrives in — one blocked
 *  by another TASK, one blocked by nothing — with milliseconds on the later-started one's
 *  moments, so the page's trim of them is pinned, and lived durations the page's own age()
 *  spelling has to spell. */
const ARCHIVE: readonly ArchiveRecord[] = [
  {
    // The later start — the TASK enqueued most recently stands first in the section.
    task: 'second',
    branch: 'work/second',
    blocked: { task: 'first', reason: 'stacked on it' },
    enqueuedAt: '2025-01-01T09:30:00.123Z',
    settledAt: '2025-01-01T10:45:00.123Z',
    livedSeconds: 75 * 60,
    phaseHistory: null,
    phaseAccount: null,
  },
  {
    task: 'first',
    branch: 'work/first',
    blocked: undefined,
    enqueuedAt: '2025-01-01T09:00:00.000Z',
    settledAt: '2025-01-01T10:30:00.000Z',
    livedSeconds: 90 * 60,
    // The account that archived history holds: implement stood the first hour, returned for
    // the last quarter hour (its two runs summed to 1h 15m, its loop reaching round 2), and
    // test-review stood the quarter hour between — every phase closed, the last entry's run
    // ending at the settled moment 10:30.
    phaseHistory: [
      { phase: 'implement', round: 1, since: Date.UTC(2025, 0, 1, 9, 0, 0) },
      { phase: 'test-review', round: 1, since: Date.UTC(2025, 0, 1, 10, 0, 0) },
      { phase: 'implement', round: 2, since: Date.UTC(2025, 0, 1, 10, 15, 0) },
    ],
    phaseAccount: [
      { word: 'implement', totalSeconds: 75 * 60, roundsReached: 2, live: false },
      { word: 'test-review', totalSeconds: 15 * 60, roundsReached: 1, live: false },
    ],
  },
]

/** The answer /archive carries for `ARCHIVE` — the shape the page's script reads. */
const ARCHIVE_ANSWER = { records: ARCHIVE }

/** One element the page's script renders into, as the script itself sees it. */
type PageElement = {
  innerHTML: string
  hidden: boolean
  parentNode: PageElement | null
}

/**
 * Runs the page's own inline script the way a browser runs it, recording its whole reach:
 * every global it touches by name, every property it reads or writes on the document,
 * every property it reads or writes on any element, and every method it invokes on one.
 * Asserting against the page's script — not a reimplementation of it — is what keeps this
 * a proof about the page rather than a claim about a copy of it, and the inventories are
 * what let a test hold a shape ("nothing but these") instead of a list of spellings a
 * mutant could walk around.
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
  // The objects behind the proxies: the harness's own acts reach these directly, so what
  // the browser does on a person's own hand — a keyboard's Tab, a click — leaves no trace
  // in the records that hold the script's reach.
  const rawElements = new Map<string, PageElement>()
  const elements = new Map<string, PageElement>()
  const elementReads = new Set<string>()
  const elementWrites = new Set<string>()
  // The method invocations the script asks of an element, kept as a list rather than a set
  // because the count is part of the fact. The harness fabricates no element methods, so
  // any invocation the script attempts throws the way it would against a bare object —
  // the list stays the honest record of a script that invokes nothing.
  const elementActs: string[] = []
  // The page's elements as the browser nests them: everything the script can hold a
  // selection inside hangs off the body, so the selection guard's walk up the tree arrives.
  const bodyElement: PageElement = { innerHTML: '', hidden: false, parentNode: null }
  const guard = <T extends PageElement>(key: string, made: T): T => new Proxy(made, {
    get(target, prop) {
      if (typeof prop === 'string') elementReads.add(`${key}.${prop}`)
      return Reflect.get(target, prop)
    },
    set(target, prop, value) {
      if (typeof prop === 'string') elementWrites.add(`${key}.${prop}`)
      return Reflect.set(target, prop, value)
    },
  })
  const fabricate = (key: string): PageElement => {
    const made: PageElement = { innerHTML: '', hidden: false, parentNode: bodyElement }
    const guarded = guard(key, made)
    rawElements.set(key, made)
    elements.set(key, guarded)
    return guarded
  }
  const element = (id: string): PageElement => elements.get(id) ?? fabricate(id)
  const documentReads = new Set<string>()
  const documentWrites = new Set<string>()
  // The document as the script reads it: the element lookup, the selection the copy guard
  // asks after, and the body the selection's walk climbs to.
  const documentStub = {
    getElementById: element,
    getSelection: () => selection,
    body: bodyElement,
  }
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
    document: new Proxy(documentStub, {
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
  return {
    elements,
    elementReads,
    elementWrites,
    elementActs,
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
    /** The content an element holds, read around the records the way the harness's own
     *  acts read — so a test's look at the page leaves the script's inventories alone,
     *  and they stay assertable live, after every refresh. */
    innerHtmlOf(id: string): string {
      return rawElements.get(id)?.innerHTML ?? ''
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
  const match = new RegExp(`<${tag} id="${id}"[^>]*>([\\s\\S]*?)</${tag}>`).exec(html)
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

/** The cosmetic effects the theme was redone without: the page's look is its colors and
 *  its lines alone, so a corner radius, a shadow, or a gradient is a shape the stylesheet
 *  never spells — pinned the way the content-target guard pins the family it names. */
function holdsNoCosmeticEffect(css: string): void {
  expect(css).not.toMatch(/border-radius|box-shadow|gradient/i)
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
// GIVEN an answer whose TASK has stood in its phase for 6000 seconds and last moved 90 seconds ago, a TASK 250 seconds into its phase that last moved 12 seconds ago, and TASKs with neither a heartbeat nor a phase
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
// Scenario: The page shows the TASK's phase word, its round in a column of its own, and how long it has stood there
// GIVEN an answer holding a TASK at phase test-review round 2 for 6000 seconds, a TASK at phase plan round 1, and TASKs with no phase file
// WHEN the page renders it
// THEN every phased row shows the phase word in its column and the round as a bare number in a column of its own beside it — round 1 as much as round 2 — with the two ages the page carries, the phase age and the heartbeat age, spelled from their answered numbers; the phase-less TASKs spell the word's absence and the round's absence as absences, the same way a missing heartbeat is spelled, never the state word or a number standing in; and the state word and its age appear nowhere on any row — they are the JSON's facts, not the page's
it("shows the TASK's phase word, its round in a column of its own, and how long it has stood there", async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rows = elements.get('rows')?.innerHTML ?? ''

  // The phase word in its own column, the round as a bare number in the column beside it
  // — round 1 as much as round 2 — and each phased row's two ages from its own answered
  // numbers: the round-1 row's as much as the round-2 row's.
  expect(rows).toContain('<td>alpha</td><td><span class="phase">test-review</span></td><td>2</td>')
  expect(rows).toContain('<td>stacked</td><td><span class="phase">plan</span></td><td>1</td>')
  expect(rows).toContain('<td>1h 40m 0s</td><td>1m 30s</td>')
  expect(rows).toContain('<td>4m 10s</td><td>12s</td>')
  // The no-phase TASKs' absences are spelled as absences — the word's own absence, the
  // round's own dash in the round's column beside it, and the word-spelled way a missing
  // heartbeat is — never the state word or a number standing in. The absence is asserted
  // by its exact spelling because the account column's own absence — no phases — contains
  // the bare word: a substring assertion would pass on the wrong column's absence.
  expect(rows).toContain('<td><span class="muted">no phase</span></td><td><span class="muted">—</span></td>')
  expect(rows).toContain('no heartbeat')

  // The state word and its age are the JSON's facts, not the page's: every state word the
  // fixture carries and every one of its state-age spellings is asserted absent, each
  // row's own age included, so no age can stand in anywhere another cell leaves open. The
  // same-bytes test equates this half with the shipped one, so one assertion pins both
  // renderers.
  expect(rows).not.toContain('building')
  expect(rows).not.toContain('merged')
  expect(rows).not.toContain('queued')
  expect(rows).not.toContain('2h 5m 41s')
  expect(rows).not.toContain('2h 13m 20s')
  expect(rows).not.toContain('1h 12m 1s')
  expect(rows).not.toContain('16m 39s')
  expect(rows).not.toContain('25h 0m 0s')
  expect(rows).not.toContain('45s')
  expect(rows).not.toContain('5m 0s')
  // Seven entries answer seven data rows — the Held subheading between the groups is no
  // entry's row — and no disclosure stands anywhere.
  expect((rows.match(/<tr/g) ?? []).length).toBe(8)
  expect(rows).not.toContain('<details')
})

// Requirement: The rendered page gives every queue entry its own row
// Scenario: Every queue entry renders its own row, however its blocked names another entry
// GIVEN a queue where one TASK's blocked names another — both rendering — beside a third TASK blocked by nothing
// WHEN the page is rendered
// THEN each entry renders its own row — three entries, three rows — no entry rides another's row and no entry hides behind a chain: every name stands in a TASK cell of its own, and each row carries its own phase word
it('renders every queue entry its own row, however its blocked names another', async () => {
  const linked: Docket = {
    rows: [
      fixtureRow('anchored', { phase: 'plan', round: 1 }),
      fixtureRow('loose', { phase: 'plan', round: 1 }),
      fixtureRow('tethered', { phase: 'build-green', round: 1, blocked: { task: 'anchored', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(linked)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // Three entries answer three data rows — the Held subheading row is no entry's row — and
  // every name opens a TASK cell of its own: the blocked TASK renders, it does not ride.
  expect((rowsHtml.match(/<tr(?: class="muted")?>/g) ?? []).length).toBe(3)
  for (const task of ['anchored', 'loose', 'tethered']) {
    expect(rowsHtml).toContain(`<td>${task}</td>`)
  }
  // No entry hides behind another's row: each row carries its own phase word, the blocked
  // TASK's as much as its blocker's.
  expect((rowsHtml.match(/<span class="phase">/g) ?? []).length).toBe(3)
})

// Requirement: The rendered page gives every queue entry its own row
// Scenario: A TASK whose MANIFEST carries a blocked names on its row the TASK that blocks it
// GIVEN a TASK blocked on a TASK still working, one blocked on a name no queue entry answers, and one blocked on a gone name whose branch coincides with its own name
// WHEN their rows render
// THEN each row names the TASK its blocked names — present or dangling, the mark standing in the branch column spelled `blocked by` — the held row's mark reading as a waiting state and the released row's as a muted recorded fact, and a row blocked by nothing carrying no mark at all
it("names on a blocked TASK's row the TASK that blocks it", async () => {
  const blocked: Docket = {
    rows: [
      fixtureRow('holder', { phase: 'plan', round: 1 }),
      fixtureRow('on-dangling', { phase: 'plan', round: 1, blocked: { task: 'gone', reason: 'built on it' } }),
      fixtureRow('on-holder', { phase: 'plan', round: 1, blocked: { task: 'holder', reason: 'built on it' } }),
      fixtureRow('selfnamed', { phase: 'plan', round: 1, branch: 'selfnamed', blocked: { task: 'gone', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(blocked)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The held row's mark — its blocker still working — reads as a waiting state, and the
  // dangling name still names the TASK it names: the row records the field, never decides
  // it.
  expect(rowsHtml).toContain('<td>work/on-holder <span class="waiting">blocked by holder</span></td>')
  expect(rowsHtml).toContain('<td>work/on-dangling <span class="muted">blocked by gone</span></td>')
  // The coinciding branch renders nowhere, and the mark follows it with no separator space
  // before it — the space appears only when something precedes the mark.
  expect(rowsHtml).toContain('<td><span class="muted">blocked by gone</span></td>')
  // A row blocked by nothing carries no mark at all: the blocker's own branch stands alone
  // in its cell — a mark would lengthen it.
  expect(rowsHtml).toContain('<td>work/holder</td>')
})

// Requirement: The rendered page gives every queue entry its own row
// Scenario: Rows stand with TASKs that are not held before TASKs that are held, in name order within each group
// GIVEN held TASKs — blocked naming TASKs still on the queue whose state word is not merged — mixed in name order with TASKs not held: free TASKs, a TASK whose blocked name dangles, and a merged entry a pass has not pruned
// WHEN the page renders
// THEN every not-held row stands above every held row, name order within each group, and one Held subheading row stands between the two groups so the partition reads as the two groups it is — while no heading stands at all when nothing is held
it('stands TASKs that are not held before TASKs that are held, in name order within each group', async () => {
  const mixed: Docket = {
    rows: [
      fixtureRow('amber', { phase: 'plan', round: 1, blocked: { task: 'zulu', reason: 'built on it' } }),
      fixtureRow('brooke', { phase: 'plan', round: 1 }),
      fixtureRow('coral', { phase: 'plan', round: 1, blocked: { task: 'nowhere', reason: 'built on it' } }),
      fixtureRow('done-one', { state: 'merged', phase: 'scout', round: 1 }),
      fixtureRow('york', { phase: 'plan', round: 1, blocked: { task: 'brooke', reason: 'built on it' } }),
      fixtureRow('zulu', { phase: 'plan', round: 1 }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(mixed)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // Not-held before held, name order within each group: brooke, coral, done-one, zulu —
  // the merged entry among the not-held — then the one Held subheading, then amber and
  // york, whose names sort before brooke's but whose rows wait behind the heading.
  const at = (task: string): number => rowsHtml.indexOf(`<td>${task}`)
  for (const [before, after] of [['brooke', 'coral'], ['coral', 'done-one'], ['done-one', 'zulu']] as const) {
    expect(at(before)).toBeLessThan(at(after))
  }
  const heading = '<tr class="group"><th colspan="8" scope="colgroup">Held</th></tr>'
  expect(at('zulu')).toBeLessThan(rowsHtml.indexOf(heading))
  expect(rowsHtml.indexOf(heading)).toBeLessThan(at('amber'))
  expect(at('amber')).toBeLessThan(at('york'))
  // The heading is the partition's whole furniture — exactly one — and it stands in the
  // markup the server ships no less than in the rows the script renders.
  expect((rowsHtml.match(/<tr class="group">/g) ?? []).length).toBe(1)
  expect(shippedMarkup(mixed)).toContain(heading)
  // Nothing held, no heading: the partition leaves no furniture behind when the held group
  // is empty.
  const free: Docket = {
    rows: [fixtureRow('solo'), fixtureRow('twin')],
    problems: [],
    outstanding: [],
  }
  const freeHtml = (await renderPageWith(free)).elements.get('rows')?.innerHTML ?? ''
  expect(freeHtml).not.toContain('<tr class="group">')
})

// Requirement: The rendered page gives every queue entry its own row
// Scenario: A merged entry still on the queue keeps its own row, shown muted
// GIVEN a TASK whose state word is merged and whose entry a pass has not pruned, beside a working TASK and one released from a merged blocker
// WHEN the page renders
// THEN the merged TASK keeps its own row — shown muted, its name beside a landed badge, its facts carried as any row's — until a pass prunes its entry, and no other row gains the muting or the badge
it('keeps a merged entry still on the queue its own row, shown muted', async () => {
  const withMerged: Docket = {
    rows: [
      fixtureRow('done-one', {
        state: 'merged',
        phase: 'scout',
        round: 1,
        phaseAgeSeconds: 20_000,
        phaseHistory: [{ phase: 'scout', round: 1, since: READ_AT - 20_000_000 }],
        phaseAccount: [{ word: 'scout', totalSeconds: 20_000, roundsReached: 1, live: true }],
      }),
      fixtureRow('standing', { phase: 'plan', round: 1 }),
      fixtureRow('unlatched', { phase: 'build-green', round: 1, blocked: { task: 'done-one', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(withMerged)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The merged entry's own row, muted from its open tag, its name beside the landed badge
  // — finished work a pass has not pruned, not a session that died — carrying its phase
  // word and round as any row does.
  expect(rowsHtml).toContain('<tr class="muted"><td>done-one <span class="landed">landed</span></td>')
  expect(rowsHtml).toContain('<td><span class="phase">scout</span></td><td>1</td>')
  // The standing rows answer it open and unbadged — the muting and the badge are the
  // merged row's own facts, not the renderer's habit — and the released TASK keeps a row
  // of its own, its mark the muted spelling of a recorded fact.
  expect(rowsHtml).toContain('<tr><td>standing</td>')
  expect(rowsHtml).toContain('<tr><td>unlatched</td>')
  expect(rowsHtml).toContain('<td>work/unlatched <span class="muted">blocked by done-one</span></td>')
  expect((rowsHtml.match(/<tr class="muted">/g) ?? []).length).toBe(1)
  expect((rowsHtml.match(/<span class="landed">landed<\/span>/g) ?? []).length).toBe(1)
  // The shipped half pins the same spelling — the muting and the badge are content the
  // server answers, not something the script adds.
  expect(shippedMarkup(withMerged)).toContain('<tr class="muted"><td>done-one <span class="landed">landed</span></td>')
})

// Requirement: The rendered page gives every queue entry its own row
// Scenario: The page shows no fraction and no disclosure
// GIVEN an answer holding a merged TASK, a TASK released from it, and a TASK held on one still working — shipped and refreshed
// WHEN the page renders
// THEN no progress fraction and no disclosure control appears anywhere — no details element, no summary, no number over a number — and no state carries across the refresh that a disclosure would have owned: the rows re-render alone, through text and visibility writes only
it('shows no fraction and no disclosure', async () => {
  const linked: Docket = {
    rows: [
      fixtureRow('anchor', { state: 'merged' }),
      fixtureRow('brace', { phase: 'build-green', round: 1, blocked: { task: 'anchor', reason: 'built on it' } }),
      fixtureRow('cargo', { phase: 'plan', round: 1, blocked: { task: 'brace', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const page = await renderPageWith(linked)
  const first = page.elements.get('rows')?.innerHTML ?? ''

  // No disclosure, no summary, and no digits-over-digits fraction anywhere the rows spell
  // — in the markup the server ships no less than in the rows the script renders.
  expect(first).not.toContain('<details')
  expect(first).not.toContain('<summary')
  expect(first).not.toMatch(/[0-9]+\/[0-9]+/)
  expect(shippedMarkup(linked)).not.toContain('<details')
  expect(shippedMarkup(linked)).not.toContain('<summary')

  // The refresh carries nothing a disclosure would have owned: the rows re-render through
  // text and visibility writes alone — no open flag, no focus, nothing else to carry.
  page.renewals[0]!()
  await page.flush()
  expect(page.elements.get('rows')?.innerHTML).toBe(first)
  expect([...page.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'completed-table.hidden',
    'empty.hidden',
    'problems-heading.hidden',
    'problems.hidden',
    'problems.innerHTML',
    'queue-table.hidden',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.hidden',
    'rulings.innerHTML',
  ])
})

// Requirement: The docket answers on a page
// Scenario: The branch renders only when it differs from the TASK's name
// GIVEN an answer holding two TASKs alike in every fact but their branches — one whose branch differs from its name, one whose branch is its name
// WHEN the page renders it
// THEN the differing branch shows on its row, and the coinciding one renders nowhere
it("renders the branch only when it differs from the TASK's name", async () => {
  const branched: Docket = {
    rows: [
      fixtureRow('branched', { phase: 'plan', round: 1 }),
      fixtureRow('plain', { phase: 'plan', round: 1, branch: 'plain' }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(branched)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  expect(rowsHtml).toContain('<td>work/branched</td>')
  // The coinciding branch renders nowhere: the branch cell stands empty — no name repeated
  // beside the TASK's own, no space or label where a mark would follow it.
  expect(rowsHtml).toContain('<td>plain</td><td><span class="phase">plan</span></td><td>1</td><td></td>')
  expect(rowsHtml).not.toContain('<td>plain </td>')
})

/** The phase-totals cell one row carries — the last cell the row holds, so the row's own
 *  boundaries frame it. */
function accountCellOf(rowsHtml: string, task: string): string {
  const row = new RegExp(`<tr(?: class="muted")?><td>${task}(?: <span class="landed">landed</span>)?</td>[\\s\\S]*?</tr>`).exec(rowsHtml)?.[0]
  if (row === undefined) throw new Error(`the rows hold no TASK ${task}`)
  return ([...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(match => match[1]!).at(-1) ?? '')
}

// Requirement: The docket answers on a page
// Scenario: The account lists each phase word once, in the order each first stood
// GIVEN an answer whose TASK stood implement, then test-review, then implement again — implement its first word, test-review its standing one
// WHEN the page renders it
// THEN the account lists implement first and test-review second, each word once — the word that returned did not reorder, and the standing word did not move itself to the front
it('lists each phase word once, in the order each first stood', async () => {
  const { elements } = await renderPageWith(ANSWER)

  expect(accountCellOf(elements.get('rows')?.innerHTML ?? '', 'alpha'))
    .toBe('implement 5h 20m 0s through round 3<br>test-review 2h 40m 0s through round 2')
})

// Requirement: The docket answers on a page
// Scenario: A word that returned shows one total, its separate runs summed under it
// GIVEN an answer whose TASK stood implement for 2 hours, then test-review for 1 hour, then implement again for the last hour
// WHEN the page renders it
// THEN the account spells implement once with the one total of 3 hours — neither run spelled apart, no second line for the word
it("sums a returning word's separate runs under its one total", async () => {
  const summed: Docket = {
    rows: [
      {
        task: 'looper',
        state: 'building',
        phase: 'implement',
        round: 2,
        branch: 'work/looper',
        blocked: undefined,
        stateAgeSeconds: 4 * 3600 + 600,
        heartbeatAgeSeconds: 30,
        phaseAgeSeconds: 3600,
        phaseHistory: [
          { phase: 'implement', round: 1, since: READ_AT - 4 * HOUR },
          { phase: 'test-review', round: 1, since: READ_AT - 2 * HOUR },
          { phase: 'implement', round: 2, since: READ_AT - 1 * HOUR },
        ],
        phaseAccount: [
          { word: 'implement', totalSeconds: 3 * 3600, roundsReached: 2, live: true },
          { word: 'test-review', totalSeconds: 3600, roundsReached: 1, live: false },
        ],
        session: { listed: false },
      },
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(summed)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  expect(accountCellOf(rowsHtml, 'looper')).toBe('implement 3h 0m 0s through round 2<br>test-review 1h 0m 0s')
  // Neither run spelled apart: the two-hour run and nothing else spells two hours.
  expect(rowsHtml).not.toContain('2h 0m 0s')
})

// Requirement: The docket answers on a page
// Scenario: A looping word shows the highest round it reached, and a word that stood only at round 1 shows no round at all
// GIVEN an answer holding a TASK whose implement reached round 3 and whose standing test-review reached round 2, and a TASK whose plan stood at round 1
// WHEN the page renders it
// THEN each looping word's account line spells through round N with its highest round, and the round-1 word's line carries no round suffix
it('shows how many rounds a looping word reached, and no round for a word that never looped', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  expect(rowsHtml).toContain('implement 5h 20m 0s through round 3')
  expect(rowsHtml).toContain('test-review 2h 40m 0s through round 2')
  expect(accountCellOf(rowsHtml, 'stacked')).toBe('plan 4m 10s')
  expect(rowsHtml).not.toContain('through round 1')
})

// Requirement: The docket answers on a page
// Scenario: The standing word's total moves with each answer, and every closed word's total holds still
// GIVEN a page rendered over an answer whose TASK's standing word is test-review, and a later answer read at a later now — the standing word's total grown ten minutes, every closed word's total unchanged
// WHEN the refresh lands the later answer
// THEN the standing word's total shows the grown number and its old one is gone, and the closed word's total shows the same number as before — the page moves the live time with its answers alone
it("moves the standing word's total with each answer and holds every closed word's fixed", async () => {
  const page = await renderPageWith(ANSWER)
  expect(page.elements.get('rows')?.innerHTML ?? '').toContain('test-review 2h 40m 0s through round 2')

  const later: Docket = {
    ...ANSWER,
    rows: ANSWER.rows.map(row => row.task === 'alpha'
      ? {
          ...row,
          phaseAgeSeconds: 6600,
          phaseAccount: [
            row.phaseAccount![0]!,
            { ...row.phaseAccount![1]!, totalSeconds: 2 * 3600 + 50 * 60 },
          ],
        }
      : row),
  }
  page.setAnswer(later)
  page.renewals[0]!()
  await page.flush()

  const moved = page.elements.get('rows')?.innerHTML ?? ''
  expect(moved).toContain('test-review 2h 50m 0s through round 2')
  expect(moved).not.toContain('2h 40m 0s')
  expect(moved).toContain('implement 5h 20m 0s through round 3')
})

// Requirement: The docket answers on a page
// Scenario: A TASK with no phase history shows the account's own absence
// GIVEN an answer holding a TASK with no phase file and no history, beside an archived TASK that kept none
// WHEN the page renders it
// THEN the phase-totals cell spells its own absence — no phases — in the live rows and the completed rows alike, never a number, the lived column, or the phase column's own no phase standing in for it
it("shows a missing phase history as the account's own absence", async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''
  const archivedHtml = elements.get('archive-rows')?.innerHTML ?? ''

  expect(accountCellOf(rowsHtml, 'settled')).toBe('<span class="muted">no phases</span>')
  expect(accountCellOf(archivedHtml, 'second')).toBe('<span class="muted">no phases</span>')
  // The two absences the page spells — the phase column's and the account's — stay distinct
  // words, each asserted by its exact spelling: the one contains the other as a substring.
  expect(rowsHtml).toContain('<span class="muted">no phase</span>')
  expect(rowsHtml).toContain('<span class="muted">no phases</span>')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The page renders the archive's records as a completed section in start order, latest first
// GIVEN an archive answer holding three completed TASKs, the later starts standing first, whose name order, settle order, and lived order all disagree with that arrival, and a live row standing on the queue
// WHEN the page renders it
// THEN each record's TASK, branch, and blocked show, the moments are spelled without milliseconds, and how long each TASK lived stands as its own column in the page's own age spelling — with the records in the answer's start order, latest first: the later start above the earlier, whatever the names, the settled moments, or the lived spans say
it('renders the archive records as a completed section in start order, latest first', async () => {
  // Arrival order is the answer's own — start-descended, as /archive answers it — and the
  // three records disagree pairwise in name, settle, and lived so that no re-sort a page
  // might impose reaches the same order: names bravo/zeta/alpha in arrival, settles
  // alpha/bravo/zeta ascending, lived 30m/75m/45m. Name-ascending answers alpha, bravo,
  // zeta; settled-descending answers zeta, bravo, alpha; lived-descending answers zeta,
  // alpha, bravo — the page-side twin of the serve ordering proof, pinning that the page
  // renders the answer's order rather than imposing its own.
  const arrival: readonly ArchiveRecord[] = [
    {
      task: 'bravo',
      branch: 'work/bravo',
      blocked: { task: 'zeta', reason: 'stacked on it' },
      enqueuedAt: '2025-01-01T09:50:00.123Z',
      settledAt: '2025-01-01T10:20:00.123Z',
      livedSeconds: 30 * 60,
      phaseHistory: null,
      phaseAccount: null,
    },
    {
      task: 'zeta',
      branch: 'work/zeta',
      blocked: undefined,
      enqueuedAt: '2025-01-01T09:35:00.000Z',
      settledAt: '2025-01-01T10:50:00.000Z',
      livedSeconds: 75 * 60,
      phaseHistory: null,
      phaseAccount: null,
    },
    {
      task: 'alpha',
      branch: 'work/alpha',
      blocked: undefined,
      enqueuedAt: '2025-01-01T09:20:00.000Z',
      settledAt: '2025-01-01T10:05:00.000Z',
      livedSeconds: 45 * 60,
      phaseHistory: null,
      phaseAccount: null,
    },
  ]
  const page = await renderPageWith(ANSWER, { records: arrival })
  const rows = page.elements.get('rows')?.innerHTML ?? ''
  const archived = page.elements.get('archive-rows')?.innerHTML ?? ''

  expect(rows).toContain('<td>alpha</td>')
  expect(archived).toContain('<td>bravo</td><td>work/bravo <span class="muted">blocked by zeta</span></td>')
  expect(archived).toContain('<td>zeta</td><td>work/zeta</td>')
  expect(archived).toContain('<td>alpha</td><td>work/alpha</td>')
  // The lived column, in the page's own age spelling — thirty minutes, seventy-five, forty-five.
  expect(archived).toContain('<td>30m 0s</td>')
  expect(archived).toContain('<td>1h 15m 0s</td>')
  expect(archived).toContain('<td>45m 0s</td>')
  // The answer's own order, preserved: the later start above the earlier — bravo (09:50)
  // above zeta (09:35) above alpha (09:20), an order no name, settle, or lived sort reaches.
  expect(archived.indexOf('<td>bravo</td>')).toBeLessThan(archived.indexOf('<td>zeta</td>'))
  expect(archived.indexOf('<td>zeta</td>')).toBeLessThan(archived.indexOf('<td>alpha</td>'))
  // The moments as the page spells them — milliseconds trimmed, a precision the JSON keeps and the page does not.
  expect(archived).toContain('<td>2025-01-01T09:50:00Z</td>')
  expect(archived).not.toContain('.123Z')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The completed record shows its phase account as the live rows show theirs
// GIVEN an archive answer holding a completed TASK that stood implement, then test-review, then implement again
// WHEN the page renders it, shipped and refreshed alike
// THEN the completed section spells the same account a live row would — each word once in first-standing order, its separate runs summed under one total, the looping word's highest round beside it
it("shows the completed record's phase account as the live rows show theirs", async () => {
  const page = await renderPageWith(ANSWER)
  const account = 'implement 1h 15m 0s through round 2<br>test-review 15m 0s'

  expect(accountCellOf(page.elements.get('archive-rows')?.innerHTML ?? '', 'first')).toBe(account)
  expect(shippedMarkup()).toContain(`<td>${account}</td>`)
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: Every phase of a completed record's account is closed at the settled moment
// GIVEN an archive answer holding a TASK settled at 10:30 whose last history entry began at 10:00
// WHEN the page renders it
// THEN the last word's total is the half hour between the two moments — closed at the settled moment, not at any later now, which would spell months — and the word before it closed at the moment the last began
it("closes every phase of a completed record's account at the settled moment", async () => {
  const closer: readonly ArchiveRecord[] = [
    {
      task: 'closer',
      branch: 'work/closer',
      blocked: undefined,
      enqueuedAt: '2025-01-01T09:00:00.000Z',
      settledAt: '2025-01-01T10:30:00.000Z',
      livedSeconds: 90 * 60,
      phaseHistory: [
        { phase: 'implement', round: 1, since: Date.UTC(2025, 0, 1, 9, 0, 0) },
        { phase: 'test-review', round: 1, since: Date.UTC(2025, 0, 1, 10, 0, 0) },
      ],
      phaseAccount: [
        { word: 'implement', totalSeconds: 3600, roundsReached: 1, live: false },
        { word: 'test-review', totalSeconds: 1800, roundsReached: 1, live: false },
      ],
    },
  ]
  const page = await renderPageWith(ANSWER, { records: closer })

  expect(accountCellOf(page.elements.get('archive-rows')?.innerHTML ?? '', 'closer'))
    .toBe('implement 1h 0m 0s<br>test-review 30m 0s')
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: The completed section stands after the rulings outstanding section
// GIVEN a docket answer holding live rows, a problem, and an outstanding ruling, and an archive holding a completed TASK
// WHEN the page is written with them
// THEN the markup's completed section stands after the rulings outstanding section — the rows, the problems, and the debt still owed all read before the history of what has finished
it('stands the completed section after the rulings outstanding section', () => {
  const markup = shippedMarkup()

  // Every section the THEN names stands present and before the completed one — a missing
  // heading would answer -1 and pass a bare less-than vacuously, so presence is pinned too.
  const completed = markup.indexOf('<h2 id="completed-heading"')
  for (const before of ['<tbody id="rows"', '<h2 id="problems-heading"', '<h2 id="rulings-heading"', '<ul id="problems"', '<ul id="rulings"']) {
    const at = markup.indexOf(before)
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(completed)
  }
  expect(completed).toBeGreaterThan(-1)
  // The history itself, not just its heading: the completed table's rows stand after every
  // section the THEN names — after the lists that hold the problems and the debt, not merely
  // their headings — so a page that hoists the table above any of them does not pass. The
  // last guard is the converse: no list may end after the history either, which is what a
  // list overlapping the table would read as.
  const archiveRows = markup.indexOf('<tbody id="archive-rows"')
  expect(archiveRows).toBeGreaterThan(-1)
  for (const before of ['<tbody id="rows"', '<ul id="problems"', '<ul id="rulings"']) {
    expect(markup.indexOf(before)).toBeLessThan(archiveRows)
  }
  expect(markup.lastIndexOf('</ul>')).toBeLessThan(archiveRows)
})

// Requirement: The page answers the archive of completed TASKs
// Scenario: An empty archive is shown as an absence
// GIVEN an archive holding no completed TASK
// WHEN the page is written with it, and its script renders the same answer the way a browser runs it
// THEN the completed section stands open with its absence spelled plainly — never a section silently missing — and the rows the script renders are the same none the page shipped
it('shows an empty archive as a visible absence', async () => {
  const markup = shippedMarkup(ANSWER, [])
  const page = await renderPageWith(ANSWER, { records: [] })

  expect(markup).toContain('<h2 id="completed-heading">completed <span class="muted">enqueued latest first</span></h2>')
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
// THEN its markup carries every fact as content a browser shows before any script runs — the phase words and the rounds in a column of their own, the blocked marks naming what each blocked row waits behind, the Held subheading over the held group, the landed badges beside merged rows — the page is the view asked again, not an empty shell around a script
it('carries the docket\'s facts as visible content in the markup it ships', () => {
  const markup = shippedMarkup()

  expect(markup).toContain(htmlEscaped(ATTACH))
  expect(markup).toContain('test-review')
  expect(markup).toContain('round 2')
  expect(markup).toContain('through round 3')
  expect(markup).toContain(htmlEscaped('task broken has no MANIFEST'))
  expect(markup).toContain(htmlEscaped(RULING.answerWith))
  // The flat rows' own reach, shipped as content: every blocked mark spells the name it
  // records — held as a waiting state, released as a muted fact, dangling names included —
  // the held group stands under its Held subheading, and a merged entry keeps its muted
  // row with a landed badge beside its name.
  expect(markup).toContain('<span class="waiting">blocked by early</span>')
  expect(markup).toContain('<span class="muted">blocked by base-task</span>')
  expect(markup).toContain('<span class="muted">blocked by other-task</span>')
  expect(markup).toContain('<tr class="group"><th colspan="8" scope="colgroup">Held</th></tr>')
  expect(markup).toContain('<tr class="muted"><td>settled <span class="landed">landed</span></td>')
  // The round stands in a column of its own beside the phase word's.
  expect(markup).toContain('<th scope="col">round</th>')
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
// Scenario: The page ships a viewport meta and both color schemes, and its script owns no theme machinery
// GIVEN the docket's page
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it
// THEN the head carries a viewport meta and names light and dark both as color schemes, the stylesheet answers the system's preference with a dark palette of its own — reassigning the signal color to one the light palette never held, the phase word's color wired to the variable that carries it — and spells none of the effects the redo left behind — no corner radius, no shadow, no gradient anywhere in it — and the script owns no theme machinery of its own — no matchMedia anywhere on the page, and its global reach stays what it was
it('ships a viewport meta and both color schemes, and no theme machinery in the script', async () => {
  const page = docketPage(ANSWER, ARCHIVE)
  const run = await renderPageWith(ANSWER)

  expect(page).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
  expect(page).toContain('<meta name="color-scheme" content="light dark">')
  expect(page).toContain('@media (prefers-color-scheme: dark)')
  // The redo's negative craft constraints, pinned on the stylesheet the way the
  // content-target guard pins its own family: the look is color and line alone.
  const stylesheet = /<style>([\s\S]*?)<\/style>/.exec(page)?.[1]
  if (stylesheet === undefined) throw new Error('the docket page ships no stylesheet')
  holdsNoCosmeticEffect(stylesheet)
  // The dark half is a palette of its own, not a token presence: its block reassigns the
  // signal color to a value the light palette — the first one the stylesheet spells —
  // never had, and the phase word, the one place the signal shows on a row, stays wired
  // to the variable the two palettes feed.
  const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*?)\n  \}/.exec(stylesheet)?.[1]
  if (darkBlock === undefined) throw new Error('the stylesheet ships no dark media block')
  const signalOf = (css: string): string => {
    const signal = /--signal:\s*([^;]+);/.exec(css)?.[1]
    if (signal === undefined) throw new Error('the palette spells no signal color')
    return signal
  }
  expect(signalOf(darkBlock)).not.toBe(signalOf(stylesheet))
  expect(stylesheet).toContain('.phase { color: var(--signal); }')
  // The system names the theme and the stylesheet answers it; the script keeps no media
  // machinery of its own — nowhere on the page, and nothing new within its reach.
  expect(page).not.toContain('matchMedia')
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
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
 *  completed records are two tables, and a header must answer for its own rows alone. The
 *  Held subheading row a held group stands under is no data row: it carries no cell, and
 *  the row patterns below pass it by. */
function tablesOf(html: string): { readonly bodyId: string; readonly headerCells: number; readonly rows: string[] }[] {
  const pattern = /<thead>[\s\S]*?<\/thead>\s*<tbody id="([^"]+)">([\s\S]*?)<\/tbody>/g
  return [...html.matchAll(pattern)].map(match => ({
    bodyId: match[1]!,
    headerCells: (match[0].match(/<th scope="col">/g) ?? []).length,
    rows: [...match[2]!.matchAll(/<tr(?: class="muted")?>[\s\S]*?<\/tr>/g)].map(row => row[0]),
  }))
}

// Requirement: The docket answers on a page
// Scenario: Every column the header names is a cell every row carries
// GIVEN the page shipped over a branch-walking answer, holding both of its tables
// WHEN each table's header is read against every row it shipped
// THEN each row carries exactly one cell per its own header's columns — the headers and the two renderers cannot drift apart end to end, in either table, on any row
it('carries one cell per column each table\'s header names', () => {
  const tables = tablesOf(shippedMarkup())

  expect(tables.map(table => table.bodyId)).toEqual(['rows', 'archive-rows'])
  for (const table of tables) {
    expect(table.headerCells).toBeGreaterThan(0)
    // Every row, not the first alone: a row that drops or adds a cell anywhere in either
    // table's body is a drift the header no longer answers for.
    expect(table.rows.length).toBeGreaterThan(0)
    for (const row of table.rows) {
      expect((row.match(/<td>/g) ?? []).length).toBe(table.headerCells)
    }
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

// Requirement: The page shows commands and offers no control that runs them
// Scenario: No control on the page attaches, rules, holds, or starts anything
// GIVEN the docket's page, and answers that walk every rendering branch it holds — held rows and released ones, merged entries and dangling names, and a copy's selection holding a refresh among them
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it — against answers, and against a network that fails
// THEN it offers no control that runs anything — no element beyond the ones it was written with, in the markup it ships or the HTML it renders, nor any attribute that carries a value beyond the ones it was written with, nor any stylesheet import or url or javascript: scheme anywhere, and its script touches no global but the document, the fetches of /docket and /archive, the timer that renews them, and the arithmetic it spells ages with — whether the fetches answer or fail — reads nothing off the document but the element lookup and the live selection the copy guard asks after — and, while one lives, the body its walk climbs to — reads nothing off an element but the parent the live selection's walk climbs by, invokes nothing on an element at all, and writes nothing to one but the text and the visibility of the sections it re-renders
it('offers no control that runs anything', async () => {
  const run = await renderPageWith(ANSWER)
  const rendered = [...run.elements.keys()].map(id => run.innerHtmlOf(id)).join('')
  const offline = await renderPageOffline()

  // The whole inventory of the markup it ships: every element name and every valued
  // attribute the page was written with, before and after its script alike. A control, a
  // request door, or any element at all, arrives as a name this list would have to carry —
  // the shipped rows, completed records, problems, and rulings included, for they are
  // content, not controls.
  expect(elementNames(shippedMarkup())).toEqual(['body', 'br', 'code', 'h1', 'h2', 'head', 'html', 'li', 'meta', 'p', 'span', 'style', 'table', 'tbody', 'td', 'th', 'thead', 'title', 'tr', 'ul'])
  expect(valuedAttributeNames(shippedMarkup())).toEqual(['aria-labelledby', 'charset', 'class', 'colspan', 'content', 'id', 'initial-scale', 'lang', 'name', 'scope'])
  // The same inventory of the HTML its script renders for the branch-walking answer —
  // nothing the page can build carries an element or a valued attribute beyond these. The
  // th is the Held subheading row the held group stands under, content the rows carry.
  expect(elementNames(rendered)).toEqual(['br', 'code', 'li', 'span', 'td', 'th', 'tr'])
  expect(valuedAttributeNames(rendered)).toEqual(['class', 'colspan', 'scope'])
  // Content-level targets, in the shipped markup and the rendered HTML alike.
  holdsNoContentTarget(shippedMarkup())
  holdsNoContentTarget(rendered)
  // The page's first round of requests is its two refreshes, to /docket and /archive —
  // the page's requests are its refreshes, nothing else.
  expect(run.fetched).toEqual(['/docket', '/archive'])
  // The script's whole reach: every global it touches by name, every document property it
  // reads or writes, and every element property it reads, writes, or invokes. A control
  // wired in script — a handler read off an element, a request by any other means — is a
  // touch this inventory would have to carry, and the claim above with it.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentReads].sort()).toEqual(['getElementById', 'getSelection'])
  expect([...run.documentWrites]).toEqual([])
  expect([...run.elementReads]).toEqual([])
  expect([...run.elementActs]).toEqual([])
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'completed-table.hidden',
    'empty.hidden',
    'problems-heading.hidden',
    'problems.hidden',
    'problems.innerHTML',
    'queue-table.hidden',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.hidden',
    'rulings.innerHTML',
  ])
  // The copy guard's branch runs at last: a selection live inside the rows, held against
  // one refresh and cleared before the next. The walk joins the inventories — the body it
  // climbs to, the parent it climbs by — and the held refresh itself reaches for nothing
  // else: no probe, no swap, which is the very fact the copy scenario stands on.
  run.selectWithin('rows')
  run.renewals[0]!()
  await run.flush()
  expect([...run.documentReads].sort()).toEqual(['body', 'getElementById', 'getSelection'])
  expect([...run.elementReads].sort()).toEqual(['rows.parentNode'])
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'completed-table.hidden',
    'empty.hidden',
    'problems-heading.hidden',
    'problems.hidden',
    'problems.innerHTML',
    'queue-table.hidden',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.hidden',
    'rulings.innerHTML',
  ])
  run.clearSelection()
  run.renewals[0]!()
  await run.flush()
  // The refresh after the copy ends is the ordinary path again: the same writes, nothing
  // more, and no element act anywhere.
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'completed-table.hidden',
    'empty.hidden',
    'problems-heading.hidden',
    'problems.hidden',
    'problems.innerHTML',
    'queue-table.hidden',
    'rows.innerHTML',
    'rulings-heading.hidden',
    'rulings.hidden',
    'rulings.innerHTML',
  ])
  expect([...run.elementActs]).toEqual([])
  expect([...run.documentReads].sort()).toEqual(['body', 'getElementById', 'getSelection'])
  // The failed fetches run the refresh's catch branches — shipped code with a reach of
  // their own. Nothing renders there, and the branches still touch nothing but the fetches
  // and the timer: no retry machinery of their own, no door the answering paths keep closed.
  expect(offline.fetched).toEqual(['/docket', '/archive'])
  expect([...offline.touched].sort()).toEqual(['fetch', 'setInterval'])
  expect([...offline.documentReads]).toEqual([])
  expect([...offline.documentWrites]).toEqual([])
  expect([...offline.elementReads]).toEqual([])
  expect([...offline.elementWrites]).toEqual([])
})
