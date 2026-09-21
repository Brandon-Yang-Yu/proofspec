import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { archiveView, docketPage } from '../docket/index.ts'
import type { DocketActions } from '../docket/index.ts'
import { readArchive } from './queue.ts'
import { renderAnswer } from './render.ts'
import { docket } from './run.ts'

/**
 * The docket served over HTTP. `cli` is the one capability that owns the process, so it owns
 * the socket: this answers the page at `/`, the JSON the page reads at `/docket`, and the
 * archive's own JSON at `/archive`, and answers nothing else. Each request runs the same
 * read the one-shot command makes, made again at that moment — the server holds no facts
 * of its own, caches nothing, and predicts nothing, which is the honesty the page is built
 * on.
 *
 * Serving runs until `stop` is called: the listener itself is what keeps a process alive,
 * and stopping it ends that. The loopback is the default interface — the docket names this
 * machine's queue, this machine's sessions, and this machine's ruling debts — and a caller
 * naming an interface with `--host` is choosing who reads.
 */

/** The conventional port, so the URL is memorable. */
export const DOCKET_SERVE_PORT = 4567

/** The interface serving answers on when the caller names none: the loopback. */
const LOOPBACK = '127.0.0.1'

/** What serving is asked for: where the queue lives, which interface and port to listen on
 *  (the loopback and the conventional one when left out), the session server to ask, and the
 *  clock each request computes its ages from — read per request, never once at startup. */
export type ServeOptions = {
  readonly cwd: string
  readonly port?: number
  readonly host?: string
  readonly docket?: DocketActions
  readonly now?: () => Date
}

/** A server standing: the URL a person opens, where it actually listens, and the one act
 *  that ends it. */
export type StandingServe = {
  readonly ok: true
  readonly url: string
  readonly host: string
  readonly port: number
  stop(): Promise<void>
}

/** What serving failed at, as a value rather than a throw — the same refusal shape every
 *  command answers with. */
export type RefusedServe = { readonly ok: false; readonly reason: string }

/**
 * Serves the docket until `stop` is called on the answer. A port nothing can be listening
 * on is refused rather than retried: the caller named it, and silently serving somewhere
 * else would answer a URL nobody asked for.
 */
export async function serveDocket(options: ServeOptions): Promise<StandingServe | RefusedServe> {
  const port = options.port ?? DOCKET_SERVE_PORT
  const host = options.host ?? LOOPBACK
  const ask: Answering = { options, clock: options.now ?? (() => new Date()) }
  const server = createServer((request, response) => {
    void answer(request, response, ask).catch(() => {
      // Nothing on the answering path is expected to throw — failures are values — so this is
      // the boundary catch for a real bug: say so over the socket and keep serving.
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('the docket could not be answered')
      }
    })
  })
  const listening = await listen(server, port, host)
  if (!listening.ok) return listening
  // Stopping twice is one stop: a caller that stops by hand and again on teardown would
  // otherwise read a refusal from a server already down.
  let stopped = false
  // The URL names an address that answers: `localhost` is the spelling a person opens for
  // the loopback, and an interface a caller named is spelled as they named it.
  const forABrowser = host === LOOPBACK ? 'localhost' : host
  return {
    ok: true,
    url: `http://${forABrowser}:${listening.port}/`,
    host,
    port: listening.port,
    stop: async () => {
      if (stopped) return
      stopped = true
      // Open keep-alive connections would otherwise hold `close` open past the caller's
      // patience; the answer is already standing, so they are dropped, not drained.
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => (error === undefined ? resolve() : reject(error))))
    },
  }
}

type Listening = { readonly ok: true; readonly port: number } | RefusedServe

/** Listens on the interface and port named, answering the port actually bound. */
function listen(server: ReturnType<typeof createServer>, port: number, host: string): Promise<Listening> {
  return new Promise(resolve => {
    const onListening = (): void => {
      server.off('error', onError)
      // A TCP listener answers an address object; the string arm belongs to pipes, which
      // this listener never is, so falling back to the named port is for the type, not a
      // case a caller can reach.
      const bound = server.address()
      resolve({ ok: true, port: typeof bound === 'object' && bound !== null ? bound.port : port })
    }
    const onError = (error: Error & { readonly code?: string }): void => {
      server.off('listening', onListening)
      resolve({
        ok: false,
        reason: error.code === 'EADDRINUSE'
          ? `port ${port} is already in use`
          // The interface is named too, because it is as often the part that cannot be
          // listened on — an address the machine does not hold, say.
          : `could not listen on ${host} at port ${port}: ${error.message}`,
      })
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, host)
  })
}

/** What one request is answered from: the serving options and the clock this server reads,
 *  resolved once at startup but called per request — a fresh now for every answer. */
type Answering = {
  readonly options: ServeOptions
  readonly clock: () => Date
}

/**
 * The paths the page needs and nothing more. A request for anything else — or by any method
 * other than GET — is a 404, because the page's requests are its refreshes and a server
 * that answered more would be inviting controls the page refuses to hold.
 */
async function answer(request: IncomingMessage, response: ServerResponse, ask: Answering): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (request.method !== 'GET' || (path !== '/' && path !== '/docket' && path !== '/archive')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  if (path === '/archive') {
    // The archive is its own read, made again for this request exactly as the docket's is:
    // the records' moments are the archived files' own write times, and nothing about them
    // is held from an earlier answer.
    const archive = await readArchive(ask.options.cwd)
    if (!archive.ok) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(archive.reason)
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ records: archiveView(archive.entries) }))
    return
  }
  // The same read the one-shot command makes, made again for this request — shared by the
  // page and the JSON it reads, and kept independent of the archive read below: a `/docket`
  // request never touches the archive, so it can never die on it.
  const outcome = await docket({ cwd: ask.options.cwd, docket: ask.options.docket, now: ask.clock() })
  if (outcome.kind !== 'docket') {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(outcome.kind === 'cannot-run' ? outcome.reason : 'the docket could not be answered')
    return
  }
  if (path === '/') {
    // The page carries both reads — the docket above and the archive here — the archive
    // computed fresh at this request's own moment, exactly as the docket was.
    const archive = await readArchive(ask.options.cwd)
    if (!archive.ok) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(archive.reason)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(docketPage(outcome.report, archiveView(archive.entries)))
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(renderAnswer(outcome, { format: 'json' }))
}
