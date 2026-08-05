/**
 * Agent Hub — detect installed CLI agents.
 *
 * Probes each built-in agent's executable via a multi-strategy search:
 *   1. which() (where.exe PATH lookup + repoNav known paths)
 *   2. User-level install directories (npm global, cargo, .local/bin, etc.)
 *
 * Strategy 2 is CRITICAL for packaged Electron apps: the GUI process inherits
 * a sanitized PATH that often excludes user-level bin directories added by
 * npm/pipx/cargo installers. `where.exe` only searches this sanitized PATH,
 * so tools installed via `npm install -g` (claude, gemini, etc.) are invisible
 * even though they exist on disk.
 */

import { existsSync } from 'fs'
import { join } from 'path'
import { BUILTIN_AGENTS } from '../../shared/agentHub'
import type { AgentDescriptor, AgentDefinition } from '../../shared/agentHub'
import { which } from '../repoNav/which'
import { logger } from '../logger'

/**
 * Common user-level bin directories where CLI agents are installed on Windows.
 * Checked as a fallback when both `where.exe` and repoNav known-paths fail.
 *
 * The `%APPDATA%\npm` directory is where `npm install -g` puts shims on Windows.
 */
const USER_BIN_DIRS: string[] = [
  // npm global installs (shims: claude.cmd, gemini.cmd, etc.)
  join(process.env.APPDATA ?? '', 'npm'),
  // Python pipx / pip --user installs
  join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
  // Rust cargo installs
  join(process.env.USERPROFILE ?? '', '.cargo', 'bin'),
  // Generic ~/.local/bin (Unix-style tools ported to Windows)
  join(process.env.USERPROFILE ?? '', '.local', 'bin'),
  // Homebrew on Windows (less common but exists)
  join(process.env.USERPROFILE ?? '', '.brew', 'bin')
]

/**
 * Windows executable extensions to try when probing a bare command name
 * in user bin directories. npm shims are .cmd files; native binaries are .exe.
 */
const EXE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.ps1']

/**
 * Search user-level bin directories for a command. Returns the first match.
 */
function findInUserDirs(command: string): string | null {
  for (const dir of USER_BIN_DIRS) {
    if (!dir) continue
    for (const ext of EXE_EXTENSIONS) {
      const candidate = join(dir, command + ext)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return null
}

/**
 * Detect all agents (built-in + custom). Returns AgentDescriptor[] with
 * `detected` and `resolvedPath` filled in. Never throws — detection failures
 * become `detected: false`.
 *
 * @param extraAgents custom agent definitions from AgentHubConfig.customAgents.
 *   Detected alongside built-ins. On an id collision with a built-in, the
 *   custom agent wins (it is iterated first and deduped by id).
 * @param agentArgs per-agent startup args from AgentHubConfig.agentArgs, keyed
 *   by agent id. When present for an agent, it is resolved into the returned
 *   descriptor's `args` field (the UI display source). Applies to both
 *   built-in and custom agents.
 *
 * Detection order:
 *   1. which() — where.exe PATH lookup + repoNav known paths
 *   2. User-level bin dirs — npm/cargo/pipx install locations
 */
export async function detectAgents(
  extraAgents: AgentDefinition[] = [],
  agentArgs: Record<string, string> = {}
): Promise<AgentDescriptor[]> {
  const results: AgentDescriptor[] = []

  // Start with custom agents so they win on id collision with built-ins,
  // then append built-ins that weren't already claimed.
  const seen = new Set<string>()
  const allAgents: AgentDefinition[] = []
  for (const agent of [...extraAgents, ...BUILTIN_AGENTS]) {
    if (!seen.has(agent.id)) {
      seen.add(agent.id)
      allAgents.push(agent)
    }
  }

  for (const def of allAgents) {
    const resolvedArgs = agentArgs[def.id]
    try {
      // Strategy 1: standard which() (where.exe + repoNav known paths)
      const probe = await which(def.command)
      if (probe.ok) {
        results.push({
          ...def,
          detected: true,
          resolvedPath: probe.path,
          ...(resolvedArgs ? { args: resolvedArgs } : {})
        })
        logger.info('agentHub:detect', `found ${def.command}`, { path: probe.path, via: probe.via })
        continue
      }

      // Strategy 2: user-level bin directories (npm global, cargo, etc.)
      // Critical for packaged Electron where PATH is sanitized.
      const userPath = findInUserDirs(def.command)
      if (userPath) {
        results.push({
          ...def,
          detected: true,
          resolvedPath: userPath,
          ...(resolvedArgs ? { args: resolvedArgs } : {})
        })
        logger.info('agentHub:detect', `found ${def.command} in user dirs`, { path: userPath, via: 'user-bin' })
        continue
      }

      results.push({ ...def, detected: false, ...(resolvedArgs ? { args: resolvedArgs } : {}) })
      logger.info('agentHub:detect', `${def.command} not found`, { error: probe.error })
    } catch (err) {
      // Defensive — which() shouldn't throw, but guard anyway.
      logger.warn('agentHub:detect', `detection threw for ${def.command}`, {
        error: err instanceof Error ? err.message : String(err)
      })
      results.push({ ...def, detected: false, ...(resolvedArgs ? { args: resolvedArgs } : {}) })
    }
  }

  return results
}
