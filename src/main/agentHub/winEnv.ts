/**
 * Windows PATH reconstruction from the registry (v1.25.5).
 *
 * WHY: the packaged app's process PATH can be severely sanitized — observed
 * live without even System32 (so `where.exe` itself fails to spawn), most
 * commonly after electron-updater relaunches the app. Hardcoded install-dir
 * lists cannot cover custom install locations (e.g. Git at D:\Tool\Git).
 *
 * WHAT: rebuild the logon-equivalent PATH exactly the way Windows composes
 * it — HKLM (machine) PATH + HKCU (user) PATH, %VAR%-expanded — read via
 * the ABSOLUTE path to reg.exe (System32 is always on disk even when absent
 * from PATH). Merged AFTER the existing PATH (never removes entries), so
 * agents' git/node/hooks/MCP resolve exactly like in a fresh terminal.
 *
 * Pure parsing/merging helpers are exported for unit tests; only
 * rebuildRegistryPath() touches the OS.
 */

import { spawnSync } from 'child_process'
import { join } from 'path'

/** Absolute reg.exe path — independent of (possibly sanitized) PATH. */
function regExePath(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return join(root, 'System32', 'reg.exe')
}

/**
 * Extract the PATH value from `reg query <key> /v PATH` output.
 * Handles both REG_SZ and REG_EXPAND_SZ and values containing spaces.
 * Pure — unit tested.
 */
export function parseRegQueryPathValue(output: string): string | null {
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^\s*PATH\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i)
    if (m) return m[1].trim()
  }
  return null
}

/**
 * Expand %VAR% references using the given variable table (case-insensitive,
 * like ExpandEnvironmentStrings). Unknown vars stay literal. Repeats once to
 * allow single-level nesting. Pure — unit tested.
 */
export function expandEnvVars(value: string, vars: Record<string, string | undefined>): string {
  // Case-insensitive lookup table (Windows env var names ignore case).
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) lower[k.toLowerCase()] = v
  }
  let out = value
  for (let pass = 0; pass < 2; pass++) {
    const next = out.replace(/%([^%]+)%/g, (whole, name: string) => {
      const hit = lower[String(name).toLowerCase()]
      return hit !== undefined ? hit : whole
    })
    if (next === out) break
    out = next
  }
  return out
}

/** Split a PATH string into trimmed, non-empty entries. Pure. */
export function splitPathEntries(pathValue: string): string[] {
  return pathValue
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
}

/**
 * Merge PATH sources into one deduplicated value. Dedup key is
 * case-insensitive with slashes unified and trailing separators stripped
 * (C:\Git\cmd == c:/git/cmd/). Order = first occurrence wins; earlier
 * sources take priority. Pure — unit tested.
 */
export function mergePathEntries(...sources: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const source of sources) {
    for (const entry of splitPathEntries(source)) {
      const key = entry.toLowerCase().replace(/\//g, '\\').replace(/[\\/]+$/, '')
      if (seen.has(key)) continue
      seen.add(key)
      out.push(entry)
    }
  }
  return out.join(';')
}

/** Query one registry key's PATH via absolute reg.exe. Returns '' on failure. */
function queryRegistryPath(key: string): string {
  try {
    const r = spawnSync(regExePath(), ['query', key, '/v', 'PATH'], {
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (r.error || r.status !== 0) return ''
    return parseRegQueryPathValue(`${r.stdout ?? ''}${r.stderr ?? ''}`) ?? ''
  } catch {
    return ''
  }
}

const MACHINE_ENV_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_ENV_KEY = 'HKCU\\Environment'

/** How many registry entries the last rebuild added (for diagnostics). */
export let lastRebuildAddedCount = 0

/**
 * Reconstruct the logon-equivalent registry PATH (machine + user, expanded),
 * cached for the process lifetime — the same semantics Windows applies to
 * new logon sessions. Returns '' when the registry is unreadable; callers
 * must treat that as "keep the current PATH".
 */
let cachedRegistryPath: string | null = null
export function rebuildRegistryPath(): string {
  if (cachedRegistryPath !== null) return cachedRegistryPath
  const machineRaw = queryRegistryPath(MACHINE_ENV_KEY)
  const userRaw = queryRegistryPath(USER_ENV_KEY)
  if (!machineRaw && !userRaw) {
    cachedRegistryPath = ''
    return cachedRegistryPath
  }
  const machine = expandEnvVars(machineRaw, process.env)
  const user = expandEnvVars(userRaw, process.env)
  cachedRegistryPath = mergePathEntries(machine, user)
  lastRebuildAddedCount = splitPathEntries(cachedRegistryPath).length
  return cachedRegistryPath
}

/**
 * The effective search PATH for PTY/child processes: current PATH first
 * (never remove anything), then missing registry entries, then any extra
 * dirs the caller supplies.
 */
export function effectivePath(extraDirs: string[] = []): string {
  return mergePathEntries(process.env.PATH ?? '', rebuildRegistryPath(), extraDirs.join(';'))
}
