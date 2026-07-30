/**
 * Agent Hub — embedded PTY manager.
 *
 * Spawns CLI agents in real pseudo-terminals (Windows ConPTY) so that TUI
 * apps (opencode, hermes, claude, etc.) render correctly with full ANSI
 * escape sequence support. Streams output to the renderer via IPC.
 *
 * Uses @lydell/node-pty which ships prebuilt ConPTY binaries — no native
 * compilation required.
 */

import type { WebContents } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { PTY_STREAM } from '../../shared/agentHub'
import { logger } from '../logger'

// node-pty types from @lydell/node-pty
type IPty = {
  pid: number
  cols: number
  rows: number
  process: string
  cwd: string | undefined
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: (signal?: string) => void
}

interface PtySession {
  pty: IPty
  /** The AgentSession.id that owns this PTY. */
  sessionId: string
}

/** Active PTY sessions keyed by AgentSession.id. */
const sessions = new Map<string, PtySession>()

/** Lazy-load the native module (only available in main process). */
let ptyModule: { spawn: (file: string, args: string[] | string, options: Record<string, unknown>) => IPty } | undefined

function getPtyModule(): { spawn: (file: string, args: string[] | string, options: Record<string, unknown>) => IPty } {
  if (!ptyModule) {
    // Use @lydell/node-pty which ships prebuilt ConPTY binaries for Windows.
    ptyModule = require('@lydell/node-pty') as { spawn: (file: string, args: string[] | string, options: Record<string, unknown>) => IPty }
  }
  return ptyModule
}

/** Safe sender — guards against destroyed webContents. */
function safeSend(sender: WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args)
    }
  } catch {
    // Window closed mid-stream — nothing we can do.
  }
}

/**
 * User-level bin directories where CLI agents are installed. Used to:
 * 1. Augment PATH for the PTY process (packaged Electron has sanitized PATH)
 * 2. Resolve bare command names to absolute paths
 */
const USER_BIN_DIRS: string[] = [
  join(process.env.APPDATA ?? '', 'npm'),
  join(process.env.USERPROFILE ?? '', '.cargo', 'bin'),
  join(process.env.USERPROFILE ?? '', '.local', 'bin'),
  join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')
]

/** Executable extensions to probe on Windows. */
const EXE_EXTENSIONS = ['.cmd', '.exe', '.bat', '.ps1']

/**
 * Resolve a bare command name to an absolute path by searching user-level bin
 * directories. Returns the original command if not found (lets the OS PATH
 * have a try, or produces a clear error).
 */
function resolveCommand(command: string): string {
  // If it's already an absolute path, use it directly.
  if (/^[A-Za-z]:[\\/]/.test(command) || command.includes('/') || command.includes('\\')) {
    return command
  }

  // Search user-level bin dirs.
  for (const dir of USER_BIN_DIRS) {
    if (!dir) continue
    for (const ext of EXE_EXTENSIONS) {
      const candidate = join(dir, command + ext)
      if (existsSync(candidate)) {
        logger.info('agentHub:pty', `resolved command "${command}" → ${candidate}`)
        return candidate
      }
    }
  }

  // Not found in user dirs — return as-is and hope the OS PATH has it.
  return command
}

/**
 * Build an augmented PATH that includes user-level bin directories.
 * Packaged Electron apps inherit a sanitized PATH from the OS launcher,
 * which often excludes npm global, cargo, .local/bin, etc. Without this,
 * agents installed via `npm install -g` are invisible to spawned PTYs.
 */
function buildAugmentedPath(): string {
  const currentPath = process.env.PATH ?? ''
  const extra = USER_BIN_DIRS.filter((d) => d && existsSync(d))
  if (extra.length === 0) return currentPath
  return `${extra.join(';')};${currentPath}`
}

/**
 * Spawn a CLI agent in a ConPTY. The renderer receives output via PTY_STREAM.DATA
 * events and sends input via the PTY_INPUT IPC channel.
 *
 * @returns true on success, false on failure.
 */
export function createPty(
  sender: WebContents,
  sessionId: string,
  command: string,
  workDir: string,
  cols: number,
  rows: number
): boolean {
  // If a PTY already exists for this session (e.g. user switched back), kill it first.
  const existing = sessions.get(sessionId)
  if (existing) {
    try { existing.pty.kill() } catch { /* already dead */ }
    sessions.delete(sessionId)
  }

  try {
    const pty = getPtyModule()
    // Resolve bare command names (e.g. "claude") to absolute paths by searching
    // user-level bin dirs. This is CRITICAL for packaged Electron where PATH
    // is sanitized — without it, spawn fails with exit code 2 (not found).
    const resolvedCommand = resolveCommand(command)
    const augmentedPath = buildAugmentedPath()
    logger.info('agentHub:pty', 'spawning', { sessionId, command, resolvedCommand, workDir, cols, rows })

    const proc = pty.spawn(resolvedCommand, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workDir || undefined,
      env: {
        ...process.env,
        PATH: augmentedPath,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      } as Record<string, string>
    }) as IPty

    const session: PtySession = { pty: proc, sessionId }
    sessions.set(sessionId, session)

    proc.onData((data: string) => {
      safeSend(sender, PTY_STREAM.DATA, sessionId, data)
    })

    proc.onExit((e: { exitCode: number; signal?: number }) => {
      sessions.delete(sessionId)
      logger.info('agentHub:pty', 'process exited', { sessionId, exitCode: e.exitCode, signal: e.signal })
      safeSend(sender, PTY_STREAM.EXIT, sessionId, e.exitCode)
    })

    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('agentHub:pty', 'spawn failed', { sessionId, command, error: msg })
    // Send an error message to the terminal so the user sees what happened.
    safeSend(sender, PTY_STREAM.DATA, sessionId, `\r\n\x1b[31m启动失败: ${msg}\x1b[0m\r\n`)
    safeSend(sender, PTY_STREAM.EXIT, sessionId, 1)
    return false
  }
}

/** Write data to a PTY's stdin (user keyboard input). */
export function sendInput(sessionId: string, data: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.write(data) } catch { /* process may have exited */ }
  }
}

/** Resize a PTY to match the xterm.js terminal dimensions. */
export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.resize(cols, rows) } catch { /* process may have exited */ }
  }
}

/** Kill a PTY process. */
export function killPty(sessionId: string): void {
  const session = sessions.get(sessionId)
  if (session) {
    try { session.pty.kill() } catch { /* already dead */ }
    sessions.delete(sessionId)
    logger.info('agentHub:pty', 'killed', { sessionId })
  }
}

/** Kill ALL active PTY sessions (called on app quit). */
export function killAllPtys(): void {
  for (const sessionId of sessions.keys()) {
    killPty(sessionId)
  }
}
