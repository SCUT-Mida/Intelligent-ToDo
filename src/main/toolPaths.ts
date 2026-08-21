/**
 * App-wide common tool paths (v1.25.5) — git / node.
 *
 * ONE configuration (设置 → 通用 → 工具路径, persisted on AppData) shared by
 * every subsystem that needs these binaries:
 *   - AgentHub PTY env / task runner: the tools' directories go FIRST on the
 *     rebuilt PATH, so agents' git/node subprocesses resolve them
 *   - RepoNav: falls back to the common git when its own override is empty
 *   - Diagnosis: reports the effective configuration
 *
 * This complements the registry PATH rebuild (winEnv.ts): explicit user
 * pinning wins over everything, registry covers the rest.
 */

import { app } from 'electron'
import { readFileSync, existsSync } from 'fs'
import { join, dirname, isAbsolute } from 'path'
import type { ToolPaths } from '../shared/types'

/** Read the persisted common tool paths from todo-data.json (defensive). */
export function getToolPaths(): ToolPaths {
  try {
    const dataPath = join(app.getPath('userData'), 'todo-data.json')
    if (!existsSync(dataPath)) return {}
    const parsed = JSON.parse(readFileSync(dataPath, 'utf-8')) as {
      toolPaths?: Partial<ToolPaths>
    }
    const out: ToolPaths = {}
    if (typeof parsed.toolPaths?.git === 'string' && parsed.toolPaths.git.trim()) {
      out.git = parsed.toolPaths.git.trim()
    }
    if (typeof parsed.toolPaths?.node === 'string' && parsed.toolPaths.node.trim()) {
      out.node = parsed.toolPaths.node.trim()
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Directories of the configured (absolute, existing) tools — to be prepended
 * to PATH candidates in buildPtyEnv. Empty strings filtered out.
 */
export function toolPathDirs(): string[] {
  const dirs: string[] = []
  const { git, node } = getToolPaths()
  for (const p of [git, node]) {
    if (p && isAbsolute(p) && existsSync(p)) {
      const d = dirname(p)
      if (!dirs.includes(d)) dirs.push(d)
    }
  }
  return dirs
}

/** Effective git binary for RepoNav: RepoNav override > common config > default. */
export function effectiveGitBinary(repoNavOverride?: string): string {
  const own = (repoNavOverride ?? '').trim()
  if (own) return own
  const common = getToolPaths().git
  if (common && isAbsolute(common) && existsSync(common)) return common
  return 'git'
}
