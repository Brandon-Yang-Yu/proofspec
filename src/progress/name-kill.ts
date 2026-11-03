import type { ExtensionAPI, ToolCallEventResult } from '@earendil-works/pi-coding-agent'

/**
 * The name-kill guard (`specs/progress.md`): a `pi` session's bash call that kills
 * processes by name is refused before it runs. pkill, killall and `pgrep … | kill` reach
 * every matching process on the machine, not just the caller's — one session's
 * `pkill -f "spec:review"`, meant for its own helper, once killed three other executors
 * whose command lines held that word. A kill by PID reaches only what the caller names.
 */

/** Only a command word counts — at the start, or after `;`, `&`, `|`, `(`, `$(`, `sudo` or
 *  `xargs` — so text that merely mentions a kill command, such as `grep pkill notes.md`,
 *  still runs. */
const NAME_KILL_PATTERNS: readonly RegExp[] = [
  /(^|[;&|(]|\$\(|\bsudo|\bxargs)\s*(pkill|killall)\b/,
  /pgrep[^;&]*\|\s*xargs\s+(-\S+\s+)*kill\b/,
  /\bkill\b[^;&|]*\$\(\s*pgrep\b/,
]

export const NAME_KILL_REASON =
  'Blocked: pkill, killall and `pgrep ... | kill` match processes by name across the whole machine, ' +
  'so they also kill other sessions\' work. Stop only what you started: `kill <pid>` with the PID ' +
  'you recorded when you started it.'

/** Whether a shell command kills processes by name or command-line match. */
export function killsByName(command: string): boolean {
  return NAME_KILL_PATTERNS.some(pattern => pattern.test(command))
}

/** Subscribes the guard to `tool_call`, the one event pi lets a handler block a call from.
 *  Also the default export, so a `pi` setup outside the executor's pinned extension (the
 *  global extensions folder, say) can load the same guard as an extension of its own. */
export default function guardNameKill(pi: ExtensionAPI): void {
  pi.on('tool_call', (event): ToolCallEventResult | undefined => {
    if (event.toolName !== 'bash') return undefined
    const command: unknown = event.input.command
    if (typeof command !== 'string' || !killsByName(command)) return undefined
    return { block: true, reason: NAME_KILL_REASON }
  })
}
