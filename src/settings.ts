import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Requirement: Project settings are read from one file at the queue root (specs/cli.md)
 *
 * The project's settings come from one committed file, `.proofspec/config.json` at the queue
 * root, so every person and every shell runs the project the same way. A key the file holds
 * decides; a key it does not hold, or holds a value that cannot be used, takes its default —
 * one key at a time, the others keeping the file's values. A file that is not valid JSON is a
 * loud failure, never a quiet run on the defaults: a committed file silently ignored would
 * let a project believe it runs on settings it does not.
 */

/** The two harnesses an executor session can run in. Subscription auth lives only inside
 *  the Claude Code harness, and `pi` is the default. The choice is operational — the TASK's
 *  own queue entry record, written when a provider-error stop moves the TASK to claude, else
 *  the settings file's `executor` — never something a TASK's branch gets a say in. It lives
 *  here, beside the setting it types, so this file reads no module of the CLI's own. */
export type ExecutorName = 'pi' | 'claude'

export const DEFAULT_EXECUTOR: ExecutorName = 'pi'
export const DEFAULT_BASE_BRANCH = 'main'
export const DEFAULT_JUDGE_BIN = 'pi'
export const DEFAULT_JUDGE_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_SESSIONS = 4

const SETTINGS_PATH = ['.proofspec', 'config.json'] as const

export type Settings = {
  readonly executor: ExecutorName
  readonly baseBranch: string
  readonly judgeBin: string
  readonly judgeTimeoutMs: number
  readonly maxSessions: number
}

export type SettingsRead = { readonly ok: true; readonly settings: Settings } | { readonly ok: false; readonly reason: string }

/**
 * The settings the file at `queueRoot` names, each missing or unusable key at its default.
 * Synchronous because `startSession` builds its tmux commands synchronously, the same reason
 * it reads a TASK's executor record with a sync read (`executorRecordPath`).
 */
export function readSettings(queueRoot: string): SettingsRead {
  const path = join(queueRoot, ...SETTINGS_PATH)
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, settings: settingsFrom({}) }
    return { ok: false, reason: `could not read the settings file ${path}: ${messageOf(error)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    return { ok: false, reason: `the settings file ${path} is not valid JSON: ${messageOf(error)}` }
  }
  if (!isJsonObject(parsed)) return { ok: false, reason: `the settings file ${path} does not hold a JSON object` }
  return { ok: true, settings: settingsFrom(parsed) }
}

/**
 * The settings for a caller whose contract is to throw on a failure it cannot answer as a
 * value — a session start, a judge run — carrying the reason, which names the file.
 */
export function settingsOrThrow(queueRoot: string): Settings {
  const read = readSettings(queueRoot)
  if (!read.ok) throw new Error(read.reason)
  return read.settings
}

/** A queue root whose settings file is still to be read, or the settings a caller already
 *  read — so a caller that needs several values reads the file once and hands the result to
 *  each reader, while a reader asked about a queue root alone reads it itself. */
export type SettingsSource = string | Settings

/** The settings `source` stands for, reading the file only when it is a queue root; a file
 *  that cannot be read throws, as `settingsOrThrow` does. */
export function settingsOf(source: SettingsSource): Settings {
  return typeof source === 'string' ? settingsOrThrow(source) : source
}

function settingsFrom(file: Readonly<Record<string, unknown>>): Settings {
  return {
    executor: file['executor'] === 'pi' || file['executor'] === 'claude' ? file['executor'] : DEFAULT_EXECUTOR,
    baseBranch: nonEmptyString(file['baseBranch']) ?? DEFAULT_BASE_BRANCH,
    judgeBin: nonEmptyString(file['judgeBin']) ?? DEFAULT_JUDGE_BIN,
    judgeTimeoutMs: positiveNumber(file['judgeTimeoutMs']) ?? DEFAULT_JUDGE_TIMEOUT_MS,
    maxSessions: positiveNumber(file['maxSessions']) ?? DEFAULT_MAX_SESSIONS,
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Anything short of a positive number falls back rather than silently disabling what the
 *  number bounds: a bound of zero or below would dispatch nothing or without limit, and
 *  `execFile` arms its timeout only when it is greater than zero. */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
