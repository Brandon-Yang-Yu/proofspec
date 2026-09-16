import type { DocketActions } from '../docket/index.ts'

/**
 * The docket served over HTTP: `cli` owns the process, so `cli` owns the socket. Not built
 * yet — the scaffolding stands so the serve scenarios can run red.
 */

/** The conventional port, so the URL is memorable. */
export const DOCKET_SERVE_PORT = 4567

/** What serving is asked for: where the queue lives, which port to listen on (the
 *  conventional one when left out), the session server to ask, and the clock each request
 *  computes its ages from — read fresh per request, never once at startup. */
export type ServeOptions = {
  readonly cwd: string
  readonly port?: number
  readonly docket?: DocketActions
  readonly now?: () => Date
}

/** A server standing: the URL a person opens, where it actually listens, and the one act
 *  that ends it. */
export type StandingServe = {
  readonly url: string
  readonly host: string
  readonly port: number
  stop(): Promise<void>
}

/** Serves the docket until `stop` is called. */
export async function serveDocket(_options: ServeOptions): Promise<StandingServe | { readonly ok: false; readonly reason: string }> {
  throw new Error('serving the docket is not built yet')
}
