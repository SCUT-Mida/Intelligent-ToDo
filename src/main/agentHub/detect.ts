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
import type { AgentDescriptor } from '../../shared/agentHub'
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
 * Detect all built-in agents. Returns AgentDescriptor[] with `detected` and
 * `resolvedPath` filled in. Never throws — detection failures become
 * `detected: false`.
 *
 * Detection order:
 *   1. which() — where.exe PATH lookup + repoNav known paths
 *   2. User-level bin dirs — npm/cargo/pipx install locations
 */
export async function detectAgents(): Promise<AgentDescriptor[]> {
  const results: AgentDescriptor[] = []

  for (const def of BUILTIN_AGENTS) {
    try {
      // Strategy 1: standard which() (where.exe + repoNav known paths)
      const probe = await which(def.command)
      if (probe.ok) {
        results.push({ ...def, detected: true, resolvedPath: probe.path })
        logger.info('agentHub:detect', `found ${def.command}`, { path: probe.path, via: probe.via })
        continue
      }

      // Strategy 2: user-level bin directories (npm global, cargo, etc.)
      // Critical for packaged Electron where PATH is sanitized.
      const userPath = findInUserDirs(def.command)
      if (userPath) {
        results.push({ ...def, detected: true, resolvedPath: userPath })
        logger.info('agentHub:detect', `found ${def.command} in user dirs`, { path: userPath, via: 'user-bin' })
        continue
      }

      results.push({ ...def, detected: false })
      logger.info('agentHub:detect', `${def.command} not found`, { error: probe.error })
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
