/**
 * The docket's page: the view's answer spelled for a browser. Pure content — a string, not
 * a server — because the docket reads no files and runs no processes; `cli` owns the socket
 * the page arrives on, the same split the view itself keeps.
 *
 * Not built yet: the scaffolding stands so the page's scenarios can run red.
 */

/** How often the page asks again, on its own. */
export const PAGE_REFRESH_MILLISECONDS = 2000

/** The page a browser opens. */
export function docketPage(): string {
  throw new Error('the docket page is not built yet')
}
