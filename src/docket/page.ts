import type { ArchiveRecord, Docket, DocketRow, OutstandingRuling, PhaseAccountEntry } from './view.ts'

/**
 * The docket's page: the view's answer spelled for a browser. Pure content — a string, not
 * a server — because the docket reads no files and runs no processes; `cli` owns the socket
 * the page arrives on, the same split the view itself keeps.
 *
 * The page is written with its answer already in it: the rows, the problems, the rulings,
 * and the completed records ship as content a browser shows before any script runs — the
 * page is the view asked again, not an empty shell around a script. Every queue entry
 * renders its own flat row: a TASK whose MANIFEST records a `blocked` names on its row the
 * TASK that blocks it, rows stand with TASKs that are not held before TASKs that are held
 * (name order within each group), and a merged entry still on the queue keeps its own muted
 * row until a pass prunes it. The script inline in the page is the whole of the page's
 * behavior after that: it asks `/docket` and `/archive` again on its own, renders exactly
 * the answers it last received, and does nothing else. It keeps no clock of its own — an
 * age the browser inflated between answers would be a performance of the fact rather than
 * the fact — and no control that runs anything: every action the queue knows how to take
 * has a command that takes it, and the page shows those commands as text rather than
 * becoming a second place to run them. The one exception it makes to re-rendering
 * everything: while a person's text selection lives anywhere on the page, the whole answer
 * is left standing for that round — the commands this page shows are meant to be copied,
 * and a refresh that tore a selection out from under the copy would defeat the page's own
 * copy affordance.
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
  <tbody id="rows">${orderedRows(report.rows).map(serverRowHtml).join('')}</tbody>
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

/** Whether a row is held: its `blocked` names a TASK still on the queue whose state word is
 *  not `merged`. A merged blocker has landed, and a name no row answers waits on nothing the
 *  page can see — a TASK the queue holds only as a problem answers no row at all. */
function isHeld(row: DocketRow, rows: readonly DocketRow[]): boolean {
  const named = row.blocked?.task
  if (named === undefined) return false
  const blocker = rows.find(other => other.task === named)
  return blocker !== undefined && blocker.state !== 'merged'
}

/** The rows in the order the page writes them: TASKs that are not held before TASKs that
 *  are held, name order within each group — a stable partition over the name-sorted rows the
 *  view answers, so each group keeps the view's own sort. A held TASK is waiting, not
 *  working, and the rows a person scans first are the rows whose work can move. */
function orderedRows(rows: readonly DocketRow[]): readonly DocketRow[] {
  return [...rows.filter(row => !isHeld(row, rows)), ...rows.filter(row => isHeld(row, rows))]
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

/** The branch cell: the branch when it differs from the TASK's name, and — only when the
 *  MANIFEST records a blocker — a muted `blocked by` naming it. One spelling for every case:
 *  the cell records the field, never decides it, so a dangling name and a merged blocker
 *  still name the TASK they name; the separator space appears only when something follows
 *  the branch. */
function serverBranchCellHtml(row: DocketRow): string {
  if (row.blocked === undefined) {
    return `<td>${row.branch === row.task ? '' : serverEscapeHtml(row.branch)}</td>`
  }
  const branch = row.branch === row.task ? '' : `${serverEscapeHtml(row.branch)} `
  return `<td>${branch}<span class="muted">blocked by ${serverEscapeHtml(row.blocked.task)}</span></td>`
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
function serverPhaseAccountHtml(account: readonly PhaseAccountEntry[] | null): string {
  if (account === null) return '<span class="muted">no phases</span>'
  return account.map(serverAccountFragment).join('<br>')
}

function serverRowHtml(row: DocketRow): string {
  const phase = row.phase === null
    ? '<span class="muted">no phase</span>'
    : `<span class="phase">${serverEscapeHtml(row.phase)}</span>`
  // The round is null exactly when the phase is — the view's own construction couples them
  // (round falls back to null with the phase), so the phase's own check covers the round's
  // absence too.
  const round = row.phase === null
    ? '<span class="muted">—</span>'
    : String(row.round)
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
  // The one muting rule: a row is muted exactly when its own state word reads `merged` —
  // finished work a pass has not pruned yet, keeping its own row until it does.
  const openTag = row.state === 'merged' ? '<tr class="muted">' : '<tr>'
  return openTag
    + `<td>${serverEscapeHtml(row.task)}</td>`
    + `<td>${phase}</td>`
    + `<td>${round}</td>`
    + serverBranchCellHtml(row)
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
  const blockedBy = record.blocked === undefined
    ? ''
    : ` <span class="muted">blocked by ${serverEscapeHtml(record.blocked.task)}</span>`
  return '<tr>'
    + `<td>${serverEscapeHtml(record.task)}</td>`
    + `<td>${serverEscapeHtml(record.branch)}${blockedBy}</td>`
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

  // One word's line of a phase account — the same spelling the shipped half's
  // serverAccountFragment writes, so the two renderers stay byte for byte.
  function accountFragment(entry) {
    var fragment = escapeHtml(entry.word) + ' ' + age(entry.totalSeconds)
    if (entry.roundsReached > 1) fragment += ' through round ' + entry.roundsReached
    return fragment
  }

  function phaseAccountHtml(account) {
    if (account === null) return '<span class="muted">no phases</span>'
    return account.map(accountFragment).join('<br>')
  }

  // A moment as the page spells it — the record's own ISO string with the milliseconds
  // trimmed, the same trim the shipped half makes, so the two renderers stay byte for byte.
  // The character-class pattern matches the shipped half's for the same reason it gives:
  // this script lives inside a template literal, where an escaped dot would be eaten.
  function moment(iso) {
    return escapeHtml(iso.replace(/[.][0-9]{3}Z$/, 'Z'))
  }

  // Whether a row is held — the same rule the shipped half's isHeld keeps, so the two
  // renderers stay byte for byte.
  function isHeld(row, rows) {
    var named = row.blocked === undefined ? undefined : row.blocked.task
    if (named === undefined) return false
    var blocker = null
    rows.forEach(function (other) {
      if (other.task === named) blocker = other
    })
    return blocker !== null && blocker.state !== 'merged'
  }

  // The rows in the order the page writes them — the same partition the shipped half's
  // orderedRows keeps, so the two renderers stay byte for byte.
  function orderedRows(rows) {
    var notHeld = rows.filter(function (row) { return !isHeld(row, rows) })
    var held = rows.filter(function (row) { return isHeld(row, rows) })
    return notHeld.concat(held)
  }

  // The branch cell — the same spelling the shipped half's serverBranchCellHtml writes, so
  // the two renderers stay byte for byte.
  function branchCellHtml(row) {
    if (row.blocked === undefined) {
      return '<td>' + (row.branch === row.task ? '' : escapeHtml(row.branch)) + '</td>'
    }
    var branch = row.branch === row.task ? '' : escapeHtml(row.branch) + ' '
    return '<td>' + branch + '<span class="muted">blocked by ' + escapeHtml(row.blocked.task) + '</span></td>'
  }

  function rowHtml(row) {
    var phase = row.phase === null
      ? '<span class="muted">no phase</span>'
      : '<span class="phase">' + escapeHtml(row.phase) + '</span>'
    // The round is null exactly when the phase is — the view's own construction couples
    // them (round falls back to null with the phase), so the phase's own check covers the
    // round's absence too.
    var round = row.phase === null
      ? '<span class="muted">—</span>'
      : '' + row.round
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
    // The one muting rule: the row is muted exactly when its own state word reads merged.
    var openTag = row.state === 'merged' ? '<tr class="muted">' : '<tr>'
    return openTag
      + '<td>' + escapeHtml(row.task) + '</td>'
      + '<td>' + phase + '</td>'
      + '<td>' + round + '</td>'
      + branchCellHtml(row)
      + '<td>' + inPhase + '</td>'
      + '<td>' + move + '</td>'
      + '<td>' + session + '</td>'
      + '<td>' + account + '</td>'
      + '</tr>'
  }

  function archiveRowHtml(record) {
    var blockedBy = record.blocked === undefined
      ? ''
      : ' <span class="muted">blocked by ' + escapeHtml(record.blocked.task) + '</span>'
    return '<tr>'
      + '<td>' + escapeHtml(record.task) + '</td>'
      + '<td>' + escapeHtml(record.branch) + blockedBy + '</td>'
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
    var rows = orderedRows(docket.rows)
    document.getElementById('empty').hidden = docket.rows.length > 0
    document.getElementById('queue-table').hidden = docket.rows.length === 0
    document.getElementById('rows').innerHTML = rows.map(rowHtml).join('')
    document.getElementById('problems-heading').hidden = docket.problems.length === 0
    document.getElementById('problems').hidden = docket.problems.length === 0
    document.getElementById('problems').innerHTML = docket.problems.map(function (problem) {
      return '<li>' + escapeHtml(problem.task) + ': ' + escapeHtml(problem.reason) + '</li>'
    }).join('')
    document.getElementById('rulings-heading').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').innerHTML = docket.outstanding.map(rulingHtml).join('')
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
