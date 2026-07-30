/**
 * Agent Hub — built-in agent registry & argument building.
 *
 * Re-exports the definitions from the shared layer and provides helpers to
 * build the concrete spawn arguments for a given prompt (and optional resume
 * session id).
 */

import { BUILTIN_AGENTS } from '../../shared/agentHub'
import type { AgentDefinition } from '../../shared/agentHub'

export { BUILTIN_AGENTS }

/**
 * Build the concrete argument list for a non-interactive agent invocation.
 *
 * Substitutes `{PROMPT}` → the user's message and `{SESSION}` → the native
 * session id. For resume-capable agents that have a nativeSessionId, prepends
 * `--resume <id>` so the agent continues the prior conversation context.
 *
 * Returns the full args array ready for child_process.spawn.
 */
export function buildSpawnArgs(
  agent: AgentDefinition,
  prompt: string,
  nativeSessionId?: string
): string[] {
  const canResume = agent.resumeCapable && !!nativeSessionId
  const sessionSub = nativeSessionId ?? ''

  const base = agent.printArgs.map((arg) => {
    if (arg === '{PROMPT}') return prompt
    if (arg === '{SESSION}') return sessionSub
    return arg
  })

  // Resume-capable agents (claude): prepend --resume <id> when we have one.
  // Claude's CLI: `claude --resume <session_id> -p "<prompt>" ...`
  if (canResume) {
    return ['--resume', sessionSub, ...base]
  }

  return base
}
