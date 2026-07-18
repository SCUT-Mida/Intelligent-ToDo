/**
 * A minimal `which` utility for Windows.
 * Resolves an executable name to a full path by searching PATH.
 *
 * This is kept in a separate file so it can be unit-tested independently.
 * Uses only Node built-ins (child_process) to avoid external dependencies.
 */

import { execFileSync } from 'child_process'

/**
 * Check if an executable is available on the system PATH.
 * On Windows, this uses `where.exe <name>` and returns true if found.
 *
 * @param exe - The executable name (e.g. "wt.exe", "powershell.exe").
 * @returns true if the executable was found on PATH.
 */
export async function which(exe: string): Promise<boolean> {
  try {
    execFileSync('where', [exe], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}
