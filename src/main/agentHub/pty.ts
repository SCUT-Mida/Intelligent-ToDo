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
import { join, dirname } from 'path'
import { existsSync, readFileSync } from 'fs'
import { PTY_STREAM } from '../../shared/agentHub'
import { logger } from '../logger'
import { tokenizeArgs } from './args'

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
 * Build the spawn target for a given agent command.
 *
 * Strategy (tries each in order, first match wins):
 *
 * 1. **Parse .cmd shim → direct node spawn**: npm-installed CLI tools on
 *    Windows create .cmd wrapper files. We parse them to extract the actual
 *    `node script.js` invocation, then spawn node DIRECTLY in the PTY.
 *    This bypasses cmd.exe entirely, giving TUI apps (opencode, claude, etc.)
 *    the raw PTY connection they need for keyboard input.
 *
 * 2. **Direct .exe spawn**: if the command is or resolves to a .exe, spawn
 *    it directly.
 *
 * 3. **cmd.exe /c fallback**: last resort for unknown command types.
 */
function buildSpawnTarget(command: string): { file: string; args: string[] } {
  // If already an absolute path to an .exe, use directly.
  if (/\.(exe)$/i.test(command) && existsSync(command)) {
    return { file: command, args: [] }
  }

  // Search common Windows bin dirs for the command.
  const binDirs = [
    join(process.env.APPDATA ?? '', 'npm'),
    join(process.env.USERPROFILE ?? '', '.cargo', 'bin'),
    join(process.env.USERPROFILE ?? '', '.local', 'bin'),
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WindowsApps')
  ]

  // Try to find and parse a .cmd file (npm shim).
  for (const dir of binDirs) {
    if (!dir) continue
    const cmdPath = join(dir, command + '.cmd')
    if (existsSync(cmdPath)) {
      const parsed = parseNpmCmdShim(cmdPath)
      if (parsed) {
        logger.info('agentHub:pty', `parsed .cmd shim: ${command} → ${parsed.file} ${parsed.args.join(' ')}`)
        return parsed
      }
    }
    // Also try .exe
    const exePath = join(dir, command + '.exe')
    if (existsSync(exePath)) {
      return { file: exePath, args: [] }
    }
  }

  // Fallback: cmd.exe /c (has input issues with TUI apps, but better than nothing).
  logger.warn('agentHub:pty', `could not resolve "${command}", falling back to cmd.exe /c`)
  if (process.platform === 'win32') {
    return { file: 'cmd.exe', args: ['/c', command] }
  }
  return { file: process.env.SHELL ?? '/bin/bash', args: ['-c', command] }
}

/**
 * Parse an npm .cmd shim file to extract the actual executable.
 *
 * Handles two common formats:
 *
 * 1. Native binary (opencode, codex, etc.):
 *      "%dp0%\node_modules\opencode-ai\bin\opencode.exe" %*
 *    → spawn the .exe directly (best case — full TUI support, no intermediary)
 *
 * 2. Node script (aider, older tools):
 *      "%NODE_EXE%"  "%~dp0\node_modules\aider\bin\aider.js" %*
 *    → spawn node with the script path
 *
 * Returns null if parsing fails.
 */
function parseNpmCmdShim(cmdPath: string): { file: string; args: string[] } | null {
  try {
    const content = readFileSync(cmdPath, 'utf-8')
    const dir = dirname(cmdPath)

    // Find all quoted paths ending in .exe or .js (these are the actual targets).
    const matches = [...content.matchAll(/"([^"]+\.(?:exe|js))"/gi)]
    if (matches.length === 0) return null

    // Resolve %dp0% and %~dp0 to the .cmd file's directory.
    const resolveVars = (s: string): string =>
      s.replace(/%dp0%/gi, dir).replace(/%~dp0/gi, dir + '\\')

    // Case 1: if any match is a .exe, use it directly (preferred — no intermediary).
    const exeMatch = matches.find((m) => m[1].toLowerCase().endsWith('.exe'))
    if (exeMatch) {
      const exePath = resolveVars(exeMatch[1])
      if (existsSync(exePath)) {
        return { file: exePath, args: [] }
      }
    }

    // Case 2: find a .js script and pair it with a node executable.
    const jsMatch = matches.find((m) => m[1].toLowerCase().endsWith('.js'))
    if (jsMatch) {
      const scriptPath = resolveVars(jsMatch[1])
      if (existsSync(scriptPath)) {
        // Look for a node.exe reference in the .cmd file.
        const nodeMatch = content.match(/"([^"]*node[^"]*\.exe)"/i)
        const nodeExe = nodeMatch ? resolveVars(nodeMatch[1]) : 'node'
        return { file: nodeExe, args: [scriptPath] }
      }
    }

    return null
  } catch (err) {
    logger.warn('agentHub:pty', `failed to parse .cmd shim: ${cmdPath}`, {
      error: err instanceof Error ? err.message : String(err)
    })
    return null
  }
}

/**
 * Spawn a CLI agent in a ConPTY. The renderer receives output via PTY_STREAM.DATA
 * events and sends input via the PTY_INPUT IPC channel.
 *
 * @param args Optional space-separated string of extra CLI args (e.g.
 *   `--model opus --foo "bar baz"`) appended to the resolved spawn command.
 *   Tokenized via `tokenizeArgs` (shell-style quoting supported).
 * @returns true on success, false on failure.
 */
export function createPty(
  sender: WebContents,
  sessionId: string,
  command: string,
  workDir: string,
  cols: number,
  rows: number,
  args?: string
): boolean {
  // If a PTY already exists for this session (e.g. user switched back), kill it first.
  const existing = sessions.get(sessionId)
  if (existing) {
    try { existing.pty.kill() } catch { /* already dead */ }
    sessions.delete(sessionId)
  }

  try {
    const pty = getPtyModule()
    // Resolve command: parse .cmd shims to spawn node directly (bypasses
    // cmd.exe so TUI apps get raw PTY access for keyboard input).
    const { file, args: resolvedArgs } = buildSpawnTarget(command)
    const userArgs = args ? tokenizeArgs(args) : []
    const finalArgs = [...resolvedArgs, ...userArgs]
    logger.info('agentHub:pty', 'spawning', { sessionId, command, target: file, args: finalArgs, userArgs, workDir, cols, rows })

    const proc = pty.spawn(file, finalArgs, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: workDir || undefined,
      env: {
        ...process.env,
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
  // Ignore degenerate sizes — resizing to 0/negative dimensions is never
  // legitimate and can crash the PTY-side TUI app.
  if (!session || !Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) return
  try { session.pty.resize(cols, rows) } catch { /* process may have exited */ }
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
