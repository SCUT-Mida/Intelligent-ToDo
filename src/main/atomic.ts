/**
 * Shared atomic JSON persistence helpers (v1.23).
 *
 * One implementation of the tmp+rename write pattern that already existed
 * in three slightly-different copies (repoNav/userData.ts, aiMemory.ts,
 * tokenMeter.ts). Rename is atomic on both NTFS and POSIX, so a crash
 * mid-write can never leave a half-written main file — at worst a stale
 * .tmp.<ts> file remains.
 */

import { writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { dirname } from 'path'

/** Write JSON atomically (tmp file + rename). Throws on failure. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  try {
    renameSync(tmp, path)
  } catch {
    // Windows AV/indexers can hold the target briefly — one rename retry
    // with the same tmp file (mirrors repoNav/userData.ts' behavior).
    if (existsSync(tmp)) renameSync(tmp, path)
  }
}

/**
 * Read + parse JSON with corruption handling: on a parse failure the file
 * is backed up as `<path>.corrupt-<ts>` before the error is re-thrown, so
 * the caller can safely fall back to defaults without losing the original.
 */
export function readJsonWithBackup<T>(path: string): T {
  const raw = readFileSync(path, 'utf-8')
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      copyFileSync(path, `${path}.corrupt-${ts}`)
    } catch {
      // Backup failure is non-fatal — still surface the parse error.
    }
    throw err
  }
}
