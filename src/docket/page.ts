import type { ArchiveRecord, Docket, DocketRow, OutstandingRuling, PhaseAccountEntry } from './view.ts'

/**
 * The docket's page: the view's answer spelled for a browser. Pure content — a string, not
 * a server — because the docket reads no files and runs no processes; `cli` owns the socket
 * the page arrives on, the same split the view itself keeps.
 *
 * The page is written with its answer already in it: the rows, the completed records, the
 * problems, and the rulings ship as content a browser shows before any script runs — the
 * page is the view asked again, not an empty shell around a script. The script inline in
 * the page is the whole of the page's behavior after that: it asks `/docket` and `/archive`
 * again on its own, renders exactly the answers it last received, and does nothing else. It
 * keeps no clock of its own — an age the browser inflated between answers would be a
 * performance of the fact rather than the fact — and no control that runs anything: every
 * action the queue knows how to take has a command that takes it, and the page shows those
 * commands as text rather than becoming a second place to run them. The one exception it
 * makes to re-rendering everything: while a person's text selection lives anywhere on the
 * page, the whole answer is left standing for that round — the commands this page shows are
 * meant to be copied, and a refresh that tore a selection out from under the copy would
 * defeat the page's own copy affordance.
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
<title>Docket</title>
<style>
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; margin: 2rem; }
  table { border-collapse: collapse; }
  th, td { padding: 0.3rem 1rem 0.3rem 0; text-align: left; vertical-align: top; }
  td { white-space: nowrap; }
  thead th { border-bottom: 1px solid #ddd; }
  tbody td { border-bottom: 1px solid #eee; }
  code { background: #f2f2f2; padding: 0.1rem 0; }
  .muted { color: #777; }
</style>
</head>
<body>
<h1>Docket</h1>
<h2>queue</h2>
<p id="empty"${report.rows.length === 0 ? '' : ' hidden'}>no TASK in the queue</p>
<table>
  <thead>
    <tr><th scope="col">TASK</th><th scope="col">phase</th><th scope="col">branch</th><th scope="col">in phase</th><th scope="col">last move</th><th scope="col">session</th><th scope="col">phase totals</th></tr>
  </thead>
  <tbody id="rows">${report.rows.map(serverRowHtml).join('')}</tbody>
</table>
<h2 id="problems-heading"${report.problems.length === 0 ? ' hidden' : ''}>problems</h2>
<ul id="problems">${report.problems.map(serverProblemHtml).join('')}</ul>
<h2 id="rulings-heading"${report.outstanding.length === 0 ? ' hidden' : ''}>rulings outstanding</h2>
<ul id="rulings">${report.outstanding.map(serverRulingHtml).join('')}</ul>
<h2>completed</h2>
<p id="archive-empty"${archive.length === 0 ? '' : ' hidden'}>no completed TASK yet</p>
<table>
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
 *  than the present-tense `round N` the phase column three cells left already means (rounds
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

function serverRowHtml(row: DocketRow): string {
  const pace = row.phase === null
    ? '<span class="muted">no phase</span>'
    : `${serverEscapeHtml(row.phase)} round ${row.round}`
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
  return '<tr>'
    + `<td>${serverEscapeHtml(row.task)}</td>`
    + `<td>${pace}</td>`
    + `<td>${serverEscapeHtml(row.branch)} <span class="muted">from ${serverEscapeHtml(serverBaseLabel(row.base))}</span></td>`
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
  return `<li>${shared}${tasks}<br><code>${serverEscapeHtml(ruling.answerWith)}</code></li>`
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

  function rowHtml(row) {
    var pace = row.phase === null
      ? '<span class="muted">no phase</span>'
      : escapeHtml(row.phase) + ' round ' + row.round
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
    return '<tr>'
      + '<td>' + escapeHtml(row.task) + '</td>'
      + '<td>' + pace + '</td>'
      + '<td>' + escapeHtml(row.branch) + ' <span class="muted">from ' + escapeHtml(baseLabel(row.base)) + '</span></td>'
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
    return '<li>' + shared + tasks + '<br><code>' + escapeHtml(ruling.answerWith) + '</code></li>'
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
    document.getElementById('empty').hidden = docket.rows.length > 0
    document.getElementById('rows').innerHTML = docket.rows.map(rowHtml).join('')
    document.getElementById('problems-heading').hidden = docket.problems.length === 0
    document.getElementById('problems').innerHTML = docket.problems.map(function (problem) {
      return '<li>' + escapeHtml(problem.task) + ': ' + escapeHtml(problem.reason) + '</li>'
    }).join('')
    document.getElementById('rulings-heading').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').innerHTML = docket.outstanding.map(rulingHtml).join('')
  }

  function renderArchive(archive) {
    if (selectionLives()) return
    document.getElementById('archive-empty').hidden = archive.records.length > 0
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
