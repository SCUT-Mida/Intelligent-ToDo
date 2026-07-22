/**
 * Repo Navigator configuration resolution.
 *
 * Resolution chain:
 *   1. $env:REPO_NAVIGATOR_CONFIG (escape hatch for testing / PS CLI sharing)
 *   2. <userData>/repo-nav/config.json  (primary — app data consolidated here)
 *   3. ~/.repo-navigator/config.json    (legacy — auto-migrated to #2 on first access)
 *   4. Template from <app root>/scripts/repo-nav/config.example.json
 *      (copied to #2)
 *   5. Hardcoded defaults (fallback)
 *
 * The resolved config is cached in-memory for the lifetime of the process.
 *
 * IMPORTANT: On every load, getConfig() calls migrateLegacyConfig() to
 * transparently convert old-format configs (Record<string,string> commandTemplates)
 * to the new CommandTemplate[] format.
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { RepoNavConfig } from '../../shared/repoNav'
import { DEFAULT_TEMPLATES, DEFAULT_COMMANDS, migrateLegacyConfig } from '../../shared/repoNav'
import { dataFilePath, legacyFilePath, migrateFromLegacy } from './paths'

// ── Default values used when no config file exists ─────────────────────────

const DEFAULT_CONFIG: RepoNavConfig = {
  scanRoots: ['D:\\Coding'],
  scanDepth: 3,
  excludePatterns: [
    'node_modules',
    '.git',
    'dist',
    'out',
    'build',
    '__pycache__',
    '.venv',
    'vendor'
  ],
  commandTemplates: DEFAULT_TEMPLATES,
  commands: DEFAULT_COMMANDS,
  defaultTemplate: 'default',
  openIn: 'new-tab',
  fallbackToPowerShellExe: true
}

// ── Cached config ──────────────────────────────────────────────────────────

let cachedConfig: RepoNavConfig | null = null
let cachedConfigPath: string | null = null

/**
 * Resolve the config file path using the priority chain.
 * Returns the path string, or null if no config exists and no template is
 * available.
 *
 * Side effect: triggers one-time legacy migration if applicable.
 */
export function getConfigPath(): string | null {
  if (cachedConfigPath) return cachedConfigPath

  // Priority 1: Environment variable (escape hatch)
  const envPath = process.env['REPO_NAVIGATOR_CONFIG']
  if (envPath && existsSync(envPath)) {
    cachedConfigPath = envPath
    return cachedConfigPath
  }

  // Priority 2: Primary location (<userData>/repo-nav/config.json)
  const primaryPath = dataFilePath('config.json')
  if (existsSync(primaryPath)) {
    cachedConfigPath = primaryPath
    return cachedConfigPath
  }

  // Priority 3: Legacy migration from ~/.repo-navigator/config.json
  if (migrateFromLegacy('config.json')) {
    cachedConfigPath = primaryPath
    return cachedConfigPath
  }

  // Priority 4: Try to copy template from the app's scripts directory
  try {
    const templatePath = join(app.getAppPath(), 'scripts', 'repo-nav', 'config.example.json')
    if (existsSync(templatePath)) {
      copyFileSync(templatePath, primaryPath)
      cachedConfigPath = primaryPath
      return cachedConfigPath
    }
  } catch {
    // Silently continue if template copy fails (e.g. in packaged app)
  }

  // No config found at all
  return null
}

/**
 * Returns the cached config path, or attempts to resolve it.
 */
function resolveConfigPath(): string | null {
  return cachedConfigPath ?? getConfigPath()
}

/**
 * Load the RepoNavConfig from the resolved config path.
 * If no config file exists, returns the hardcoded defaults.
 *
 * Automatically migrates legacy configs (Record<string,string> commandTemplates)
 * to the new CommandTemplate[] format on every load.
 */
export function getConfig(): RepoNavConfig {
  if (cachedConfig) return cachedConfig

  const cfgPath = resolveConfigPath()
  if (cfgPath && existsSync(cfgPath)) {
    try {
      const raw = readFileSync(cfgPath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      const migrated = migrateLegacyConfig(parsed)
      // Merge with defaults so missing fields don't crash the app
      cachedConfig = { ...DEFAULT_CONFIG, ...migrated }
      return cachedConfig
    } catch {
      // Fall through to defaults on parse error
    }
  }

  cachedConfig = { ...DEFAULT_CONFIG }
  return cachedConfig
}

/**
 * Write a new config to the resolved config path and update the in-memory cache.
 * Always writes to the primary location (<userData>/repo-nav/config.json),
 * even if the config was originally loaded from the env var or legacy path.
 */
export function saveConfig(cfg: RepoNavConfig): void {
  const primaryPath = dataFilePath('config.json')

  // If the user is currently using the env var path, respect it and write there.
  // Otherwise always write to the primary location.
  const envPath = process.env['REPO_NAVIGATOR_CONFIG']
  const targetPath = envPath && existsSync(envPath) ? envPath : primaryPath

  writeFileSync(targetPath, JSON.stringify(cfg, null, 2), 'utf-8')

  // Update both cache entries
  cachedConfig = cfg
  cachedConfigPath = targetPath
}

/**
 * Clear the in-memory config cache (useful for testing).
 */
export function clearConfigCache(): void {
  cachedConfig = null
  cachedConfigPath = null
}

/**
 * Re-export of the legacy file path helper for any external consumers
 * (e.g. a "migrate now" UI button in the future).
 */
export function getLegacyConfigPath(): string {
  return legacyFilePath('config.json')
}
