import type { ArchiveRecord, Docket, DocketRow, OutstandingRuling, PhaseAccountEntry } from './view.ts'

/**
 * The docket's page: the view's answer spelled for a browser. Pure content — a string, not
 * a server — because the docket reads no files and runs no processes; `cli` owns the socket
 * the page arrives on, the same split the view itself keeps.
 *
 * The page is written with its answer already in it: the rows, the problems, the rulings,
 * and the completed records ship as content a browser shows before any script runs — the
 * page is the view asked again, not an empty shell around a script. The rows ship as
 * chains, not one flat row per queue entry: a TASK built on another TASK's worktree waits
 * for that TASK to merge, so the linked entries are one stream of work and render one row —
 * the row of the member nearest main still in progress — with the chain's merged members
 * and queued ones riding it behind a fraction, and a merged entry nothing names keeping a
 * muted row of its own until a pass prunes it. The script inline in the page is the whole
 * of the page's behavior after that: it asks `/docket` and `/archive` again on its own,
 * renders exactly the answers it last received, and does nothing else. It keeps no clock of
 * its own — an age the browser inflated between answers would be a performance of the fact
 * rather than the fact — and no control that runs anything: every action the queue knows
 * how to take has a command that takes it, and the page shows those commands as text rather
 * than becoming a second place to run them. The exceptions it makes to re-rendering
 * everything: while a person's text selection lives anywhere on the page, the whole answer
 * is left standing for that round — the commands this page shows are meant to be copied,
 * and a refresh that tore a selection out from under the copy would defeat the page's own
 * copy affordance — and a disclosure a person left open is reopened on the rows the redraw
 * writes, because a list that collapsed on every refresh would close while it was read;
 * the summary a person's keyboard focused is carried across the swap the same way —
 * following the id to the chain's new frontier when the redraw advances it — because
 * a refresh that lost it would send the next Tab back to the page's top.
 *
 * The shipped rows and the script-rendered rows come from two renderers — one spelled in
 * TypeScript for the markup the server answers, one in JavaScript for the refresh — that
 * `tests/docket/page.test.ts` holds to the same bytes for the same answer, so the two cannot
 * drift apart.
 */

/** How often the page asks again, on its own: short enough that a watched queue stays
 *  current, long enough that a page left open is a handful of requests a minute. */
export const PAGE_REFRESH_MILLISECONDS = 2000

/** The page a browser opens, in the order the work is read: the queue's rows, the problems
 *  that kept a TASK off the rows, the rulings still outstanding with the command that pays
 *  each, and — last — the completed TASKs the archive holds, because debt reads before
 *  history. */
export function docketPage(report: Docket, archive: readonly ArchiveRecord[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Docket</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1f2328;
    --muted: #4d555d;
    --faded: #6b7480;
    --line: #d9dee4;
    --head-line: #b8c0c8;
    --signal: #704700;
    --code-bg: #e6eaf0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16181d;
      --fg: #d4d9e1;
      --muted: #9aa2ad;
      --faded: #78828e;
      --line: #2b303a;
      --head-line: #3d4450;
      --signal: #e3b341;
      --code-bg: #262b33;
    }
  }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    background: var(--bg);
    color: var(--fg);
    margin: 2rem;
  }
  h1 { font-size: 1.4rem; margin: 0 0 0.4rem; }
  h2 { font-size: 1.05rem; margin: 1.3rem 0 0.35rem; }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: var(--code-bg);
    padding: 0.1rem 0.3rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .phase { color: var(--signal); }
  .muted { color: var(--muted); }
  tr.muted td, tr.muted .muted, tr.muted .phase { color: var(--faded); }
  tr.muted code { color: var(--muted); }
  tr.muted td:first-child { font-weight: 400; }
  h2 .muted { font-size: 0.8rem; font-weight: normal; }
  table { border-collapse: collapse; width: 100%; }
  th, td { padding: 0.45rem 1rem 0.45rem 0; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  thead th { border-bottom: 1px solid var(--head-line); }
  tbody td { border-bottom: 1px solid var(--line); }
  tbody td:first-child { font-weight: 600; }
  details { margin-top: 0.35rem; }
  summary { cursor: pointer; }
  details ul { margin: 0.25rem 0 0; list-style: none; padding-left: 0; }
  details li { padding: 0.1rem 0; }
  #rulings li { padding: 0.4rem 0; }
  #rulings li code {
    display: block;
    margin-top: 0.3rem;
    border-left: 3px solid var(--muted);
    padding: 0.25rem 0.6rem;
  }
  @media (max-width: 640px) {
    body { margin: 1rem; }
    th, td { padding: 0.35rem 0.5rem 0.35rem 0; }
  }
</style>
</head>
<body>
<h1>Docket</h1>
<h2 id="queue-heading">queue</h2>
<p id="empty"${report.rows.length === 0 ? '' : ' hidden'}>no TASK in the queue</p>
<table id="queue-table" aria-labelledby="queue-heading"${report.rows.length === 0 ? ' hidden' : ''}>
  <thead>
    <tr><th scope="col">TASK</th><th scope="col">phase</th><th scope="col">round</th><th scope="col">branch</th><th scope="col">in phase</th><th scope="col">last move</th><th scope="col">session</th><th scope="col">phase totals</th></tr>
  </thead>
  <tbody id="rows">${chainGroups(report.rows).map(serverRowHtml).join('')}</tbody>
</table>
<h2 id="problems-heading"${report.problems.length === 0 ? ' hidden' : ''}>problems</h2>
<ul id="problems" aria-labelledby="problems-heading"${report.problems.length === 0 ? ' hidden' : ''}>${report.problems.map(serverProblemHtml).join('')}</ul>
<h2 id="rulings-heading"${report.outstanding.length === 0 ? ' hidden' : ''}>rulings outstanding</h2>
<ul id="rulings" aria-labelledby="rulings-heading"${report.outstanding.length === 0 ? ' hidden' : ''}>${report.outstanding.map(serverRulingHtml).join('')}</ul>
<h2 id="completed-heading">completed <span class="muted">enqueued latest first</span></h2>
<p id="archive-empty"${archive.length === 0 ? '' : ' hidden'}>no completed TASK yet</p>
<table id="completed-table" aria-labelledby="completed-heading"${archive.length === 0 ? ' hidden' : ''}>
  <thead>
    <tr><th scope="col">TASK</th><th scope="col">branch</th><th scope="col">enqueued</th><th scope="col">settled</th><th scope="col">lived</th><th scope="col">phase totals</th></tr>
  </thead>
  <tbody id="archive-rows">${archive.map(serverArchiveRowHtml).join('')}</tbody>
</table>
<script>
${pageScript()}
</script>
</body>
</html>
`
}

// --- the shipped half of the page, spelled in TypeScript --------------------------------
//
// Every function below mirrors its JavaScript twin inside pageScript byte for byte — the
// page test holds them to that, so a change on one side that misses the other fails the
// build rather than shipping two pages.

/** One chain the page renders as one row: the members that form it, in walk order — the
 *  member nearest main first, the tips last — and the member the row renders. */
type ChainGroup = {
  readonly rendered: DocketRow
  readonly members: readonly DocketRow[]
}

/** The TASK a row's base links it to — the one its worktree was deliberately built on — or
 *  null when the row links nothing: a base of `main`, or one naming a TASK that is not on
 *  the queue. Such an entry is its own chain of one. */
function linkedBaseName(row: DocketRow, rows: readonly DocketRow[]): string | null {
  if (row.base.kind !== 'task') return null
  const baseTask = row.base.task
  return rows.some(other => other.task === baseTask) ? baseTask : null
}

/** The member a chain's row renders: the first in walk order whose state is not `merged` —
 *  the member nearest main — or the root itself when every member has merged. */
function memberToRender(members: readonly DocketRow[]): DocketRow {
  const inProgress = members.find(member => member.state !== 'merged')
  return inProgress ?? members[0]!
}

/** The chains the rows carry: one per root — the member nearest main, whose own base
 *  links it to nothing on the queue — walked depth-first with children (the members built
 *  on it) in the name order the rows arrive in; the view's own sort stands, the rows are
 *  not re-sorted here. A member of a corrupt cycle, reachable from no root, falls back to
 *  its own chain of one. Groups come back in the name order of the member each renders,
 *  so each chain's row stands where the JSON's rows already carry it. */
function chainGroups(rows: readonly DocketRow[]): readonly ChainGroup[] {
  const groups: ChainGroup[] = []
  const walk = (member: DocketRow, members: DocketRow[]): void => {
    if (members.includes(member)) return
    members.push(member)
    const children = rows.filter(row => linkedBaseName(row, rows) === member.task)
    for (const child of children) walk(child, members)
  }
  rows.forEach(row => {
    // A member that links to another is that member's child, not a root.
    if (linkedBaseName(row, rows) !== null) return
    const members: DocketRow[] = []
    walk(row, members)
    groups.push({ rendered: memberToRender(members), members })
  })
  rows.forEach(row => {
    const chained = groups.some(group => group.members.includes(row))
    if (chained) return
    groups.push({ rendered: row, members: [row] })
  })
  // One group per row, in the order the rows carry their rendered members: the first group
  // that renders each row — the same single pick the script twin's loop makes, so the two
  // renderers cannot drift apart here.
  return rows.flatMap(row => {
    const group = groups.find(candidate => candidate.rendered === row)
    return group === undefined ? [] : [group]
  })
}

/** The HTML-escaped spelling of a string, the same five characters HTML gives entities to. */
function serverEscapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
}

/** An age spelled from answered seconds alone — the same spelling the script's own `age`
 *  writes, so the shipped row and the refreshed row read identically. */
function serverAge(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** A moment as the page spells it: the record's own ISO string with the milliseconds trimmed —
 *  a precision a person reading the page does not use, kept whole in the JSON a program reads.
 *  The pattern spells its dot and its digits in character classes on purpose: the script twin
 *  below lives inside a template literal, where an escaped dot would be eaten as a string
 *  escape — a backslash-free pattern is the one spelling both halves can share exactly. */
function serverMoment(iso: string): string {
  return serverEscapeHtml(iso.replace(/[.][0-9]{3}Z$/, 'Z'))
}

function serverBaseLabel(base: DocketRow['base']): string {
  return base.kind === 'main' ? 'main' : base.task
}

/** One word's line of a phase account: the word, its total time, and — only when the word
 *  stood past round 1 — the highest round it reached, spelled as a point reached rather
 *  than the present-tense `round N` the round column three cells left already means (rounds
 *  count the TASK's whole pipeline, so a word's highest round is a point it reached, not a
 *  count of its own standings). The same spelling the script twin below writes, so the
 *  shipped cell and the refreshed cell read identically. */
function serverAccountFragment(entry: PhaseAccountEntry): string {
  const fragment = `${serverEscapeHtml(entry.word)} ${serverAge(entry.totalSeconds)}`
  return entry.roundsReached > 1 ? `${fragment} through round ${entry.roundsReached}` : fragment
}

/** A phase account as the page spells it: one fragment per word, first-standing order, a
 *  fragment per line — or the row's own word-shaped absence when no history stands, the
 *  same vocabulary `no phase` and `no session` keep (`—` stays the age columns' absence). */
function serverPhaseAccountHtml(account: readonly PhaseAccountEntry[] | null | undefined): string {
  if (account === null || account === undefined) return '<span class="muted">no phases</span>'
  return account.map(serverAccountFragment).join('<br>')
}

/** The TASK cell of a chain's one row: the rendered member's escaped name and — only when
 *  members ride the row — the disclosure that carries them: the bare fraction of the chain
 *  that has merged, and behind it every member by name and state word, the one place on the
 *  page a state word shows. The disclosure's id is built from the rendered member's name,
 *  the id the refresh reads an open disclosure back by. */
function serverTaskCellHtml(group: ChainGroup): string {
  const name = serverEscapeHtml(group.rendered.task)
  if (group.members.length === 1) return `<td>${name}</td>`
  const merged = group.members.filter(member => member.state === 'merged').length
  const riding = group.members
    .map(member => `<li>${serverEscapeHtml(member.task)} ${serverEscapeHtml(member.state)}</li>`)
    .join('')
  return `<td>${name}<details id="chain-${name}"><summary>${merged}/${group.members.length}</summary><ul>${riding}</ul></details></td>`
}

function serverRowHtml(group: ChainGroup): string {
  const row = group.rendered
  const phase = row.phase === null
    ? '<span class="muted">no phase</span>'
    : `<span class="phase">${serverEscapeHtml(row.phase)}</span>`
  // The round is null exactly when the phase is — the view's own construction couples them
  // (round falls back to null with the phase), so the phase's own check covers the round's
  // absence too.
  const round = row.phase === null
    ? '<span class="muted">—</span>'
    : String(row.round)
  const branch = row.branch === row.task ? '' : `${serverEscapeHtml(row.branch)} `
  const inPhase = row.phaseAgeSeconds === null
    ? '<span class="muted">—</span>'
    : serverAge(row.phaseAgeSeconds)
  const move = row.heartbeatAgeSeconds === null
    ? '<span class="muted">no heartbeat</span>'
    : serverAge(row.heartbeatAgeSeconds)
  const account = serverPhaseAccountHtml(row.phaseAccount)
  const session = row.session.listed
    ? `<code>${serverEscapeHtml(row.session.attach)}</code>`
    : '<span class="muted">no session</span>'
  // One muting rule covers the lone merged entry and the all-merged chain alike: the row a
  // chain renders is muted exactly when the member it renders has merged, which happens
  // only when every member of the chain has.
  const openTag = row.state === 'merged' ? '<tr class="muted">' : '<tr>'
  return openTag
    + serverTaskCellHtml(group)
    + `<td>${phase}</td>`
    + `<td>${round}</td>`
    + `<td>${branch}<span class="muted">from ${serverEscapeHtml(serverBaseLabel(row.base))}</span></td>`
    + `<td>${inPhase}</td>`
    + `<td>${move}</td>`
    + `<td>${session}</td>`
    + `<td>${account}</td>`
    + '</tr>'
}

function serverProblemHtml(problem: { readonly task: string; readonly reason: string }): string {
  return `<li>${serverEscapeHtml(problem.task)}: ${serverEscapeHtml(problem.reason)}</li>`
}

function serverArchiveRowHtml(record: ArchiveRecord): string {
  return '<tr>'
    + `<td>${serverEscapeHtml(record.task)}</td>`
    + `<td>${serverEscapeHtml(record.branch)} <span class="muted">from ${serverEscapeHtml(serverBaseLabel(record.base))}</span></td>`
    + `<td>${serverMoment(record.enqueuedAt)}</td>`
    + `<td>${serverMoment(record.settledAt)}</td>`
    + `<td>${serverAge(record.livedSeconds)}</td>`
    + `<td>${serverPhaseAccountHtml(record.phaseAccount)}</td>`
    + '</tr>'
}

function serverRulingHtml(ruling: OutstandingRuling): string {
  const shared = ruling.node === null
    ? 'a relationship this key does not name'
    : `${serverEscapeHtml(ruling.node.kind)} "${serverEscapeHtml(ruling.node.name)}"`
  const tasks = ruling.tasks.length === 0
    ? ''
    : ` shared by ${ruling.tasks.map(serverEscapeHtml).join(', ')}`
  return `<li>${shared}${tasks}<code>${serverEscapeHtml(ruling.answerWith)}</code></li>`
}

/** The page's own behavior, as one immediately-invoked function the browser runs on open.
 *  Built by concatenation, not nested template literals, so the script stays readable as
 *  the JavaScript a browser reads rather than as escaping around it. */
function pageScript(): string {
  return `(function () {
  'use strict'

  // An age spelled from the answered seconds alone. The browser keeps no clock, so a number
  // never moves between answers: it changes when the next answer changes it, and not before.
  function age(seconds) {
    var h = Math.floor(seconds / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    var s = seconds % 60
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's'
    if (m > 0) return m + 'm ' + s + 's'
    return s + 's'
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    })
  }

  function baseLabel(base) {
    return base.kind === 'main' ? 'main' : base.task
  }

  // One word's line of a phase account — the same spelling the shipped half's
  // serverAccountFragment writes, so the two renderers stay byte for byte.
  function accountFragment(entry) {
    var fragment = escapeHtml(entry.word) + ' ' + age(entry.totalSeconds)
    if (entry.roundsReached > 1) fragment += ' through round ' + entry.roundsReached
    return fragment
  }

  function phaseAccountHtml(account) {
    if (account === null || account === undefined) return '<span class="muted">no phases</span>'
    return account.map(accountFragment).join('<br>')
  }

  // A moment as the page spells it — the record's own ISO string with the milliseconds
  // trimmed, the same trim the shipped half makes, so the two renderers stay byte for byte.
  // The character-class pattern matches the shipped half's for the same reason it gives:
  // this script lives inside a template literal, where an escaped dot would be eaten.
  function moment(iso) {
    return escapeHtml(iso.replace(/[.][0-9]{3}Z$/, 'Z'))
  }

  // The TASK a row's base links it to — the one its worktree was deliberately built on — or
  // null when the row links nothing: a base of main, or one naming a TASK that is not on
  // the queue. Such an entry is its own chain of one. The same rule the shipped half's
  // linkedBaseName keeps, so the two renderers stay byte for byte.
  function linkedBaseName(row, rows) {
    if (row.base.kind !== 'task') return null
    var baseTask = row.base.task
    var onQueue = rows.some(function (other) { return other.task === baseTask })
    return onQueue ? baseTask : null
  }

  // The member a chain's row renders — the same rule the shipped half's memberToRender
  // keeps, so the two renderers stay byte for byte.
  function memberToRender(members) {
    var inProgress = members.filter(function (member) { return member.state !== 'merged' })
    return inProgress.length > 0 ? inProgress[0] : members[0]
  }

  // The chains the rows carry, one row each — the same walk the shipped half's chainGroups
  // keeps, so the two renderers stay byte for byte. The root of a chain is the member
  // nearest main, the one whose own base links it to nothing; a member that links to
  // another is that member's child. Nothing here keys a dictionary by task name: members
  // are tracked by the row objects themselves, and the script's whole reach stays the
  // globals it already touched. Each row is answered by the first group that renders it —
  // the same single pick the shipped half's find makes.
  function chainGroups(rows) {
    function walk(member, members) {
      if (members.indexOf(member) !== -1) return
      members.push(member)
      rows.filter(function (row) { return linkedBaseName(row, rows) === member.task })
        .forEach(function (child) { walk(child, members) })
    }
    var groups = []
    rows.forEach(function (row) {
      if (linkedBaseName(row, rows) !== null) return
      var members = []
      walk(row, members)
      groups.push({ rendered: memberToRender(members), members: members })
    })
    rows.forEach(function (row) {
      var chained = groups.some(function (group) { return group.members.indexOf(row) !== -1 })
      if (!chained) groups.push({ rendered: row, members: [row] })
    })
    var ordered = []
    rows.forEach(function (row) {
      var group = null
      groups.forEach(function (candidate) {
        if (group === null && candidate.rendered === row) group = candidate
      })
      if (group !== null) ordered.push(group)
    })
    return ordered
  }

  // The TASK cell of a chain's one row — the same spelling the shipped half's
  // serverTaskCellHtml writes, so the two renderers stay byte for byte.
  function taskCellHtml(group) {
    var name = escapeHtml(group.rendered.task)
    if (group.members.length === 1) return '<td>' + name + '</td>'
    var merged = group.members.filter(function (member) {
      return member.state === 'merged'
    }).length
    var riding = group.members.map(function (member) {
      return '<li>' + escapeHtml(member.task) + ' ' + escapeHtml(member.state) + '</li>'
    }).join('')
    return '<td>' + name
      + '<details id="chain-' + name + '"><summary>' + merged + '/' + group.members.length + '</summary>'
      + '<ul>' + riding + '</ul></details></td>'
  }

  function rowHtml(group) {
    var row = group.rendered
    var phase = row.phase === null
      ? '<span class="muted">no phase</span>'
      : '<span class="phase">' + escapeHtml(row.phase) + '</span>'
    // The round is null exactly when the phase is — the view's own construction couples
    // them (round falls back to null with the phase), so the phase's own check covers the
    // round's absence too.
    var round = row.phase === null
      ? '<span class="muted">—</span>'
      : '' + row.round
    var branch = row.branch === row.task ? '' : escapeHtml(row.branch) + ' '
    var inPhase = row.phaseAgeSeconds === null
      ? '<span class="muted">—</span>'
      : age(row.phaseAgeSeconds)
    var move = row.heartbeatAgeSeconds === null
      ? '<span class="muted">no heartbeat</span>'
      : age(row.heartbeatAgeSeconds)
    var account = phaseAccountHtml(row.phaseAccount)
    var session = row.session.listed
      ? '<code>' + escapeHtml(row.session.attach) + '</code>'
      : '<span class="muted">no session</span>'
    // One muting rule covers the lone merged entry and the all-merged chain alike: the row
    // is muted exactly when the member it renders has merged.
    var openTag = row.state === 'merged' ? '<tr class="muted">' : '<tr>'
    return openTag
      + taskCellHtml(group)
      + '<td>' + phase + '</td>'
      + '<td>' + round + '</td>'
      + '<td>' + branch + '<span class="muted">from ' + escapeHtml(baseLabel(row.base)) + '</span></td>'
      + '<td>' + inPhase + '</td>'
      + '<td>' + move + '</td>'
      + '<td>' + session + '</td>'
      + '<td>' + account + '</td>'
      + '</tr>'
  }

  function archiveRowHtml(record) {
    return '<tr>'
      + '<td>' + escapeHtml(record.task) + '</td>'
      + '<td>' + escapeHtml(record.branch) + ' <span class="muted">from ' + escapeHtml(baseLabel(record.base)) + '</span></td>'
      + '<td>' + moment(record.enqueuedAt) + '</td>'
      + '<td>' + moment(record.settledAt) + '</td>'
      + '<td>' + age(record.livedSeconds) + '</td>'
      + '<td>' + phaseAccountHtml(record.phaseAccount) + '</td>'
      + '</tr>'
  }

  function rulingHtml(ruling) {
    var shared = ruling.node === null
      ? 'a relationship this key does not name'
      : escapeHtml(ruling.node.kind) + ' "' + escapeHtml(ruling.node.name) + '"'
    var tasks = ruling.tasks.length === 0
      ? ''
      : ' shared by ' + ruling.tasks.map(escapeHtml).join(', ')
    return '<li>' + shared + tasks + '<code>' + escapeHtml(ruling.answerWith) + '</code></li>'
  }

  // Whether a person's text selection lives anywhere on the page — a copy in progress the
  // refresh must not tear down. A collapsed selection (a caret) is no copy at all.
  function selectionLives() {
    var selection = document.getSelection()
    if (selection === null || selection.isCollapsed) return false
    var node = selection.anchorNode
    while (node !== null) {
      if (node === document.body) return true
      node = node.parentNode
    }
    return false
  }

  function render(docket) {
    // A copy in progress holds the whole answer — for as long as the selection stands, not
    // just one round: the visibility flags and the content they describe must never drift
    // apart mid-render, and holding costs nothing the next cleared refresh does not pay.
    if (selectionLives()) return
    var groups = chainGroups(docket.rows)
    // The disclosures a person left open are read before the swap tears the old rows down,
    // and reopened on the elements that land — nothing is stored beyond the swap itself,
    // and the shipped markup ships them closed. Every member of a new group is probed, not
    // the rendered member alone: on the round a chain advances, the old row's id names the
    // member that just merged, and the open list a person left on it moves to the row the
    // frontier member now renders.
    var openIds = []
    groups.forEach(function (group) {
      var open = group.members.some(function (member) {
        var disclosure = document.getElementById('chain-' + escapeHtml(member.task))
        return disclosure !== null && disclosure.open === true
      })
      if (open) openIds.push('chain-' + escapeHtml(group.rendered.task))
    })
    // The summary a person's keyboard focused is carried across the swap the same way, by
    // the id of the disclosure it opens — a refresh that dropped the focus would send the
    // next Tab back to the page's top.
    var focusId = null
    var active = document.activeElement
    if (active != null && active.tagName === 'SUMMARY' && active.parentNode.id.indexOf('chain-') === 0) {
      focusId = active.parentNode.id
    }
    document.getElementById('empty').hidden = docket.rows.length > 0
    document.getElementById('queue-table').hidden = docket.rows.length === 0
    document.getElementById('rows').innerHTML = groups.map(rowHtml).join('')
    document.getElementById('problems-heading').hidden = docket.problems.length === 0
    document.getElementById('problems').hidden = docket.problems.length === 0
    document.getElementById('problems').innerHTML = docket.problems.map(function (problem) {
      return '<li>' + escapeHtml(problem.task) + ': ' + escapeHtml(problem.reason) + '</li>'
    }).join('')
    document.getElementById('rulings-heading').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').innerHTML = docket.outstanding.map(rulingHtml).join('')
    openIds.forEach(function (id) {
      var disclosure = document.getElementById(id)
      if (disclosure !== null) disclosure.open = true
    })
    if (focusId !== null) {
      var refocus = document.getElementById(focusId)
      if (refocus === null) {
        // The chain advanced: the disclosure's id moved with the member the row now
        // renders, so the miss is resolved by the group that now contains the member the
        // old id named — the same stream of work under the frontier's new name. When no
        // group contains it the pass pruned the chain, and the focus falls.
        var named = focusId.slice('chain-'.length)
        var carried = null
        groups.forEach(function (group) {
          if (carried !== null) return
          var holds = group.members.some(function (member) {
            return escapeHtml(member.task) === named
          })
          if (holds) carried = group
        })
        if (carried !== null) refocus = document.getElementById('chain-' + escapeHtml(carried.rendered.task))
      }
      // firstElementChild, not firstChild — a text node before the summary would make
      // focus throw — and preventScroll, so a carried focus never yanks its row back
      // into view on every refresh.
      if (refocus !== null && refocus.firstElementChild != null) {
        refocus.firstElementChild.focus({ preventScroll: true })
      }
    }
  }

  function renderArchive(archive) {
    if (selectionLives()) return
    document.getElementById('archive-empty').hidden = archive.records.length > 0
    document.getElementById('completed-table').hidden = archive.records.length === 0
    document.getElementById('archive-rows').innerHTML = archive.records.map(archiveRowHtml).join('')
  }

  // The page's requests are its refreshes. A failed one keeps the last answer standing; the
  // next refresh is the retry. The two reads are independent — one failing does not hold the
  // other's answer back.
  function refresh() {
    fetch('/docket').then(function (response) {
      return response.json()
    }).then(render).catch(function () {})
    fetch('/archive').then(function (response) {
      return response.json()
    }).then(renderArchive).catch(function () {})
  }

  refresh()
  setInterval(refresh, ${PAGE_REFRESH_MILLISECONDS})
})()
`
}
