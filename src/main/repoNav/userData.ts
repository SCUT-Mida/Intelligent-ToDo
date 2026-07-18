/**
 * Per-user repo data persistence: favorites, user-defined tags, open counts.
 *
 * Stored at <userData>/repo-nav/user-data.json. Kept separate from the
 * config (which holds only static settings) so user behavior data survives
 * config changes and re-imports.
 *
 * All operations are synchronous and atomic (write to temp file, rename).
 * An in-memory cache avoids re-reading the file on every IPC call.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { logger } from '../logger'
import { dataFilePath } from './paths'
import type { RepoUserData } from '../../shared/repoNav'
import { createDefaultUserData } from '../../shared/repoNav'

let cached: RepoUserData | null = null

/**
 * Load user data from disk, populating the in-memory cache on first access.
 * Returns a fresh default on first run or any read error (so the app never
 * crashes because of corrupted user data).
 */
export function getUserData(): RepoUserData {
  if (cached) return cached

  try {
    const path = dataFilePath('user-data.json')
    if (existsSync(path)) {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<RepoUserData>
      cached = {
        version: 1,
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        userTags: parsed.userTags && typeof parsed.userTags === 'object' ? parsed.userTags : {},
        openCounts: parsed.openCounts && typeof parsed.openCounts === 'object' ? parsed.openCounts : {},
        lastOpenedAt: parsed.lastOpenedAt && typeof parsed.lastOpenedAt === 'object' ? parsed.lastOpenedAt : {},
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
      }
      return cached
    }
  } catch (err) {
    logger.error('userData', 'load failed, using defaults', { error: err instanceof Error ? err.message : String(err) })
  }

  cached = createDefaultUserData()
  return cached
}

/**
 * Persist user data atomically. Updates the in-memory cache.
 * Throws on write failure so callers can surface errors to the UI.
 */
export function saveUserData(data: RepoUserData): void {
  const path = dataFilePath('user-data.json')
  const tmpPath = path + '.tmp.' + Date.now()
  const toWrite: RepoUserData = {
    ...data,
    version: 1,
    updatedAt: new Date().toISOString()
  }
  try {
    writeFileSync(tmpPath, JSON.stringify(toWrite, null, 2), 'utf-8')
    renameSync(tmpPath, path)
    cached = toWrite
  } catch (err) {
    // Try to clean up the temp file if rename failed
    try {
      if (existsSync(tmpPath)) renameSync(tmpPath, path)
    } catch { /* ignore */ }
    logger.error('userData', 'save failed', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}

/**
 * Increment the open count for a repo path. Called automatically when the
 * user opens a repo (from the OPEN_REPO IPC handler). Silently no-ops on
 * write failure — we don't want to fail the open operation because of a
 * stats-update problem.
 */
export function incrementOpenCount(repoPath: string): void {
  try {
    const data = getUserData()
    data.openCounts[repoPath] = (data.openCounts[repoPath] ?? 0) + 1
    data.lastOpenedAt[repoPath] = new Date().toISOString()
    saveUserData(data)
    logger.info('userData', 'incremented open count', {
      repoPath,
      newCount: data.openCounts[repoPath]
    })
  } catch (err) {
    logger.warn('userData', 'failed to increment open count (non-fatal)', {
      repoPath,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
