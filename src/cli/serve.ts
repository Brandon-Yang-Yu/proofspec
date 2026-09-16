import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { docketPage } from '../docket/index.ts'
import type { DocketActions } from '../docket/index.ts'
import { renderAnswer } from './render.ts'
import { docket } from './run.ts'

/**
 * The docket served over HTTP. `cli` is the one capability that owns the process, so it owns
 * the socket: this answers the page at `/` and the JSON the page reads at `/docket`, and
 * answers nothing else. Each request runs the same read the one-shot command makes, made
 * again at that moment — the server holds no facts of its own, caches nothing, and predicts
 * nothing, which is the honesty the page is built on.
 *
 * Serving runs until `stop` is called: the listener itself is what keeps a process alive,
 * and stopping it ends that. The listener answers the loopback interface only, because the
 * docket names this machine's queue, this machine's sessions, and this machine's ruling
 * debts — facts no other host has any business reading.
 */

/** The conventional port, so the URL is memorable. */
export const DOCKET_SERVE_PORT = 4567

/** The one interface serving answers on: the loopback, never a shared one. */
const LOOPBACK = '127.0.0.1'

/** What serving is asked for: where the queue lives, which port to listen on (the
 *  conventional one when left out), the session server to ask, and the clock each request
 *  computes its ages from — read per request, never once at startup. */
export type ServeOptions = {
  readonly cwd: string
  readonly port?: number
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
  const clock = options.now ?? (() => new Date())
  const server = createServer((request, response) => {
    void answer(request, response, options, clock)
  })
  const listening = await listen(server, port)
  if (!listening.ok) return listening
  // Stopping twice is one stop: a caller that stops by hand and again on teardown would
  // otherwise read a refusal from a server already down.
  let stopped = false
  return {
    ok: true,
    url: `http://localhost:${listening.port}/`,
    host: LOOPBACK,
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

/** Listens on the loopback at the port named, answering the port actually bound. */
function listen(server: ReturnType<typeof createServer>, port: number): Promise<Listening> {
  return new Promise(resolve => {
    const onListening = (): void => {
      server.off('error', onError)
      resolve({ ok: true, port: server.address() === null ? port : (server.address() as { port: number }).port })
    }
    const onError = (error: Error & { readonly code?: string }): void => {
      server.off('listening', onListening)
      resolve({
        ok: false,
        reason: error.code === 'EADDRINUSE'
          ? `port ${port} is already in use`
          : `could not listen on port ${port}: ${error.message}`,
      })
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, LOOPBACK)
  })
}

/**
 * The two paths the page needs and nothing more. A request for anything else — or by any
 * method other than GET — is a 404, because the page's requests are its refreshes and a
 * server that answered more would be inviting controls the page refuses to hold.
 */
async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServeOptions,
  clock: () => Date,
): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  if (request.method !== 'GET' || (path !== '/' && path !== '/docket')) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
    return
  }
  if (path === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(docketPage())
    return
  }
  // The same read the one-shot command makes, made again for this request: the JSON the
  // page reads is that command's own JSON form, not a dialect of it.
  const outcome = await docket({ cwd: options.cwd, docket: options.docket, now: clock() })
  if (outcome.kind === 'cannot-run') {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(outcome.reason)
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(renderAnswer(outcome, { format: 'json' }))
}
