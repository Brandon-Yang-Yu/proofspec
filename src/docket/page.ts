import type { Docket, DocketRow, OutstandingRuling } from './view.ts'

/**
 * The docket's page: the view's answer spelled for a browser. Pure content — a string, not
 * a server — because the docket reads no files and runs no processes; `cli` owns the socket
 * the page arrives on, the same split the view itself keeps.
 *
 * The page is written with its answer already in it: the rows, the problems, and the rulings
 * ship as content a browser shows before any script runs — the page is the view asked again,
 * not an empty shell around a script. The script inline in the page is the whole of the
 * page's behavior after that: it asks `/docket` again on its own, renders exactly the answer
 * it last received, and does nothing else. It keeps no clock of its own — an age the browser
 * inflated between answers would be a performance of the fact rather than the fact — and no
 * control that runs anything: every action the queue knows how to take has a command that
 * takes it, and the page shows those commands as text rather than becoming a second place to
 * run them.
 *
 * The shipped rows and the script-rendered rows come from two renderers — one spelled in
 * TypeScript for the markup the server answers, one in JavaScript for the refresh — that
 * `tests/docket/page.test.ts` holds to the same bytes for the same answer, so the two cannot
 * drift apart.
 */

/** How often the page asks again, on its own: short enough that a watched queue stays
 *  current, long enough that a page left open is a handful of requests a minute. */
export const PAGE_REFRESH_MILLISECONDS = 2000

/** The page a browser opens: one table of rows, the problems that kept a TASK off the rows,
 *  and the rulings still outstanding with the command that pays each. */
export function docketPage(report: Docket): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Docket</title>
<style>
  body { font-family: ui-monospace, "SF Mono", Menlo, monospace; margin: 2rem; }
  table { border-collapse: collapse; }
  th, td { padding: 0.3rem 1rem 0.3rem 0; text-align: left; vertical-align: top; }
  code { background: #f2f2f2; padding: 0.1rem 0.3rem; }
  .muted { color: #777; }
</style>
</head>
<body>
<h1>Docket</h1>
<p id="empty"${report.rows.length === 0 ? '' : ' hidden'}>no TASK in the queue</p>
<table>
  <thead>
    <tr><th>TASK</th><th>state</th><th>phase</th><th>branch</th><th>in word</th><th>last move</th><th>in phase</th><th>session</th></tr>
  </thead>
  <tbody id="rows">${report.rows.map(serverRowHtml).join('')}</tbody>
</table>
<h2 id="problems-heading"${report.problems.length === 0 ? ' hidden' : ''}>problems</h2>
<ul id="problems">${report.problems.map(serverProblemHtml).join('')}</ul>
<h2 id="rulings-heading"${report.outstanding.length === 0 ? ' hidden' : ''}>rulings outstanding</h2>
<ul id="rulings">${report.outstanding.map(serverRulingHtml).join('')}</ul>
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

function serverBaseLabel(base: DocketRow['base']): string {
  return base.kind === 'main' ? 'main' : base.task
}

function serverRowHtml(row: DocketRow): string {
  const pace = row.phase === null
    ? '<span class="muted">no phase</span>'
    : `${serverEscapeHtml(row.phase)} <span class="muted">round ${row.round}</span>`
  const move = row.heartbeatAgeSeconds === null
    ? '<span class="muted">no heartbeat</span>'
    : serverAge(row.heartbeatAgeSeconds)
  const inPhase = row.phaseAgeSeconds === null
    ? '<span class="muted">no phase</span>'
    : serverAge(row.phaseAgeSeconds)
  const session = row.session.listed
    ? `<code>${serverEscapeHtml(row.session.attach)}</code>`
    : '<span class="muted">no session</span>'
  return '<tr>'
    + `<td>${serverEscapeHtml(row.task)}</td>`
    + `<td>${serverEscapeHtml(row.state)}</td>`
    + `<td>${pace}</td>`
    + `<td>${serverEscapeHtml(row.branch)} <span class="muted">from ${serverEscapeHtml(serverBaseLabel(row.base))}</span></td>`
    + `<td>${serverAge(row.stateAgeSeconds)}</td>`
    + `<td>${move}</td>`
    + `<td>${inPhase}</td>`
    + `<td>${session}</td>`
    + '</tr>'
}

function serverProblemHtml(problem: { readonly task: string; readonly reason: string }): string {
  return `<li>${serverEscapeHtml(problem.task)}: ${serverEscapeHtml(problem.reason)}</li>`
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

  function rowHtml(row) {
    var pace = row.phase === null
      ? '<span class="muted">no phase</span>'
      : escapeHtml(row.phase) + ' <span class="muted">round ' + row.round + '</span>'
    var move = row.heartbeatAgeSeconds === null
      ? '<span class="muted">no heartbeat</span>'
      : age(row.heartbeatAgeSeconds)
    var inPhase = row.phaseAgeSeconds === null
      ? '<span class="muted">no phase</span>'
      : age(row.phaseAgeSeconds)
    var session = row.session.listed
      ? '<code>' + escapeHtml(row.session.attach) + '</code>'
      : '<span class="muted">no session</span>'
    return '<tr>'
      + '<td>' + escapeHtml(row.task) + '</td>'
      + '<td>' + escapeHtml(row.state) + '</td>'
      + '<td>' + pace + '</td>'
      + '<td>' + escapeHtml(row.branch) + ' <span class="muted">from ' + escapeHtml(baseLabel(row.base)) + '</span></td>'
      + '<td>' + age(row.stateAgeSeconds) + '</td>'
      + '<td>' + move + '</td>'
      + '<td>' + inPhase + '</td>'
      + '<td>' + session + '</td>'
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

  function render(docket) {
    document.getElementById('empty').hidden = docket.rows.length > 0
    document.getElementById('rows').innerHTML = docket.rows.map(rowHtml).join('')
    document.getElementById('problems-heading').hidden = docket.problems.length === 0
    document.getElementById('problems').innerHTML = docket.problems.map(function (problem) {
      return '<li>' + escapeHtml(problem.task) + ': ' + escapeHtml(problem.reason) + '</li>'
    }).join('')
    document.getElementById('rulings-heading').hidden = docket.outstanding.length === 0
    document.getElementById('rulings').innerHTML = docket.outstanding.map(rulingHtml).join('')
  }

  // The page's one request is its refresh. A failed one keeps the last answer standing; the
  // next refresh is the retry.
  function refresh() {
    fetch('/docket').then(function (response) {
      return response.json()
    }).then(render).catch(function () {})
  }

  refresh()
  setInterval(refresh, ${PAGE_REFRESH_MILLISECONDS})
})()
`
}
