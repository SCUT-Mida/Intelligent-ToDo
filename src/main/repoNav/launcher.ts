/**
 * Terminal launcher for the Repo Navigator.
 *
 * Ported from scripts/repo-nav/Private/Invoke-WtCommand.ps1.
 *
 * Tries to open a new Windows Terminal tab/window at the given repo path
 * with the specified command. Falls back to powershell.exe if wt.exe is
 * not on PATH.
 *
 * All processes are spawned detached with stdio ignored so they survive the
 * Electron app's exit.
 */

import { spawn } from 'child_process'
import { which } from './which'
import type { OpenRepoResult } from '../../shared/repoNav'

/**
 * Open a new terminal session at the given repo path.
 *
 * @param repoPath - Absolute path to the repository directory.
 * @param command  - The command string to execute (e.g. "git pull; opencode").
 * @param mode     - "new-tab" (default) or "new-window".
 * @returns A result object indicating success/failure and which method was used.
 */
export async function openRepoInTerminal(
  repoPath: string,
  command: string,
  mode: 'new-tab' | 'new-window'
): Promise<OpenRepoResult> {
  try {
    const wtAvailable = await which('wt.exe')

    if (wtAvailable) {
      return launchWindowsTerminal(repoPath, command, mode)
    }

    // wt.exe not found — fallback to powershell.exe
    const psAvailable = await which('powershell.exe')
    if (psAvailable) {
      return launchPowerShellFallback(repoPath, command)
    }

    return {
      success: false,
      method: 'failed',
      error: 'Neither wt.exe nor powershell.exe found on PATH'
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      method: 'failed',
      error: message
    }
  }
}

/**
 * Launch via Windows Terminal (wt.exe).
 *
 * CRITICAL: Uses PowerShell's -EncodedCommand (UTF-16LE base64) instead of
 * -Command. wt.exe treats ';' as its own action separator (e.g.
 * "wt new-tab ; split-pane"). A template like "git pull; opencode" gets split
 * into two wt actions, and the second one (" opencode"") is interpreted as a
 * program name -> ERROR_FILE_NOT_FOUND (0x80070002).
 *
 * Base64 output contains only [A-Za-z0-9+/=], no semicolons/spaces/quotes,
 * so wt cannot misparse it. Equivalent to the PS CLI fix in
 * scripts/repo-nav/Private/Invoke-WtCommand.ps1.
 *
 * Node's Buffer.from(str, 'utf16le') matches .NET's
 * [System.Text.Encoding]::Unicode.GetBytes(str) ("Unicode" == UTF-16LE in .NET).
 * Buffer.toString('base64') matches [Convert]::ToBase64String(bytes).
 */
function launchWindowsTerminal(
  repoPath: string,
  command: string,
  mode: 'new-tab' | 'new-window'
): OpenRepoResult {
  const args: string[] = []

  if (mode === 'new-tab') {
    args.push('new-tab')
  } else {
    args.push('new-window')
  }

  args.push('-d', repoPath)

  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  args.push('powershell', '-NoExit', '-EncodedCommand', encodedCommand)

  const child = spawn('wt.exe', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  })

  child.unref()

  return {
    success: true,
    method: 'wt'
  }
}

/**
 * Fallback: launch via powershell.exe directly.
 *
 * Args:
 *   powershell.exe -NoExit -Command "cd <path>; <command>"
 */
function launchPowerShellFallback(
  repoPath: string,
  command: string
): OpenRepoResult {
  const psCommand = `cd "${repoPath}"; ${command}`

  const child = spawn('powershell.exe', ['-NoExit', '-Command', psCommand], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  })

  child.unref()

  return {
    success: true,
    method: 'powershell'
  }
}
