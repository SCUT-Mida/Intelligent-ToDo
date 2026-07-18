/**
 * Terminal launcher for the Repo Navigator.
 *
 * Ported from scripts/repo-nav/Private/Invoke-WtCommand.ps1.
 *
 * Tries to open a new terminal tab/window at the given repo path
 * with the specified command. Falls back to the configured fallback
 * terminal if the primary is unavailable.
 *
 * All processes are spawned detached with stdio ignored so they survive the
 * Electron app's exit.
 */

import { spawn } from 'child_process'
import { which } from './which'
import type { OpenRepoResult, RepoNavConfig } from '../../shared/repoNav'

/**
 * Resolve a binary name/path from config, falling back to the default.
 * Trims whitespace; returns the default if the config value is empty.
 */
function resolveBinary(value: string | undefined, defaultValue: string): string {
  const trimmed = (value ?? '').trim()
  return trimmed || defaultValue
}

/**
 * Open a new terminal session at the given repo path.
 *
 * @param repoPath - Absolute path to the repository directory.
 * @param command  - The command string to execute (e.g. "git pull; opencode").
 * @param mode     - "new-tab" (default) or "new-window".
 * @param config   - Optional RepoNavConfig for binary overrides. When omitted,
 *                   uses defaults ('wt.exe' primary, 'powershell.exe' fallback).
 * @returns A result object indicating success/failure and which method was used.
 */
export async function openRepoInTerminal(
  repoPath: string,
  command: string,
  mode: 'new-tab' | 'new-window',
  config?: RepoNavConfig
): Promise<OpenRepoResult> {
  const primaryBinary = resolveBinary(config?.terminalBinary, 'wt.exe')
  const fallbackBinary = resolveBinary(config?.terminalFallback, 'powershell.exe')

  try {
    const primaryAvailable = await which(primaryBinary)

    if (primaryAvailable) {
      // Special-case: 'wt.exe' uses the encoded-command hack to avoid wt's
      // ';' argument splitter. Other terminals get the generic launcher path.
      if (primaryBinary.toLowerCase() === 'wt.exe') {
        return launchWindowsTerminal(repoPath, command, mode)
      }
      return launchGenericTerminal(primaryBinary, repoPath, command, mode)
    }

    // Primary terminal unavailable — try fallback
    const fallbackAvailable = await which(fallbackBinary)
    if (fallbackAvailable) {
      return launchPowerShellFallback(repoPath, command, fallbackBinary)
    }

    return {
      success: false,
      method: 'failed',
      error: `Neither ${primaryBinary} nor ${fallbackBinary} found on PATH`
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
 * Launch via a generic terminal binary (e.g. ConEmu, WezTerm, Alacritty).
 *
 * This is a best-effort invocation. Different terminals have different argument
 * conventions, so we use a common pattern: `<exe> -d <path> -- <command>`.
 * Users wanting terminal-specific behavior should use commandTemplates that
 * embed the absolute path to their preferred terminal.
 *
 * NOTE: Method reports as 'wt' for non-PowerShell terminals because the
 * OpenRepoResult.method union is fixed to 'wt' | 'powershell' | 'failed'.
 * This is acceptable — the method field is purely informational.
 */
function launchGenericTerminal(
  binary: string,
  repoPath: string,
  command: string,
  _mode: 'new-tab' | 'new-window'
): OpenRepoResult {
  // Many terminal emulators (WezTerm, Alacritty) accept this pattern.
  // If a user has an unusual terminal, they can override via templates.
  const child = spawn(binary, ['--', command], {
    cwd: repoPath,
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
 * Fallback: launch via powershell.exe (or pwsh.exe) directly.
 *
 * Args:
 *   <binary> -NoExit -Command "cd <path>; <command>"
 *
 * Uses -Command (not -EncodedCommand) because powershell.exe handles ';'
 * correctly within a single -Command argument. Only wt.exe has the splitter bug.
 */
function launchPowerShellFallback(
  repoPath: string,
  command: string,
  binary: string
): OpenRepoResult {
  const psCommand = `cd "${repoPath}"; ${command}`

  const child = spawn(binary, ['-NoExit', '-Command', psCommand], {
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
