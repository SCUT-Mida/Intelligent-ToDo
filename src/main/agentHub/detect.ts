/**
 * Agent Hub — detect installed CLI agents.
 *
 * Probes each built-in agent's executable via the shared `which` utility
 * (PATH lookup + known-absolute-path fallback) so the UI can show which
 * agents are actually available on this machine.
 */

import { BUILTIN_AGENTS } from '../../shared/agentHub'
import type { AgentDescriptor } from '../../shared/agentHub'
import { which } from '../repoNav/which'
import { logger } from '../logger'

/**
 * Detect all built-in agents. Returns AgentDescriptor[] with `detected` and
 * `resolvedPath` filled in. Never throws — detection failures become
 * `detected: false`.
 */
export async function detectAgents(): Promise<AgentDescriptor[]> {
  const results: AgentDescriptor[] = []

  for (const def of BUILTIN_AGENTS) {
    try {
      const probe = await which(def.command)
      results.push({
        ...def,
        detected: probe.ok,
        resolvedPath: probe.path
      })
      if (probe.ok) {
        logger.info('agentHub:detect', `found ${def.command}`, { path: probe.path, via: probe.via })
      } else {
        logger.info('agentHub:detect', `${def.command} not found`, { error: probe.error })
      }
    } catch (err) {
      // Defensive — which() shouldn't throw, but guard anyway.
      logger.warn('agentHub:detect', `detection threw for ${def.command}`, {
        error: err instanceof Error ? err.message : String(err)
      })
      results.push({ ...def, detected: false })
    }
  }

  return results
}
