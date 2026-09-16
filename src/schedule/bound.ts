/**
 * Requirement: No executor session starts once the live-session bound is reached
 *
 * The bound itself: four executor sessions at once unless `PROOFSPEC_MAX_SESSIONS` names a
 * positive number. `raw` is the env value, read fresh by the caller on every pass the same
 * way `PROOFSPEC_TMUX_SOCKET` and `PROOFSPEC_JUDGE_BIN` are read, so a module-level constant
 * never freezes whatever the env held at first import. Anything that is not a positive
 * number falls back to four rather than silently disabling the bound: the obvious malformed
 * values (text, empty) parse to `NaN`, and every comparison against `NaN` is false — a pass
 * holding `NaN` as its bound would dispatch without limit while believing itself bounded.
 */
export const DEFAULT_MAX_SESSIONS = 4

export function maxSessionsFrom(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_MAX_SESSIONS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_SESSIONS
}
