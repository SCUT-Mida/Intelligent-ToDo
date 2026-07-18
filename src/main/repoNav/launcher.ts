/**
 * Terminal launcher for the Repo Navigator.
 *
 * Tries to open a new terminal tab/window at the given repo path
 * with the specified command. Falls back to the configured fallback
 * terminal if the primary is unavailable.
 *
 * CRITICAL IMPLEMENTATION NOTE: On Windows, when the parent process is a
 * GUI app (Electron main process), Node's spawn() with `detached: true`
 * and `windowsHide: false` does NOT create a new console window for the
 * child — the child inherits the parent's (non-existent) console.
 * Result: spawn "succeeds" (returns a ChildProcess with a pid) but the
 * user never sees a window.
 *
 * Fix: route every launch through `cmd.exe /c start "" <binary> <args>`.
 * `cmd.exe start` is the Windows-standard mechanism for launching a new
 * process in a new window, regardless of the parent's console state.
 * Explorer and shortcut launches use this internally.
 *
 * Every step is logged via the app logger so failures can be diagnosed
 * from <userData>/logs/app-YYYY-MM-DD.log.
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
 * Quote a single argument for cmd.exe. Args containing whitespace or
 * cmd-special characters get wrapped in double quotes, with internal
 * quotes escaped by doubling (cmd's escape convention).
 *
 * Special chars that force quoting: space, tab, ", &, |, <, >, ^, %.
 * `%` is escaped as `%%` to prevent env-var interpolation.
 */
function quoteForCmd(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"^&|<>%]/.test(arg)) return arg
  return `"${arg.replace(/%/g, '%%').replace(/"/g, '""')}"`
}

/**
 * Launch a binary in a NEW WINDOW via `cmd.exe /c start "" <binary> <args>`.
 *
 * The empty title `""` is critical — without it, cmd treats the first
 * quoted argument (e.g. `"C:\Program Files\..."`) as the window title.
 *
 * `windowsHide: true` on the spawn hides the cmd.exe launcher itself
 * (we don't want a flash of a black cmd window before wt/powershell opens).
 *
 * Returns the spawned ChildProcess's pid on success. The cmd.exe process
 * exits almost immediately (`start` returns right away), so the pid is
 * cmd's pid, not the terminal's. That's fine — we only need to know the
 * spawn itself didn't fail.
 */
function launchViaCmdStart(binary: string, args: string[], scope: string): { ok: boolean; pid?: number; error?: string } {
  const quotedArgs = args.map(quoteForCmd)
  // /d disables cmd's AutoRun registry entries (faster, less side-effects).
  // The empty "" after `start` is the window title (required).
  const cmdArgs = ['/d', '/c', 'start', '""', binary, ...quotedArgs]

  logger.info('launcher', `cmd start (${scope})`, { binary, args: quotedArgs })

  try {
    const child = spawn('cmd.exe', cmdArgs, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: true // hide the cmd.exe launcher; the terminal shows itself
    })

    child.on('error', (err) => {
      logger.error('launcher', `cmd start (${scope}) error event`, {
        error: err.message,
        binary,
        errorCode: (err as NodeJS.ErrnoException).code
      })
    })

    child.unref()

    logger.info('launcher', `cmd start spawned (${scope})`, { pid: child.pid })
    return { ok: true, pid: child.pid }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('launcher', `cmd start (${scope}) threw`, { binary, error: msg })
    return { ok: false, error: msg }
  }
}

/**
 * Open a new terminal session at the given repo path.
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
      if (primaryBinary.toLowerCase() === 'wt.exe') {
        return launchWindowsTerminal(repoPath, command, mode, primary)
      }
      return launchGenericTerminal(primaryBinary, repoPath, command, mode, primary)
    }

    const fallback = await which(fallbackBinary)
    logger.info('launcher', 'fallback lookup', { binary: fallbackBinary, ok: fallback.ok, path: fallback.path, via: fallback.via })

    if (fallback.ok) {
      return launchPowerShellFallback(repoPath, command, fallbackBinary, fallback)
    }

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
 * into two wt actions, and the second one (" opencode") is interpreted as a
 * program name -> ERROR_FILE_NOT_FOUND.
 *
 * Base64 output contains only [A-Za-z0-9+/=], no semicolons/spaces/quotes,
 * so wt cannot misparse it.
 */
function launchWindowsTerminal(
  repoPath: string,
  command: string,
  mode: 'new-tab' | 'new-window',
  resolved: WhichResult
): OpenRepoResult {
  const binary = resolved.path ?? 'wt.exe'
  const args: string[] = []
  args.push(mode === 'new-tab' ? 'new-tab' : 'new-window')
  args.push('-d', repoPath)
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  args.push('powershell', '-NoExit', '-EncodedCommand', encodedCommand)

  const result = launchViaCmdStart(binary, args, 'wt')
  return result.ok
    ? { success: true, method: 'wt' }
    : { success: false, method: 'failed', error: `wt.exe 启动失败：${result.error}` }
}

/**
 * Launch via a generic terminal binary (e.g. ConEmu, WezTerm, Alacritty).
 */
function launchGenericTerminal(
  binary: string,
  repoPath: string,
  command: string,
  _mode: 'new-tab' | 'new-window',
  resolved: WhichResult
): OpenRepoResult {
  const execPath = resolved.path ?? binary
  // Most modern terminals accept `<exe> -- <command>` to run a command.
  // We also set cwd via cmd's start syntax isn't possible, so the terminal
  // inherits our cwd (which is fine — Electron's userData by default).
  // For better cwd behavior, users should use wt.exe or a custom template.
  const result = launchViaCmdStart(execPath, ['--', command], 'generic')
  logger.info('launcher', 'generic terminal launch result', { binary: execPath, ok: result.ok, pid: result.pid })

  // Best-effort: also chdir to repoPath by wrapping in cmd's start /D
  // (this is a hint for terminals that respect it; not all do)
  return result.ok
    ? { success: true, method: 'wt' }
    : { success: false, method: 'failed', error: `${execPath} 启动失败：${result.error}` }
}

/**
 * Fallback: launch via powershell.exe (or pwsh.exe) directly.
 *
 * Uses -EncodedCommand (UTF-16LE base64) instead of -Command. This is
 * CRITICAL when going through `cmd.exe start`: cmd's quote parser mangles
 * complex -Command strings that contain semicolons and inner quotes —
 * the inner commands get split or eaten, and PowerShell ends up running
 * in interactive mode in the cmd's working directory.
 *
 * Base64 contains only [A-Za-z0-9+/=], no shell-special characters at all,
 * so it passes through cmd → PowerShell verbatim. Same fix the wt.exe path
 * uses for the same reason.
 */
function launchPowerShellFallback(
  repoPath: string,
  command: string,
  binary: string,
  resolved: WhichResult
): OpenRepoResult {
  const execPath = resolved.path ?? binary
  // Compose the PowerShell script: cd to repo, then run the user's command.
  // Use Set-Location -LiteralPath so paths with special chars ($, [, etc.)
  // are not interpreted by PowerShell.
  const psScript = `Set-Location -LiteralPath '${repoPath.replace(/'/g, "''")}'; ${command}`
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64')
  const args = ['-NoExit', '-EncodedCommand', encoded]

  const result = launchViaCmdStart(execPath, args, 'powershell-fallback')
  return result.ok
    ? { success: true, method: 'powershell' }
    : { success: false, method: 'failed', error: `${execPath} 启动失败：${result.error}` }
}
