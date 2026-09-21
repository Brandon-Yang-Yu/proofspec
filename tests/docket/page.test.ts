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
 *  working TASK with a session, a two-member chain — a merged TASK with the frontier TASK
 *  building on it — a merged TASK no entry names, a TASK stacked on one that is not on the
 *  queue, a problem, a debt with its named node, and one whose key names no node at all —
 *  so no literal the script could emit goes unrendered. Its rows also walk the phase
 *  account's every branch: alpha carries a returning word (implement stood, left, and
 *  stood again) with a loop past round 1 and a live standing word, stacked carries a
 *  single-word account at round 1, and settled carries no history at all — so the account
 *  column's presence and its absence are both content the parity assertions compare, not
 *  one of them alone. */
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
      // The chain's riding member: merged, with the frontier still standing on it. It
      // carries every fact a row carries — a branch, a phase word with its round and age,
      // an account of its own — and none of them but its name and state word may render
      // anywhere.
      task: 'base-task',
      state: 'merged',
      phase: 'scout',
      round: 1,
      branch: 'work/base-task',
      base: { kind: 'main' },
      stateAgeSeconds: 90_000,
      heartbeatAgeSeconds: null,
      phaseAgeSeconds: 20_000,
      phaseHistory: [{ phase: 'scout', round: 1, since: READ_AT - 20_000_000 }],
      phaseAccount: [{ word: 'scout', totalSeconds: 20_000, roundsReached: 1, live: true }],
      session: { listed: false },
    },
    {
      // The chain's frontier: building on base-task, the member the chain's one row renders.
      task: 'frontier',
      state: 'building',
      phase: 'build-green',
      round: 1,
      branch: 'work/frontier',
      base: { kind: 'task', task: 'base-task', reason: 'built on it' },
      stateAgeSeconds: 8000,
      heartbeatAgeSeconds: 30,
      phaseAgeSeconds: 500,
      phaseHistory: [{ phase: 'build-green', round: 1, since: READ_AT - 500_000 }],
      phaseAccount: [{ word: 'build-green', totalSeconds: 500, roundsReached: 1, live: true }],
      session: { listed: false },
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
      base: { kind: 'task', task: 'other-task', reason: 'stacked on it' },
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
 *  plain building TASK over main, so a chain scenario's rows read as the names, states,
 *  and links they are about. */
function fixtureRow(task: string, overrides: Partial<Omit<DocketRow, 'task'>> = {}): DocketRow {
  return {
    task,
    state: 'building',
    phase: null,
    round: null,
    branch: `work/${task}`,
    base: { kind: 'main' },
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
 *  TASKs held latest start first, the order the archive's answer arrives in — one built on
 *  main, one stacked on another TASK — with milliseconds on the later-started one's moments,
 *  so the page's trim of them is pinned, and lived durations the page's own age() spelling
 *  has to spell. */
const ARCHIVE: readonly ArchiveRecord[] = [
  {
    // The later start — the TASK enqueued most recently stands first in the section.
    task: 'second',
    branch: 'work/second',
    base: { kind: 'task', task: 'first', reason: 'stacked on it' },
    enqueuedAt: '2025-01-01T09:30:00.123Z',
    settledAt: '2025-01-01T10:45:00.123Z',
    livedSeconds: 75 * 60,
    phaseHistory: null,
    phaseAccount: null,
  },
  {
    task: 'first',
    branch: 'work/first',
    base: { kind: 'main' },
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

/** One element the page's script renders into, as the script itself sees it — `open` the
 *  disclosure flag a person's click leaves standing, `firstElementChild` the summary a
 *  chain's disclosure opens with. */
type PageElement = {
  innerHTML: string
  hidden: boolean
  open: boolean
  parentNode: PageElement | null
  /** The id the element stands for — read only on the disclosure a focused summary opens,
   *  where the script learns which chain's row holds the focus. */
  readonly id: string
  firstElementChild: SummaryElement | null
}

/** The summary a chain's disclosure carries as its first element — the one place in the
 *  rows the keyboard's focus can stand, and the element whose focus the script re-invokes
 *  to carry it across a redraw. */
type SummaryElement = PageElement & {
  readonly tagName: 'SUMMARY'
  focus(options: { readonly preventScroll: boolean }): void
}

/** How a disclosure's summary is keyed in the harness's records: under its parent
 *  disclosure's id, so a recorded focus names the chain whose summary received it. */
const SUMMARY_SUFFIX = '>summary'

/**
 * Runs the page's own inline script the way a browser runs it, recording its whole reach:
 * every global it touches by name, every property it reads or writes on the document,
 * every property it reads or writes on any element, and every method it invokes on one.
 * Asserting against the page's script — not a reimplementation of it — is what keeps this
 * a proof about the page rather than a claim about a copy of it, and the inventories are
 * what let a test hold a shape ("nothing but these") instead of a list of spellings a
 * mutant could walk around. The harness also models the one DOM fact the refresh's carry
 * turns on: writing an element's content tears the elements beneath it down, so a state
 * read before the swap and an act landed after it are the different things they are in a
 * browser — a string write that tore down nothing could not tell them apart.
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
  // The objects behind those proxies: the harness's own acts reach these directly, so what
  // the browser does on a person's own hand — a click opening a disclosure, a keyboard's
  // Tab focusing a summary — leaves no trace in the records that hold the script's reach.
  const rawElements = new Map<string, PageElement>()
  const elementReads = new Set<string>()
  const elementWrites = new Set<string>()
  // The method invocations the script asks of an element — the focus a carried summary
  // re-receives — kept as a list rather than a set because the count is part of the fact:
  // a refresh that carries focus lands it once, and the records must tell one landing
  // from two apart.
  const elementActs: string[] = []
  // The ids an innerHTML write tore down: a browser answers no element for them until its
  // markup spells them again, and the harness answers the same null — which is what makes
  // the focus carry's miss real, the resolution the script performs when a redraw moved
  // a chain's disclosure id.
  const deadElementIds = new Set<string>()
  // The element the browser's focus stands on, by the key it was fabricated under: the
  // teardown that kills a focused summary drops the focus with it, the way a browser
  // falls off an element the redraw removed — so a focus read after the swap, rather
  // than before it, finds nothing left to carry.
  let activeKey: string | null = null
  // The page's elements as the browser nests them: everything the script can hold a
  // selection inside hangs off the body, so the selection guard's walk up the tree arrives.
  const bodyElement: PageElement = { innerHTML: '', hidden: false, open: false, parentNode: null, id: 'body', firstElementChild: null }
  const guard = <T extends PageElement>(key: string, made: T): T => new Proxy(made, {
    get(target, prop) {
      if (typeof prop === 'string') elementReads.add(`${key}.${prop}`)
      return Reflect.get(target, prop)
    },
    set(target, prop, value) {
      if (typeof prop === 'string') elementWrites.add(`${key}.${prop}`)
      if (prop !== 'innerHTML') return Reflect.set(target, prop, value)
      // A browser writing an element's content tears the elements beneath it down and
      // builds the new markup's, so an open flag stood before the write dies with its
      // element, and nothing short of a write after it stands one up again. The harness
      // models what its strings can see: every element whose id the old content spelled
      // dies, and every id the new content spells stands fresh — the standing page
      // elements are content's containers, never its spelling, so they persist as the
      // browser's own do.
      teardownBeneath(target.innerHTML)
      const applied = Reflect.set(target, prop, value)
      raiseBeneath(target.innerHTML)
      return applied
    },
  })
  const fabricateSummary = (disclosureKey: string, disclosure: PageElement): SummaryElement => {
    const key = disclosureKey + SUMMARY_SUFFIX
    const made: SummaryElement = {
      innerHTML: '',
      hidden: false,
      open: false,
      parentNode: disclosure,
      id: key,
      firstElementChild: null,
      tagName: 'SUMMARY',
      focus() {
        // The script's own focus landing: recorded as the element act it is, and stood as
        // the browser's active element, so the next refresh reads it back the way a
        // browser holds the focus a script placed.
        elementActs.push(`${key}.focus`)
        standActive(key, summary)
      },
    }
    const summary = guard(key, made)
    rawElements.set(key, made)
    elements.set(key, summary)
    return summary
  }
  const fabricate = (key: string): PageElement => {
    const made: PageElement = { innerHTML: '', hidden: false, open: false, parentNode: bodyElement, id: key, firstElementChild: null }
    const guarded = guard(key, made)
    rawElements.set(key, made)
    elements.set(key, guarded)
    // Only a chain's disclosure can hold the keyboard's focus — the script's own guard
    // reads no other element's summary — so only those carry one.
    if (key.startsWith('chain-')) made.firstElementChild = fabricateSummary(key, guarded)
    return guarded
  }
  const teardownBeneath = (oldContent: string): void => {
    const dying = new Set<string>()
    for (const key of rawElements.keys()) {
      if (!key.endsWith(SUMMARY_SUFFIX) && oldContent.includes(`id="${key}"`)) dying.add(key)
    }
    // A summary dies with the disclosure that carries it, whether or not the content
    // spelled the summary's own key.
    for (const key of rawElements.keys()) {
      if (key.endsWith(SUMMARY_SUFFIX) && dying.has(key.slice(0, -SUMMARY_SUFFIX.length))) dying.add(key)
    }
    for (const key of dying) {
      elements.delete(key)
      rawElements.delete(key)
      deadElementIds.add(key)
    }
    if (activeKey !== null && dying.has(activeKey)) dropFocus()
  }
  const raiseBeneath = (newContent: string): void => {
    for (const found of newContent.matchAll(/ id="([^"]+)"/g)) {
      const key = found[1]!
      if (elements.has(key)) continue
      deadElementIds.delete(key)
      fabricate(key)
    }
  }
  const element = (id: string): PageElement | null => {
    if (deadElementIds.has(id)) return null
    const found = elements.get(id)
    return found !== undefined ? found : fabricate(id)
  }
  const documentReads = new Set<string>()
  const documentWrites = new Set<string>()
  // The document as the script reads it: the element lookup, the selection the copy guard
  // asks after, the body the selection's walk climbs to — and the focus, null until a
  // person's keyboard or the script's own carry stands it somewhere.
  const documentStub = {
    getElementById: element,
    getSelection: () => selection,
    body: bodyElement,
    activeElement: null as PageElement | null,
  }
  const standActive = (key: string, focused: PageElement): void => {
    documentStub.activeElement = focused
    activeKey = key
  }
  const dropFocus = (): void => {
    documentStub.activeElement = null
    activeKey = null
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
    /** The way a click leaves a disclosure: the element's own open flag stands, set by the
     *  browser and not by the script — fabricated when absent so a page that ships no
     *  disclosure fails at the assertions that follow, not at the act itself. */
    openDisclosure(id: string): void {
      const disclosure = element(id)
      if (disclosure === null) throw new Error(`no disclosure #${id} stands to open`)
      rawElements.get(id)!.open = true
    },
    /** The way the keyboard's Tab leaves a chain's summary focused: the summary stands as
     *  the document's active element, stood by the browser and not by the script — so the
     *  act leaves no trace in the records that hold the script's reach. */
    focusSummary(id: string): void {
      const disclosure = element(id)
      if (disclosure === null) throw new Error(`no disclosure #${id} stands to focus`)
      const summary = elements.get(id + SUMMARY_SUFFIX)
      if (summary === undefined) throw new Error(`the disclosure #${id} carries no summary`)
      standActive(id + SUMMARY_SUFFIX, summary)
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
// Scenario: The page shows the TASK's phase word, its round in a column of its own, and how long it has stood there
// GIVEN an answer holding a TASK at phase test-review round 2 for 6000 seconds, a TASK at phase plan round 1, and a TASK with no phase file
// WHEN the page renders it
// THEN every phased row shows the phase word in its column and the round as a bare number in a column of its own beside it — round 1 as much as round 2 — with the two ages the page carries, the phase age and the heartbeat age, spelled from their answered numbers; the phase-less TASK spells the word's absence and the round's absence as absences, the same way a missing heartbeat is spelled, never the state word or a number standing in; the state word and its age appear nowhere on a row outside a chain's disclosure, where the riding members' state words legitimately stand; and a row no member rides carries no disclosure at all
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
  // The no-phase TASK's absences are spelled as absences — the word's own absence, the
  // round's own dash in the round's column beside it, and the word-spelled way a missing
  // heartbeat is — never the state word or a number standing in. The absence is asserted
  // by its exact spelling because the account column's own absence — no phases — contains
  // the bare word: a substring assertion would pass on the wrong column's absence.
  expect(rows).toContain('<td><span class="muted">no phase</span></td><td><span class="muted">—</span></td>')
  expect(rows).toContain('no heartbeat')

  // The state word and its age are the JSON's facts, not the page's: outside the chain's
  // disclosure — stripped here, for the riding members' state words legitimately stand
  // inside it — every state word the fixture carries and every one of its state-age
  // spellings is asserted absent, each row's own age included, so no age can stand in
  // anywhere another cell leaves open. The same-bytes test equates this half with the
  // shipped one, so one assertion pins both renderers.
  const outsideDisclosures = rows.replace(/<details[\s\S]*?<\/details>/g, '')
  expect(outsideDisclosures).not.toContain('building')
  expect(outsideDisclosures).not.toContain('merged')
  expect(outsideDisclosures).not.toContain('queued')
  expect(outsideDisclosures).not.toContain('2h 5m 41s')
  expect(outsideDisclosures).not.toContain('2h 13m 20s')
  expect(outsideDisclosures).not.toContain('25h 0m 0s')
  expect(outsideDisclosures).not.toContain('45s')
  expect(outsideDisclosures).not.toContain('5m 0s')
  // A row no member rides carries no disclosure at all: the singletons' TASK cells close
  // on their own names, and the chain's disclosure is the only one the rows hold.
  expect(rows).toContain('<td>alpha</td>')
  expect(rows).toContain('<td>settled</td>')
  expect(rows).toContain('<td>stacked</td>')
  expect((rows.match(/<details/g) ?? []).length).toBe(1)
})

// Requirement: The docket answers on a page
// Scenario: A chain renders one row, at its in-progress member's place in the name order
// GIVEN an answer holding a merged TASK, a building TASK whose base names it, and a queued TASK whose base names the building one — a chain of three — beside singletons sorting before the chain's first member, inside its span, and after its last
// WHEN the page renders it
// THEN the chain answers one row, standing at the building TASK's place in the name order and carrying that member's own facts, and the merged member before it and the queued member after it render no row of their own — they ride the row
it("renders a chain as one row at its in-progress member's place in the name order", async () => {
  const chained: Docket = {
    rows: [
      fixtureRow('early', { phase: 'plan', round: 1 }),
      fixtureRow('landed-one', { state: 'merged', phase: 'review', round: 2 }),
      fixtureRow('loose', { phase: 'plan', round: 1 }),
      fixtureRow('midwork', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'landed-one', reason: 'built on it' } }),
      fixtureRow('tailwork', { state: 'queued', base: { kind: 'task', task: 'midwork', reason: 'built on it' } }),
      fixtureRow('zulu', { phase: 'plan', round: 1 }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(chained)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // Six entries answer four rows: the singletons' and the chain's one. The chain's row
  // stands at the building member's own place in the name order — after loose, which sorts
  // inside the chain's span, and before zulu — not at the merged member's place before it.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(4)
  expect(rowsHtml.indexOf('<td>loose</td>')).toBeLessThan(rowsHtml.indexOf('<td>midwork<details'))
  expect(rowsHtml.indexOf('<td>midwork<details')).toBeLessThan(rowsHtml.indexOf('<td>zulu</td>'))
  // Neither riding member renders a row of its own: their names stand only inside the
  // disclosure, by name and state word.
  expect(rowsHtml).not.toContain('<td>landed-one')
  expect(rowsHtml).not.toContain('<td>tailwork')
  expect(rowsHtml).toContain('<li>landed-one merged</li><li>midwork building</li><li>tailwork queued</li>')
  // The row carries the building member's own facts — its phase word, its round, its
  // branch and base — and none of the riding members'.
  expect(rowsHtml).toContain('<td><span class="phase">build-green</span></td><td>1</td>')
  expect(rowsHtml).toContain('work/midwork <span class="muted">from landed-one</span>')
  expect(rowsHtml).not.toContain('review')
  expect(rowsHtml).not.toContain('work/landed-one')
})

// Requirement: The docket answers on a page
// Scenario: The chain's row carries its progress as a bare fraction
// GIVEN an answer holding a chain of three TASKs, two of them merged and one still building
// WHEN the page renders it
// THEN the row carries the chain's progress as the bare fraction 2/3 — the members whose state word reads merged over all the chain's members — with no words around the number
it("carries a chain's progress as a bare fraction", async () => {
  const chained: Docket = {
    rows: [
      fixtureRow('anchor', { state: 'merged' }),
      fixtureRow('brace', { state: 'merged', base: { kind: 'task', task: 'anchor', reason: 'built on it' } }),
      fixtureRow('cargo', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'brace', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(chained)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The summary closes on its own digits — the number and nothing else around it.
  expect(rowsHtml).toContain('<details id="chain-cargo"><summary>2/3</summary>')
})

// Requirement: The docket answers on a page
// Scenario: The fraction expands to every member by name and state word, and a riding member's other facts render nowhere
// GIVEN an answer holding a chain whose riding member carries a branch, a phase word with its round and age, and a phase account of its own
// WHEN the page renders it
// THEN the fraction expands to a disclosure listing every member by name and state word alone — the one place a state word shows — and none of the riding member's other facts renders anywhere, not on the row and not inside the disclosure
it("expands the fraction to every member by name and state word, and a riding member's other facts render nowhere", async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // Every member by name and state word alone, in walk order from the member nearest main.
  expect(rowsHtml).toContain('<details id="chain-frontier"><summary>1/2</summary><ul><li>base-task merged</li><li>frontier building</li></ul></details>')
  // The riding member's other facts render nowhere: not its branch, not its phase word,
  // not its phase age — the account's line would carry the word and the number both.
  expect(rowsHtml).not.toContain('work/base-task')
  expect(rowsHtml).not.toContain('scout')
  expect(rowsHtml).not.toContain('5h 33m 20s')
})

// Requirement: The docket answers on a page
// Scenario: An expanded disclosure stays expanded across the page's own refresh
// GIVEN a page rendered over one answer, and its chain's disclosure standing open — the way a person's click leaves it
// WHEN the page's own refresh lands a different answer
// THEN the rows re-render with the new answer's facts and the disclosure stands open still — the page reopens what a person left open, and a list does not close while it is being read
it('keeps an expanded disclosure expanded across its own refresh', async () => {
  const page = await renderPageWith(ANSWER)
  page.openDisclosure('chain-frontier')
  page.setAnswer({ ...ANSWER, rows: ANSWER.rows.map(row => row.task === 'frontier' ? { ...row, branch: 'work/frontier-moved' } : row) })

  page.renewals[0]!()
  await page.flush()

  // The rows the refresh wrote carry the new answer's fact and the disclosure with it, and
  // the script's own reopen is what stands the flag back up: the act that opened it went
  // around the records, so the recorded write is the script's alone.
  const rowsHtml = page.elements.get('rows')?.innerHTML ?? ''
  expect(rowsHtml).toContain('work/frontier-moved')
  expect(rowsHtml).toContain('<details id="chain-frontier"')
  expect(page.elements.get('chain-frontier')?.open).toBe(true)
  expect([...page.elementWrites]).toContain('chain-frontier.open')
})

/** The answer that holds two chains at once — beta building on the merged alpha, and
 *  delta building on the merged gamma-two, which built on the merged gamma — beside a
 *  singleton sorting between the two chains' rendered members: every fixture before it
 *  held one live chain, so the carrying a refresh does had never been asked for two. */
const TWO_CHAINS: Docket = {
  rows: [
    fixtureRow('alpha', { state: 'merged' }),
    fixtureRow('beta', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'alpha', reason: 'built on it' } }),
    fixtureRow('solo', { phase: 'plan', round: 1 }),
    fixtureRow('gamma', { state: 'merged' }),
    fixtureRow('gamma-two', { state: 'merged', base: { kind: 'task', task: 'gamma', reason: 'built on it' } }),
    fixtureRow('delta', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'gamma-two', reason: 'built on it' } }),
  ],
  problems: [],
  outstanding: [],
}

// Requirement: The docket answers on a page
// Scenario: Two chains in one answer each render their own row
// GIVEN an answer holding two chains — beta building on the merged alpha, and delta building on the merged gamma-two, which built on the merged gamma — beside a singleton sorting between their two rendered members
// WHEN the page renders it
// THEN each chain answers its one row at its own rendered member's place in the name order — beta's row before the singleton's, delta's after it — each row carrying its own fraction and its own member list, and no merged member of either chain renders a row of its own: the six entries answer three rows and no fourth
it("renders each of two chains in one answer as its own row", async () => {
  const { elements } = await renderPageWith(TWO_CHAINS)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // Six entries answer three rows — one per chain and the singleton's — each chain's at
  // its own rendered member's place, with the singleton sorting between the two.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(3)
  expect(rowsHtml.indexOf('<td>beta<details')).toBeLessThan(rowsHtml.indexOf('<td>solo</td>'))
  expect(rowsHtml.indexOf('<td>solo</td>')).toBeLessThan(rowsHtml.indexOf('<td>delta<details'))
  // Each chain's own fraction and its own member list — beta's half landed, delta's two
  // thirds — and neither chain's merged members render rows of their own.
  expect(rowsHtml).toContain('<td>beta<details id="chain-beta"><summary>1/2</summary><ul><li>alpha merged</li><li>beta building</li></ul></details>')
  expect(rowsHtml).toContain('<td>delta<details id="chain-delta"><summary>2/3</summary><ul><li>gamma merged</li><li>gamma-two merged</li><li>delta building</li></ul></details>')
  expect(rowsHtml).not.toContain('<td>alpha')
  expect(rowsHtml).not.toContain('<td>gamma')
})

// Requirement: The docket answers on a page
// Scenario: Both chains' expanded disclosures stay expanded across the page's own refresh
// GIVEN a page rendered over two chains, each of its two disclosures standing open — the way a person's clicks leave them
// WHEN the page's own refresh lands a different answer holding the same two chains
// THEN the rows re-render with the new answer's facts and both disclosures stand open still — the page carries every disclosure a person left open across its redraw, not one
it("keeps both chains' expanded disclosures expanded across its own refresh", async () => {
  const page = await renderPageWith(TWO_CHAINS)
  page.openDisclosure('chain-beta')
  page.openDisclosure('chain-delta')
  page.setAnswer({ ...TWO_CHAINS, rows: TWO_CHAINS.rows.map(row => row.task === 'beta' ? { ...row, branch: 'work/beta-moved' } : row) })

  page.renewals[0]!()
  await page.flush()

  // The refresh landed and both carries did: each chain's own disclosure stands open on
  // the element the redraw wrote, each reopened by the script's own write.
  const rowsHtml = page.elements.get('rows')?.innerHTML ?? ''
  expect(rowsHtml).toContain('work/beta-moved')
  expect(page.elements.get('chain-beta')?.open).toBe(true)
  expect(page.elements.get('chain-delta')?.open).toBe(true)
  expect([...page.elementWrites]).toContain('chain-beta.open')
  expect([...page.elementWrites]).toContain('chain-delta.open')
})

// Requirement: The docket answers on a page
// Scenario: A chain's disclosure nobody opened stays closed across a refresh that reopens another's
// GIVEN a page rendered over two chains, its first chain's disclosure standing open — the way a person's click leaves it — and its second standing closed
// WHEN the page's own refresh lands a different answer holding the same two chains
// THEN the opened chain's disclosure stands open on the redrawn rows and the closed chain's stands closed still — the refresh reopens what a person left open and nothing beside it, so one chain's open list is not every chain's
it("keeps a chain's unopened disclosure closed across a refresh that reopens another's", async () => {
  const page = await renderPageWith(TWO_CHAINS)
  page.openDisclosure('chain-beta')
  page.setAnswer({ ...TWO_CHAINS, rows: TWO_CHAINS.rows.map(row => row.task === 'beta' ? { ...row, branch: 'work/beta-moved' } : row) })

  page.renewals[0]!()
  await page.flush()

  // The refresh landed — the new branch renders — and carried exactly the one disclosure a
  // person left open: beta's stands open again by the script's own write, while delta's,
  // never opened, stands closed on the redraw with no write anywhere that opened it.
  const rowsHtml = page.elements.get('rows')?.innerHTML ?? ''
  expect(rowsHtml).toContain('work/beta-moved')
  expect(page.elements.get('chain-beta')?.open).toBe(true)
  expect([...page.elementWrites]).toContain('chain-beta.open')
  expect(page.elements.get('chain-delta')?.open).toBe(false)
  expect([...page.elementWrites]).not.toContain('chain-delta.open')
})

/** The chain whose whole landing moves its row: a merged at the root, b merged on it, c
 *  building on b — one row at c's place — until c merges too and the row moves to the
 *  root a, the disclosure's id moving with it. */
const ADVANCING_CHAIN: Docket = {
  rows: [
    fixtureRow('a', { state: 'merged' }),
    fixtureRow('b', { state: 'merged', base: { kind: 'task', task: 'a', reason: 'built on it' } }),
    fixtureRow('c', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'b', reason: 'built on it' } }),
  ],
  problems: [],
  outstanding: [],
}

/** The same chain one refresh later: every member landed, so the row the redraw writes
 *  stands at the root a's place. */
const ADVANCED_CHAIN: Docket = {
  ...ADVANCING_CHAIN,
  rows: ADVANCING_CHAIN.rows.map(row => row.task === 'c' ? { ...row, state: 'merged' } : row),
}

// Requirement: The docket answers on a page
// Scenario: An open disclosure follows the chain's frontier when a refresh advances it
// GIVEN a page rendered over a chain of three — a merged, b merged, c building — whose one row's disclosure, its id naming the frontier c, stands open
// WHEN the page's own refresh lands the chain with c merged too — every member landed, so the row moves to the root a and the disclosure's id names a
// THEN the disclosure the redraw wrote stands open still — the open state a person left followed the chain itself, not the one member's id it last stood on
it("carries an open disclosure to the chain's new frontier when the refresh advances it", async () => {
  const page = await renderPageWith(ADVANCING_CHAIN)
  expect(page.elements.get('rows')?.innerHTML).toContain('<details id="chain-c"><summary>2/3</summary>')
  page.openDisclosure('chain-c')
  page.setAnswer(ADVANCED_CHAIN)

  page.renewals[0]!()
  await page.flush()

  // The whole chain landed: one muted row moves to the root's place, its disclosure's id
  // now naming a — and that disclosure stands open, carried there through the member the
  // old id named, whom the redraw's rows no longer render anywhere.
  const rowsHtml = page.elements.get('rows')?.innerHTML ?? ''
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr class="muted"><td>a<details id="chain-a"><summary>3/3</summary><ul><li>a merged</li><li>b merged</li><li>c merged</li></ul></details>')
  expect(page.elements.get('chain-a')?.open).toBe(true)
  expect([...page.elementWrites]).toContain('chain-a.open')
})

// Requirement: The docket answers on a page
// Scenario: A focused summary follows the chain's frontier when a refresh advances it
// GIVEN a page rendered over a chain of three — a merged, b merged, c building — with the keyboard's focus standing on the row's summary, whose disclosure's id names the frontier c
// WHEN the page's own refresh lands the chain with c merged too — the row moving to the root a, the disclosure's id moving with it
// THEN the focus lands on the redrawn row's summary — the script follows the chain to the id that now names it and focuses there, because a refresh that lost the focus would send the next Tab back to the page's top
it("carries a focused summary to the chain's new frontier when the refresh advances it", async () => {
  const page = await renderPageWith(ADVANCING_CHAIN)
  page.focusSummary('chain-c')
  page.setAnswer(ADVANCED_CHAIN)

  page.renewals[0]!()
  await page.flush()

  // The advance landed and the focus followed: one landing, on the summary of the
  // disclosure whose id the redraw now spells — not the old frontier's, which the redraw
  // no longer carries anywhere.
  expect(page.elements.get('rows')?.innerHTML).toContain('<tr class="muted"><td>a<details id="chain-a">')
  expect([...page.elementActs]).toEqual(['chain-a>summary.focus'])
})

// Requirement: The docket answers on a page
// Scenario: A focused summary is focused again on each refresh that repeats its chain
// GIVEN a page rendered over one answer, with the keyboard's focus standing on its chain's summary
// WHEN the page's own refresh lands a different answer holding the same chain — and another lands after it
// THEN each refresh focuses the redrawn row's summary again, once per refresh — so the focus a refresh carries is still standing for the next refresh to carry, and not only the first redraw's own landing
it('focuses the summary again on each refresh that repeats its chain', async () => {
  const page = await renderPageWith(ANSWER)
  page.focusSummary('chain-frontier')
  page.setAnswer({ ...ANSWER, rows: ANSWER.rows.map(row => row.task === 'frontier' ? { ...row, branch: 'work/frontier-moved' } : row) })

  page.renewals[0]!()
  await page.flush()
  const rowsHtml = page.elements.get('rows')?.innerHTML ?? ''
  expect(rowsHtml).toContain('work/frontier-moved')
  expect([...page.elementActs]).toEqual(['chain-frontier>summary.focus'])

  page.renewals[0]!()
  await page.flush()
  // The second refresh found the focus the first one placed — a focus written before
  // the swap, onto the summary the swap tore down, would leave nothing standing for this
  // refresh to carry, and no second landing to record.
  expect([...page.elementActs]).toEqual(['chain-frontier>summary.focus', 'chain-frontier>summary.focus'])
})

// Requirement: The docket answers on a page
// Scenario: A merged entry no entry names keeps its own row, shown muted
// GIVEN an answer holding a merged TASK no other entry's base names, beside a standing chain and a standing singleton
// WHEN the page renders it
// THEN the merged TASK keeps a row of its own, shown muted, carrying its facts as any row does — until a scheduling pass prunes its entry — and the standing rows open as a plain tr: the chain's rendered frontier and the singleton alike, the muting the landed row's own fact and not the renderer's habit
it('keeps a merged entry no entry names as its own row, shown muted', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  expect(rowsHtml).toContain('<tr class="muted"><td>settled</td>')
  expect(rowsHtml).toContain('<td>settled</td><td><span class="muted">no phase</span></td>')
  expect(rowsHtml).toContain('work/settled <span class="muted">from main</span>')
  // The standing rows answer the muted one, spelled exactly: the chain's rendered
  // frontier and the plain singleton both open with a bare tr — no muting class — so the
  // two spellings are two rows' facts, not one renderer's habit.
  expect(rowsHtml).toContain('<tr><td>frontier')
  expect(rowsHtml).toContain('<tr><td>alpha')
})

// Requirement: The docket answers on a page
// Scenario: A chain whose every member has merged renders that one muted row
// GIVEN an answer holding a chain of two TASKs, both merged
// WHEN the page renders it
// THEN it renders that one row — the member nearest main, shown muted — the fraction reading the whole chain landed and the disclosure naming every member, and neither member renders a row of its own
it('renders a chain whose every member has merged as that one muted row', async () => {
  const landed: Docket = {
    rows: [
      fixtureRow('done-root', { state: 'merged' }),
      fixtureRow('done-tip', { state: 'merged', base: { kind: 'task', task: 'done-root', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(landed)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr class="muted"><td>done-root<details id="chain-done-root"><summary>2/2</summary>')
  expect(rowsHtml).toContain('<li>done-root merged</li><li>done-tip merged</li>')
  expect(rowsHtml).not.toContain('<td>done-tip')
})

// Requirement: The docket answers on a page
// Scenario: A chain whose in-progress member is queued renders its row there, not at its merged root
// GIVEN an answer holding a merged TASK and a queued TASK whose base names it — the member nearest main whose state word is not merged is the queued one
// WHEN the page renders it
// THEN the chain answers one row at the queued member's place, unmuted, its fraction 1/2 and its disclosure naming both members — not at the merged member's place, muted: in progress means any word but merged, not building alone
it("renders a chain whose in-progress member is queued at that member's place, unmuted", async () => {
  const held: Docket = {
    rows: [
      fixtureRow('held-base', { state: 'merged' }),
      fixtureRow('held-child', { state: 'queued', base: { kind: 'task', task: 'held-base', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(held)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The one row stands at the queued member's place and opens unmuted — a bare tr — the
  // member nearest main that is not merged, whatever word it carries.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr><td>held-child<details')
  expect(rowsHtml).toContain('<details id="chain-held-child"><summary>1/2</summary>')
  expect(rowsHtml).toContain('<li>held-base merged</li><li>held-child queued</li>')
  // The merged root rides the row — its name stands only inside the disclosure — and the
  // row does not fall back to its place, muted.
  expect(rowsHtml).not.toContain('<td>held-base')
  expect(rowsHtml).not.toContain('<tr class="muted">')
})

// Requirement: The docket answers on a page
// Scenario: A chain whose in-progress member is blocked on a question renders its row there, not at its merged root
// GIVEN an answer holding a merged TASK and a blocked-on-question TASK whose base names it — the member nearest main whose state word is not merged is the blocked one
// WHEN the page renders it
// THEN the chain answers one row at the blocked member's place, unmuted, its fraction 1/2 and its disclosure naming both members — not at the merged member's place, muted: in progress means any word but merged, the queue's own blocked word among them
it("renders a chain whose in-progress member is blocked on a question at that member's place, unmuted", async () => {
  const questioned: Docket = {
    rows: [
      fixtureRow('asked-base', { state: 'merged' }),
      fixtureRow('asked-child', { state: 'blocked-on-question', base: { kind: 'task', task: 'asked-base', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(questioned)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The one row stands at the blocked member's place and opens unmuted — the member nearest
  // main that is not merged, whatever word it carries.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr><td>asked-child<details')
  expect(rowsHtml).toContain('<details id="chain-asked-child"><summary>1/2</summary>')
  expect(rowsHtml).toContain('<li>asked-base merged</li><li>asked-child blocked-on-question</li>')
  // The merged root rides the row — its name stands only inside the disclosure — and the
  // row does not fall back to its place, muted.
  expect(rowsHtml).not.toContain('<td>asked-base')
  expect(rowsHtml).not.toContain('<tr class="muted">')
})

// Requirement: The docket answers on a page
// Scenario: A fork — two TASKs stacked on the same merged base — is one chain answering one row
// GIVEN an answer holding a merged TASK with two TASKs built on it at once — a fork, not a line — the two children arriving in the name order the rows carry
// WHEN the page renders it
// THEN the entries so linked form one chain and answer ONE row, standing at the first tip's place the name-ordered walk reaches — fork-b's, not fork-c's — unmuted, its fraction 1/3, its disclosure listing all three members in walk order, and neither the merged base nor the second tip renders a row of its own
it('renders a fork on one merged base as one row at the first tip the walk reaches', async () => {
  const forked: Docket = {
    rows: [
      fixtureRow('fork-base', { state: 'merged' }),
      fixtureRow('fork-b', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'fork-base', reason: 'built on it' } }),
      fixtureRow('fork-c', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'fork-base', reason: 'built on it too' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(forked)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The whole fork answers one row — the three entries one chain — standing at the first
  // tip the name-ordered walk reaches, unmuted, its fraction counting the landed base over
  // all three members, its disclosure listing them in walk order: the base, then each tip.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr><td>fork-b<details id="chain-fork-b"><summary>1/3</summary><ul><li>fork-base merged</li><li>fork-b building</li><li>fork-c building</li></ul></details>')
  // Neither the merged base nor the second tip renders a row of its own — a renderer that
  // answered a row per branch-tip would spell fork-c's name cell here.
  expect(rowsHtml).not.toContain('<td>fork-base')
  expect(rowsHtml).not.toContain('<td>fork-c')
})

// Requirement: The docket answers on a page
// Scenario: An entry whose base names a TASK not on the queue keeps its own row
// GIVEN an answer holding an entry whose base names a TASK that is not on the queue
// WHEN the page renders it
// THEN it keeps its own row — no fraction, no disclosure — the base a fact the row records rather than a link the page follows
it('keeps an entry whose base names a TASK not on the queue as its own row', async () => {
  const { elements } = await renderPageWith(ANSWER)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // The TASK cell closes on the name — nothing rides — and the base stands as the row's
  // recorded fact, naming a TASK the queue no longer holds.
  expect(rowsHtml).toContain('<td>stacked</td><td><span class="phase">plan</span></td><td>1</td>')
  expect(rowsHtml).toContain('<span class="muted">from other-task</span>')
})

// Requirement: The docket answers on a page
// Scenario: A chain runs through a root whose own base names a TASK not on the queue
// GIVEN an answer holding a merged TASK whose base names a TASK that is not on the queue, and a building TASK whose base names that merged one
// WHEN the page renders it
// THEN the two form one chain of two — the dormant base links the root to nothing, so the root is a root like any other — answering one row at the building member's place, unmuted, its fraction 1/2, its disclosure naming both members, and no row at the merged member's name cell
it('runs a chain through a root whose own base names a TASK not on the queue', async () => {
  const waiting: Docket = {
    rows: [
      fixtureRow('waitbase', { state: 'merged', base: { kind: 'task', task: 'dormant', reason: 'built on it' } }),
      fixtureRow('waitchild', { phase: 'build-green', round: 1, base: { kind: 'task', task: 'waitbase', reason: 'built on it' } }),
    ],
    problems: [],
    outstanding: [],
  }
  const { elements } = await renderPageWith(waiting)
  const rowsHtml = elements.get('rows')?.innerHTML ?? ''

  // One chain of two, one row at the building member's place, opening unmuted: the
  // dormant name links the merged member to nothing, so a member another TASK rides is a
  // root whatever its own base names.
  expect((rowsHtml.match(/<tr/g) ?? []).length).toBe(1)
  expect(rowsHtml).toContain('<tr><td>waitchild<details')
  expect(rowsHtml).toContain('<details id="chain-waitchild"><summary>1/2</summary>')
  expect(rowsHtml).toContain('<li>waitbase merged</li><li>waitchild building</li>')
  // The merged member rides the row — its name stands only inside the disclosure, never
  // as a row of its own.
  expect(rowsHtml).not.toContain('<td>waitbase')
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

  expect(rowsHtml).toContain('<td>work/branched <span class="muted">from main</span></td>')
  // The coinciding branch renders nowhere: were it spelled, plain's branch cell would open
  // with the name and the space that precedes a base label.
  expect(rowsHtml).toContain('<td><span class="muted">from main</span></td>')
  expect(rowsHtml).not.toContain('<td>plain <span')
})

/** The phase-totals cell one row carries — the last cell the row holds, so the row's own
 *  boundaries frame it. */
function accountCellOf(rowsHtml: string, task: string): string {
  const row = new RegExp(`<tr(?: class="muted")?><td>${task}</td>[\\s\\S]*?</tr>`).exec(rowsHtml)?.[0]
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
        base: { kind: 'main' },
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
// THEN each record's TASK, branch, and base show, the moments are spelled without milliseconds, and how long each TASK lived stands as its own column in the page's own age spelling — with the records in the answer's start order, latest first: the later start above the earlier, whatever the names, the settled moments, or the lived spans say
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
      base: { kind: 'task', task: 'zeta', reason: 'stacked on it' },
      enqueuedAt: '2025-01-01T09:50:00.123Z',
      settledAt: '2025-01-01T10:20:00.123Z',
      livedSeconds: 30 * 60,
      phaseHistory: null,
      phaseAccount: null,
    },
    {
      task: 'zeta',
      branch: 'work/zeta',
      base: { kind: 'main' },
      enqueuedAt: '2025-01-01T09:35:00.000Z',
      settledAt: '2025-01-01T10:50:00.000Z',
      livedSeconds: 75 * 60,
      phaseHistory: null,
      phaseAccount: null,
    },
    {
      task: 'alpha',
      branch: 'work/alpha',
      base: { kind: 'main' },
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
  expect(archived).toContain('<td>bravo</td><td>work/bravo <span class="muted">from zeta</span></td>')
  expect(archived).toContain('<td>zeta</td><td>work/zeta <span class="muted">from main</span></td>')
  expect(archived).toContain('<td>alpha</td><td>work/alpha <span class="muted">from main</span></td>')
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
      base: { kind: 'main' },
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
// THEN its markup carries every fact as content a browser shows before any script runs — the chain's fraction and the riding members' names among it, the round standing in a column of its own — the page is the view asked again, not an empty shell around a script
it('carries the docket\'s facts as visible content in the markup it ships', () => {
  const markup = shippedMarkup()

  expect(markup).toContain(htmlEscaped(ATTACH))
  expect(markup).toContain('test-review')
  expect(markup).toContain('round 2')
  expect(markup).toContain('through round 3')
  expect(markup).toContain(htmlEscaped('task broken has no MANIFEST'))
  expect(markup).toContain(htmlEscaped(RULING.answerWith))
  // The chain rides the shipped markup as content too — the bare fraction, the riding
  // members' names — and the round stands in a column of its own beside the phase word's.
  expect(markup).toContain('<th scope="col">round</th>')
  expect(markup).toContain('<summary>1/2</summary>')
  expect(markup).toContain('<li>base-task merged</li>')
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
  // never held, and the phase word, the one place the signal shows on a row, stays wired
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
 *  completed records are two tables, and a header must answer for its own rows alone. */
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
// GIVEN the docket's page, and answers that walk every rendering branch it holds — a chain's disclosure left open, a chain's summary keyboard-focused, a copy's selection holding a refresh, and a refresh advancing a chain under a standing focus among them
// WHEN it is read as the HTML it is, and its script is run the way a browser runs it — against answers, and against a network that fails
// THEN it offers no control that runs anything — no element beyond the ones it was written with, in the markup it ships or the HTML it renders, nor any attribute that carries a value beyond the ones it was written with, nor any stylesheet import or url or javascript: scheme anywhere, and its script touches no global but the document, the fetches of /docket and /archive, the timer that renews them, and the arithmetic it spells ages with — whether the fetches answer or fail — reads nothing off the document but the element lookup, the live selection the copy guard asks after — and, while one lives, the body its walk climbs to — and the focus it asks the document for, reads nothing off an element but the open state of the disclosures it carries, the parent the live selection's walk climbs by, and, while a summary stands focused and its chain redraws, the summary facts the carry needs — the tag, the parent, the parent's id, and the first element it focuses, whichever id the redraw leaves the carry to follow — invokes nothing on an element but that one focus, once per refresh that carries it, and writes nothing to one but the text, the visibility, and the open flag it reopens a carried disclosure with
it('offers no control that runs anything', async () => {
  const page = docketPage(ANSWER, ARCHIVE)
  const run = await renderPageWith(ANSWER)
  const rendered = [...run.elements.keys()].map(id => run.innerHtmlOf(id)).join('')
  const offline = await renderPageOffline()

  // The whole inventory of the markup it ships: every element name and every valued
  // attribute the page was written with, before and after its script alike. A control, a
  // request door, or any element at all, arrives as a name this list would have to carry —
  // the shipped rows, completed records, problems, and rulings included, for they are
  // content, not controls.
  expect(elementNames(shippedMarkup())).toEqual(['body', 'br', 'code', 'details', 'h1', 'h2', 'head', 'html', 'li', 'meta', 'p', 'span', 'style', 'summary', 'table', 'tbody', 'td', 'th', 'thead', 'title', 'tr', 'ul'])
  expect(valuedAttributeNames(shippedMarkup())).toEqual(['aria-labelledby', 'charset', 'class', 'content', 'id', 'initial-scale', 'lang', 'name', 'scope'])
  // The same inventory of the HTML its script renders for the branch-walking answer —
  // nothing the page can build carries an element or a valued attribute beyond these.
  expect(elementNames(rendered)).toEqual(['br', 'code', 'details', 'li', 'span', 'summary', 'td', 'tr', 'ul'])
  expect(valuedAttributeNames(rendered)).toEqual(['class', 'id'])
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
  // tree reads it, the collapsed check before it does not — and no selection has lived
  // yet in this run: the held-refresh leg below carries it in.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentReads].sort()).toEqual(['activeElement', 'getElementById', 'getSelection'])
  expect([...run.documentWrites]).toEqual([])
  expect([...run.elementReads].sort()).toEqual([
    'chain-alpha.open',
    'chain-base-task.open',
    'chain-frontier.open',
    'chain-settled.open',
    'chain-stacked.open',
  ])
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
  // The one write besides text and visibility the script performs: the reopen of a
  // disclosure a person left open, on the refresh that carries it across the swap. The
  // act that stood the element open went around the records, so the write the refresh
  // lands in them is the script's own.
  run.openDisclosure('chain-frontier')
  run.renewals[0]!()
  await run.flush()
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'chain-frontier.open',
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
  // The focus path runs at last: a summary a person's keyboard focused, carried across
  // the refresh that repeats its chain. The carry's whole reach joins the element
  // inventory — the summary's tag and parent, the parent's id, the first element it
  // focuses — and its one focus lands as an element act, recorded apart from the writes,
  // once per refresh that carries it.
  run.focusSummary('chain-frontier')
  run.renewals[0]!()
  await run.flush()
  expect([...run.elementActs]).toEqual(['chain-frontier>summary.focus'])
  expect([...run.elementReads].sort()).toEqual([
    'chain-alpha.open',
    'chain-base-task.open',
    'chain-frontier.firstElementChild',
    'chain-frontier.id',
    'chain-frontier.open',
    'chain-frontier>summary.focus',
    'chain-frontier>summary.parentNode',
    'chain-frontier>summary.tagName',
    'chain-settled.open',
    'chain-stacked.open',
  ])
  // The copy guard's branch runs at last: a selection live inside the rows, held against
  // one refresh and cleared before the next. The walk joins the inventories — the body it
  // climbs to, the parent it climbs by — and the held refresh itself reaches for nothing
  // else: no probe, no swap, no focus read, which is the very fact the copy scenario
  // stands on.
  run.selectWithin('rows')
  run.renewals[0]!()
  await run.flush()
  expect([...run.documentReads].sort()).toEqual(['activeElement', 'body', 'getElementById', 'getSelection'])
  expect([...run.elementReads].sort()).toEqual([
    'chain-alpha.open',
    'chain-base-task.open',
    'chain-frontier.firstElementChild',
    'chain-frontier.id',
    'chain-frontier.open',
    'chain-frontier>summary.focus',
    'chain-frontier>summary.parentNode',
    'chain-frontier>summary.tagName',
    'chain-settled.open',
    'chain-stacked.open',
    'rows.parentNode',
  ])
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'chain-frontier.open',
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
  expect([...run.elementActs]).toEqual(['chain-frontier>summary.focus'])
  run.clearSelection()
  run.renewals[0]!()
  await run.flush()
  // The refresh after the copy ends is the ordinary path again: one more landing, on the
  // summary the redraw spells again.
  expect([...run.elementActs]).toEqual(['chain-frontier>summary.focus', 'chain-frontier>summary.focus'])
  // The carry's miss branch runs at last: the chain advancing under the standing focus,
  // the redraw moving the disclosure's id off the member the old one named. The
  // resolution's group walk is pure arithmetic on the answer; the reads that are not —
  // the carried disclosure's first element, the focus its summary reads to land — join
  // the inventories, and the open flag follows the chain as the open-carry scenario
  // showed.
  run.setAnswer({
    ...ANSWER,
    rows: ANSWER.rows.map(row => (row.task === 'frontier' ? { ...row, state: 'merged' } : row)),
  })
  run.renewals[0]!()
  await run.flush()
  expect([...run.elementActs]).toEqual([
    'chain-frontier>summary.focus',
    'chain-frontier>summary.focus',
    'chain-base-task>summary.focus',
  ])
  expect([...run.documentReads].sort()).toEqual(['activeElement', 'body', 'getElementById', 'getSelection'])
  // No branch the walk added reaches past the families claimed above — no global, no
  // document write, nothing the answering paths never touched.
  expect([...run.touched].sort()).toEqual(['Math', 'document', 'fetch', 'setInterval'])
  expect([...run.documentWrites]).toEqual([])
  expect([...run.elementReads].sort()).toEqual([
    'chain-alpha.open',
    'chain-base-task.firstElementChild',
    'chain-base-task.open',
    'chain-base-task>summary.focus',
    'chain-frontier.firstElementChild',
    'chain-frontier.id',
    'chain-frontier.open',
    'chain-frontier>summary.focus',
    'chain-frontier>summary.parentNode',
    'chain-frontier>summary.tagName',
    'chain-settled.open',
    'chain-stacked.open',
    'rows.parentNode',
  ])
  expect([...run.elementWrites].sort()).toEqual([
    'archive-empty.hidden',
    'archive-rows.innerHTML',
    'chain-base-task.open',
    'chain-frontier.open',
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
