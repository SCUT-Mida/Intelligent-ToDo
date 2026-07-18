/**
 * A minimal `which` utility for Windows.
 *
 * Returns detailed result with the resolved path on success or a descriptive
 * error on failure. Falls back to known absolute paths when `where.exe` fails
 * (a known issue in some packaged-Electron contexts where the spawned process
 * inherits a sanitized PATH that confuses `where`).
 *
 * This is kept in a separate file so it can be unit-tested independently.
 * Uses only Node built-ins (child_process, fs) to avoid external dependencies.
 */

import { execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { logger } from '../logger'

export interface WhichResult {
  /** Whether the tool was found. */
  ok: boolean
  /** Resolved absolute path on success. */
  path?: string
  /** Human-readable failure reason on failure. */
  error?: string
  /** Which strategy found it: 'where' (PATH lookup) or 'fallback' (known-path absolute check) or 'absolute' (input was absolute and exists). */
  via?: 'where' | 'fallback' | 'absolute'
}

/**
 * Windows-known absolute paths for common tools. Used as a fallback when
 * `where.exe` fails or returns non-zero. These are the canonical install
 * locations that should exist on any modern Windows system.
 */
const WINDOWS_KNOWN_PATHS: Record<string, string[]> = {
  'wt.exe': [
    `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\WindowsApps\\wt.exe`
  ],
  'powershell.exe': [
    `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  ],
  'pwsh.exe': [
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\PowerShell\\7\\pwsh.exe`,
    `${process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'}\\PowerShell\\7\\pwsh.exe`
  ],
  'git': [
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\cmd\\git.exe`,
    `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\git.exe`
  ]
}

/**
 * Check if an executable is available. Tries `where.exe` first (PATH lookup),
 * then falls back to known absolute paths on Windows.
 *
 * @param exe - The executable name (e.g. "wt.exe", "powershell.exe") or an
 *              absolute path (e.g. "C:\\Program Files\\Git\\bin\\git.exe").
 * @returns Detailed result with path on success or error on failure.
 */
export async function which(exe: string): Promise<WhichResult> {
  const trimmed = exe.trim()
  if (!trimmed) {
    return { ok: false, error: 'empty executable name' }
  }

  // Strategy 1: if the input is already an absolute path that exists, use it.
  // (Faster than spawning `where` for the common case where the user pasted
  // an absolute path via the 浏览… file picker.)
  if (process.platform === 'win32' && /^[A-Za-z]:[\\/]/.test(trimmed)) {
    if (existsSync(trimmed)) {
      logger.info('which', `absolute path exists: ${trimmed}`)
      return { ok: true, path: trimmed, via: 'absolute' }
    }
    logger.warn('which', `absolute path does not exist: ${trimmed}`)
    return { ok: false, error: `absolute path does not exist: ${trimmed}` }
  }

  // Strategy 2: try `where.exe` for PATH lookup.
  // Capture stderr so we can log the actual failure reason (the previous
  // implementation swallowed it, making diagnosis impossible).
  try {
    const stdout = execFileSync('where', [trimmed], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const path = stdout.split(/\r?\n/)[0]?.trim()
    if (path) {
      logger.info('which', `found via PATH: ${trimmed}`, { path })
      return { ok: true, path, via: 'where' }
    }
    logger.warn('which', `where returned empty output for ${trimmed}`)
  } catch (err) {
    const meta = err && typeof err === 'object' && 'status' in err
      ? { status: (err as { status: number }).status, stderr: String(err) }
      : { error: err instanceof Error ? err.message : String(err) }
    logger.warn('which', `where failed for ${trimmed}`, meta)
  }

  // Strategy 3: Windows fallback — check known absolute paths.
  if (process.platform === 'win32') {
    const lower = trimmed.toLowerCase()
    const known = WINDOWS_KNOWN_PATHS[lower]
    if (known && known.length > 0) {
      for (const p of known) {
        if (p && existsSync(p)) {
          logger.info('which', `found via known-path fallback: ${trimmed}`, { path: p })
          return { ok: true, path: p, via: 'fallback' }
        }
      }
      logger.warn('which', `none of ${known.length} known paths exist for ${trimmed}`, { tried: known })
    }
  }

  logger.warn('which', `not found: ${trimmed}`)
  return { ok: false, error: `${trimmed} not found on PATH or known locations` }
}
