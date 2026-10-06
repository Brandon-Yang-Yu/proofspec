import { DEFAULT_MAX_SESSIONS, settingsOrThrow } from '../settings.ts'

/**
 * Requirement: No executor session starts once the live-session bound is reached
 *
 * The bound itself: four executor sessions at once unless the settings file at the queue root
 * names a positive `maxSessions`. Anything that is not a positive number falls back to four
 * rather than silently disabling the bound (`src/settings.ts`). Read fresh on every call, so
 * a module-level constant never freezes whatever the file held at first import.
 */
export { DEFAULT_MAX_SESSIONS }

export async function maxSessionsFrom(queueRoot: string): Promise<number> {
  return settingsOrThrow(queueRoot).maxSessions
}
