import { settingsOf } from '../settings.ts'
import type { SettingsSource } from '../settings.ts'

/**
 * Requirement: No executor session starts once the live-session bound is reached
 *
 * The bound itself: four executor sessions at once unless the settings file at the queue root
 * names a positive `maxSessions`. Anything that is not a positive number falls back to four
 * rather than silently disabling the bound (`src/settings.ts`). Read fresh on every call
 * given a queue root, so a module-level constant never freezes whatever the file held at
 * first import; a scheduling pass hands the settings it already read instead, so the pass
 * reads the file once. Lives in the CLI layer, beside the judge's `judgeTimeoutMs`, because
 * reading a file has no place in the pure `schedule` rules.
 */
export function maxSessionsFrom(source: SettingsSource): number {
  return settingsOf(source).maxSessions
}
