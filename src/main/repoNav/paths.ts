/**
 * Centralized path resolution for all Repo Navigator data files.
 *
 * All repo-nav files now live under `<userData>/repo-nav/` so that the app's
 * data stays in ONE directory instead of being scattered across
 * `~/.repo-navigator/` and `<userData>/`.
 *
 * Migration: On first access, if the new path doesn't exist but the legacy
 * `~/.repo-navigator/` location has the file, we copy it over (NOT move — the
 * legacy file is left in place so users can roll back if needed).
 *
 * Priority for the config file specifically (handled in config.ts):
 *   1. $env:REPO_NAVIGATOR_CONFIG (escape hatch for testing / PS CLI)
 *   2. <userData>/repo-nav/config.json (primary)
 *   3. ~/.repo-navigator/config.json (legacy, auto-migrated to #2)
 *   4. In-memory defaults
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'

/** Legacy directory used by the old PS CLI version (kept for migration). */
export const LEGACY_DIR = join(homedir(), '.repo-navigator')

/**
 * The primary data directory: `<userData>/repo-nav/`.
 * Created on first call. This is the single source of truth for all paths.
 */
export function getDataDir(): string {
  const dir = join(app.getPath('userData'), 'repo-nav')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Absolute path for a data file inside the primary data directory.
 * Auto-creates the directory if missing.
 */
export function dataFilePath(filename: string): string {
  return join(getDataDir(), filename)
}

/**
 * Absolute path for a legacy file in `~/.repo-navigator/`.
 * Does NOT auto-create the directory.
 */
export function legacyFilePath(filename: string): string {
  return join(LEGACY_DIR, filename)
}

/**
 * One-time migration: if the new path doesn't exist but the legacy file does,
 * copy it over. Safe to call multiple times — no-ops once the new file exists.
 *
 * @param filename  e.g. 'config.json', 'index.json', 'repo-memory.json'
 * @returns true if a migration occurred (file was copied).
 */
export function migrateFromLegacy(filename: string): boolean {
  const newPath = dataFilePath(filename)
  if (existsSync(newPath)) return false

  const legacyPath = legacyFilePath(filename)
  if (!existsSync(legacyPath)) return false

  try {
    // getDataDir() ensures the parent exists
    copyFileSync(legacyPath, newPath)
    return true
  } catch {
    // Migration is best-effort; fall back to fresh defaults
    return false
  }
}
