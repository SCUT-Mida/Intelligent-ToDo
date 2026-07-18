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
 *
 * Every step is logged via the app logger so failures can be diagnosed
 * post-mortem from <userData>/logs/app-YYYY-MM-DD.log.
 */

import { spawn } from 'child_process'
import { which } from './which'
import type { WhichResult } from './which'
import type { OpenRepoResult, RepoNavConfig } from '../../shared/repoNav'
import { logger } from '../logger'

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

  logger.info('launcher', 'openRepoInTerminal start', {
    repoPath, command, mode,
    primary: primaryBinary, fallback: fallbackBinary,
    hasConfig: !!config
  })

  try {
    const primary = await which(primaryBinary)
    logger.info('launcher', 'primary lookup', { binary: primaryBinary, ok: primary.ok, path: primary.path, via: primary.via })

    if (primary.ok) {
      // Windows Terminal uses the encoded-command hack to avoid wt's
      // ';' argument splitter. Other terminals get the generic launcher path.
      if (primaryBinary.toLowerCase() === 'wt.exe') {
        return launchWindowsTerminal(repoPath, command, mode, primary)
      }
      return launchGenericTerminal(primaryBinary, repoPath, command, mode, primary)
    }

    // Primary unavailable — try fallback
    const fallback = await which(fallbackBinary)
    logger.info('launcher', 'fallback lookup', { binary: fallbackBinary, ok: fallback.ok, path: fallback.path, via: fallback.via })

    if (fallback.ok) {
      return launchPowerShellFallback(repoPath, command, fallbackBinary, fallback)
    }

    // Both failed — collect detailed errors for the user
    const detail = `primary=${primaryBinary} (${primary.error}); fallback=${fallbackBinary} (${fallback.error})`
    logger.error('launcher', 'both terminals unavailable', { detail })
    return {
      success: false,
      method: 'failed',
      error: `找不到可用的终端程序。详情：${detail}。请查看日志：${logger.currentLogFilePath()}`
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('launcher', 'openRepoInTerminal threw', { error: message, stack: err instanceof Error ? err.stack : undefined })
    return {
      success: false,
      method: 'failed',
      error: `启动失败：${message}`
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
  mode: 'new-tab' | 'new-window',
  resolved: WhichResult
): OpenRepoResult {
  // Use the resolved absolute path if we have one (more reliable than relying
  // on spawn's PATH lookup, which may behave differently for a packaged app).
  const binary = resolved.path ?? 'wt.exe'
  const args: string[] = []

  if (mode === 'new-tab') {
    args.push('new-tab')
  } else {
    args.push('new-window')
  }

  args.push('-d', repoPath)

  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  args.push('powershell', '-NoExit', '-EncodedCommand', encodedCommand)

  logger.info('launcher', 'spawning wt', { binary, args, mode })
  const child = spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  })

  child.on('error', (err) => {
    logger.error('launcher', 'wt spawn error event', { error: err.message })
  })
  child.unref()

  logger.info('launcher', 'wt launched', { pid: child.pid })
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
  _mode: 'new-tab' | 'new-window',
  resolved: WhichResult
): OpenRepoResult {
  const execPath = resolved.path ?? binary
  logger.info('launcher', 'spawning generic terminal', { binary: execPath, repoPath })
  const child = spawn(execPath, ['--', command], {
    cwd: repoPath,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  })

  child.on('error', (err) => {
    logger.error('launcher', 'generic terminal spawn error event', { binary: execPath, error: err.message })
  })
  child.unref()

  logger.info('launcher', 'generic terminal launched', { pid: child.pid })
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
  binary: string,
  resolved: WhichResult
): OpenRepoResult {
  const execPath = resolved.path ?? binary
  const psCommand = `cd "${repoPath}"; ${command}`

  logger.info('launcher', 'spawning PowerShell fallback', { binary: execPath })
  const child = spawn(execPath, ['-NoExit', '-Command', psCommand], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    shell: false
  })

  child.on('error', (err) => {
    logger.error('launcher', 'PowerShell spawn error event', { binary: execPath, error: err.message })
  })
  child.unref()

  logger.info('launcher', 'PowerShell launched', { pid: child.pid })
  return {
    success: true,
    method: 'powershell'
  }
}
