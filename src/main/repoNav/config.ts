/**
 * Repo Navigator configuration resolution.
 *
 * Resolution chain (matches the PS CLI version):
 *   1. $env:REPO_NAVIGATOR_CONFIG
 *   2. ~/.repo-navigator/config.json
 *   3. Copy template from <app root>/scripts/repo-nav/config.example.json
 *      (if available, then use the user copy)
 *   4. Hardcoded defaults (fallback)
 *
 * The resolved config is cached in-memory for the lifetime of the process.
 *
 * IMPORTANT: On every load, getConfig() calls migrateLegacyConfig() to
 * transparently convert old-format configs (Record<string,string> commandTemplates)
 * to the new CommandTemplate[] format.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import type { RepoNavConfig } from '../../shared/repoNav'
import { DEFAULT_TEMPLATES, migrateLegacyConfig } from '../../shared/repoNav'

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
  defaultTemplate: 'default',
  openIn: 'new-tab',
  fallbackToPowerShellExe: true
}

// ── Cached config ──────────────────────────────────────────────────────────

let cachedConfig: RepoNavConfig | null = null
let cachedConfigPath: string | null = null

/**
 * Returns the path to the user's config directory (~/.repo-navigator),
 * creating it if it doesn't exist.
 */
function ensureUserConfigDir(): string {
  const dir = join(homedir(), '.repo-navigator')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Resolve the config file path using the same priority chain as the PS CLI.
 * Returns the path string, or null if no config exists and no template is
 * available.
 */
export function getConfigPath(): string | null {
  if (cachedConfigPath) return cachedConfigPath

  // Priority 1: Environment variable
  const envPath = process.env['REPO_NAVIGATOR_CONFIG']
  if (envPath && existsSync(envPath)) {
    cachedConfigPath = envPath
    return cachedConfigPath
  }

  // Priority 2: User profile location
  const userConfig = join(homedir(), '.repo-navigator', 'config.json')
  if (existsSync(userConfig)) {
    cachedConfigPath = userConfig
    return cachedConfigPath
  }

  // Priority 3: Try to copy template from the app's scripts directory
  try {
    const templatePath = join(app.getAppPath(), 'scripts', 'repo-nav', 'config.example.json')
    if (existsSync(templatePath)) {
      const userDir = ensureUserConfigDir()
      const destPath = join(userDir, 'config.json')
      copyFileSync(templatePath, destPath)
      cachedConfigPath = destPath
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
 * Write a new config to the user's config path and update the in-memory cache.
 * If no config path exists yet, creates one in ~/.repo-navigator/config.json.
 */
export function saveConfig(cfg: RepoNavConfig): void {
  const userDir = ensureUserConfigDir()
  const cfgPath = resolveConfigPath() ?? join(userDir, 'config.json')

  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')

  // Update both cache entries
  cachedConfig = cfg
  cachedConfigPath = cfgPath
}

/**
 * Clear the in-memory config cache (useful for testing).
 */
export function clearConfigCache(): void {
  cachedConfig = null
  cachedConfigPath = null
}
