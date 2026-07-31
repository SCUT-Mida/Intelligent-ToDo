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
import type { AgentCommandDef } from '../../shared/agentHub'
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
  /** Last time the PTY emitted output (used for idle detection before probing). */
  lastOutputAt: number
  /** When non-null, output is captured here instead of forwarded (probe in flight). */
  captureBuffer: string | null
}

/** Active PTY sessions keyed by AgentSession.id. */
const sessions = new Map<string, PtySession>()

/**
 * Only probe a terminal that has been completely quiet for this long. Probing
 * injects `/` into the live PTY — never do that while the agent is streaming
 * output or the user is mid-keystroke (it would corrupt the input line).
 */
const PROBE_IDLE_MS = 1500
/**
 * How long to wait after sending `/` for the agent's command menu to fully
 * render before we start scrolling through it.
 */
const PROBE_CAPTURE_MS = 1000
/**
 * Wait between scroll keypresses. opencode repaints its menu with incremental
 * diffs (only changed characters), so each ArrowDown needs a short settle
 * window or frames get merged and commands are skipped. 150ms was verified to
 * capture every command while keeping a full scroll pass under ~10 seconds.
 */
const PROBE_SCROLL_MS = 150
/**
 * Stop scrolling after this many consecutive steps that added no new command.
 * Must be generous: the first ~10 ArrowDowns only move the highlight within
 * the visible menu (no new commands), and opencode sometimes pauses repaints
 * mid-list (a 14-step gap was observed) — but a static/non-scrolling menu
 * (claude, hermes) will trip this after ~3 seconds.
 */
const PROBE_STALL_STEPS = 20
/** Hard cap on scroll steps so a pathological agent can never hang the probe. */
const PROBE_MAX_STEPS = 60
/**
 * Don't treat "first command reappears on screen" as a wrap-around until we
 * have scrolled at least this far — the first command is obviously visible on
 * the initial screen before any scrolling happened.
 */
const PROBE_WRAP_MIN_STEPS = 12
/** Extra wait after sending Escape so the dismissal repaint is also suppressed. */
const PROBE_DISMISS_MS = 150

/**
 * ANSI tokenizer for the screen rebuild below. Matches escape sequences as
 * whole tokens (so cursor-movement CSI codes can be acted on instead of just
 * stripped) and falls through to individual control/printable characters.
 */
const ANSI_TOKEN_RE =
  /\x1b\[([0-9;?]*)([@-~])|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>]|\x1b[@-Z\\-_]|[\x00-\x1f\x7f]|./g

/**
 * Persistent terminal screen buffer.
 *
 * opencode renders its command menu with absolute cursor addressing
 * (CSI row;col H) and then scrolls it with INCREMENTAL DIFF repaints — each
 * ArrowDown only redraws the changed characters (e.g. it may repaint just
 * "ommit" while the unchanged "/c" prefix from the previous frame stays on
 * screen). A naive ANSI-strip + split("\n") collapses every menu item onto
 * one line (only the first "/command" is found); a one-shot screen rebuild
 * per frame loses those unchanged prefixes.
 *
 * This class models a real terminal: it keeps the character grid across
 * frames and applies each captured chunk on top of the previous state, so
 * diff fragments merge correctly and the full menu scroll becomes visible.
 */
const SCREEN_ROWS = 48
const SCREEN_COLS = 240

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

class ScreenBuffer {
  private grid = Array.from({ length: SCREEN_ROWS }, () => Array<string>(SCREEN_COLS).fill(' '))
  private row = 0
  private col = 0

  /** Apply a raw chunk of PTY output on top of the current screen state. */
  apply(raw: string): void {
    ANSI_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ANSI_TOKEN_RE.exec(raw)) !== null) {
      const token = m[0]
      if (token[0] !== '\x1b') {
        // Control chars and printable text.
        if (token === '\r') { this.col = 0; continue }
        if (token === '\n') { this.row = Math.min(this.row + 1, SCREEN_ROWS - 1); continue }
        if (token === '\b') { this.col = Math.max(this.col - 1, 0); continue }
        if (token === '\t') { this.col = Math.min(this.col + 4, SCREEN_COLS - 1); continue }
        this.grid[this.row][this.col] = token
        this.col++
        if (this.col >= SCREEN_COLS) { this.col = 0; this.row = Math.min(this.row + 1, SCREEN_ROWS - 1) }
        continue
      }

      // CSI sequence — handle cursor movement / erase; SGR (m) and private
      // modes (h/l) carry no screen text and are ignored.
      if (token[1] === '[') {
        const params = (m[1] ?? '').split(';').map((s) => {
          const n = parseInt(s, 10)
          return Number.isFinite(n) ? n : 0
        })
        const n1 = params[0] || 1
        const n2 = params[1] || 1
        switch (m[2]) {
          case 'H': case 'f': // cursor position (1-based)
            this.row = clamp(Math.max(n1, 1) - 1, 0, SCREEN_ROWS - 1)
            this.col = clamp(Math.max(n2, 1) - 1, 0, SCREEN_COLS - 1)
            break
          case 'G': this.col = clamp(Math.max(n1, 1) - 1, 0, SCREEN_COLS - 1); break
          case 'C': this.col = clamp(this.col + n1, 0, SCREEN_COLS - 1); break
          case 'D': this.col = clamp(this.col - n1, 0, SCREEN_COLS - 1); break
          case 'B': this.row = clamp(this.row + n1, 0, SCREEN_ROWS - 1); break
          case 'A': this.row = clamp(this.row - n1, 0, SCREEN_ROWS - 1); break
          case 'E': this.row = clamp(this.row + n1, 0, SCREEN_ROWS - 1); this.col = 0; break
          case 'F': this.row = clamp(this.row - n1, 0, SCREEN_ROWS - 1); this.col = 0; break
          case 'X': { // erase characters from cursor
            const n = Math.min(n1, SCREEN_COLS - this.col)
            for (let i = 0; i < n; i++) this.grid[this.row][this.col + i] = ' '
            break
          }
          case 'K': { // erase in line
            const mode = params[0] || 0
            if (mode === 0) for (let i = this.col; i < SCREEN_COLS; i++) this.grid[this.row][i] = ' '
            else if (mode === 1) for (let i = 0; i <= this.col; i++) this.grid[this.row][i] = ' '
            else this.grid[this.row].fill(' ')
            break
          }
          case 'J': { // erase in display
            const mode = params[0] || 0
            if (mode === 0) {
              for (let i = this.col; i < SCREEN_COLS; i++) this.grid[this.row][i] = ' '
              for (let r = this.row + 1; r < SCREEN_ROWS; r++) this.grid[r].fill(' ')
            } else if (mode === 1) {
              for (let i = 0; i <= this.col; i++) this.grid[this.row][i] = ' '
              for (let r = 0; r < this.row; r++) this.grid[r].fill(' ')
            } else {
              for (const r of this.grid) r.fill(' ')
            }
            break
          }
          default: break
        }
      }
      // OSC / other ESC sequences carry no screen text — ignore.
    }
  }

  /** Current screen as text rows (right-trimmed). */
  lines(): string[] {
    return this.grid.map((cells) => cells.join('').replace(/\s+$/, ''))
  }
}

/**
 * Parse slash-command names out of a rendered menu. Each screen row is
 * scanned for a `/command` token with a trailing description; the first
 * command on a row wins and duplicate names are collapsed.
 */
function extractCommands(lines: string[]): Map<string, string> {
  const seen = new Map<string, string>()
  for (const line of lines) {
    const m = line.match(/\/([\w][\w\-/.]*)/)
    if (!m) continue
    const name = m[1].replace(/[.\/]+$/, '')
    if (!name || name.length > 40) continue
    const after = line.slice((m.index ?? 0) + m[0].length)
    const desc = after
      .replace(/^[\s:│|┃\-–—>]+/, '')
      .replace(/[│|┃\s]+$/, '')
      .trim()
      .slice(0, 100)
    if (!seen.has(name)) seen.set(name, desc)
  }
  return seen
}

/** Names of the commands currently visible on screen. */
function onScreenCommands(lines: string[]): string[] {
  return [...extractCommands(lines).keys()]
}

/**
 * Probe the live terminal for the slash commands the agent actually supports.
 *
 * This is REAL terminal interaction: we send `/` to the running PTY, capture
 * the menu the agent itself renders (ANSI output), scroll through it with
 * ArrowDown so long menus reveal every command, then send Escape to dismiss.
 * Whatever the agent shows in its own TUI is exactly what comes back — no
 * config file mapping needed, works for any agent.
 *
 * Why scrolling: opencode's menu has a fixed visible height (~10 rows) but
 * the full list (built-ins + skills + plugins) is much longer — the first
 * screen only showed 10 commands while a full scroll pass revealed 40.
 *
 * Guards:
 * - The terminal must be idle (no I/O for PROBE_IDLE_MS) — we never interrupt
 *   streaming output or a user who is typing.
 * - Output is suppressed while probing so the user doesn't see the flash.
 *
 * Returns an empty array when the terminal is busy/unavailable or the agent
 * renders no slash menu.
 */
export function probeCommands(sessionId: string): Promise<AgentCommandDef[]> {
  const session = sessions.get(sessionId)
  if (!session) return Promise.resolve([])
  if (session.captureBuffer !== null) return Promise.resolve([])
  if (Date.now() - session.lastOutputAt < PROBE_IDLE_MS) return Promise.resolve([])

  return new Promise((resolve) => {
    session.captureBuffer = ''
    let settled = false
    const settle = (commands: AgentCommandDef[]): void => {
      if (settled) return
      settled = true
      session.captureBuffer = null
      resolve(commands)
    }

    // Persistent screen that accumulates diff repaints across scroll steps.
    const screen = new ScreenBuffer()
    const merged = new Map<string, string>()
    let step = 0
    let noNewStreak = 0
    /** First command seen on the initial screen — sentinel for wrap-around. */
    let firstSeen: string | undefined
    /** True once `firstSeen` has scrolled off screen (so its return means wrap). */
    let firstSeenScrolledAway = false

    const drain = (): void => {
      const chunk = session.captureBuffer ?? ''
      session.captureBuffer = ''
      screen.apply(chunk)
    }

    const mergeVisible = (): number => {
      const before = merged.size
      for (const [name, desc] of extractCommands(screen.lines())) {
        if (!merged.has(name)) merged.set(name, desc)
      }
      if (!firstSeen) firstSeen = [...merged.keys()][0]
      return merged.size - before
    }

    const isWrapped = (): boolean => {
      if (!firstSeen || step < PROBE_WRAP_MIN_STEPS) return false
      const visible = onScreenCommands(screen.lines())
      if (!visible.includes(firstSeen)) {
        firstSeenScrolledAway = true
        return false
      }
      // First command is on screen again after having scrolled away → we have
      // completed a full pass and every command has been visited.
      return firstSeenScrolledAway
    }

    const finish = (): void => {
      try {
        session.pty.write('\x1b')
      } catch {
        /* process may have exited */
      }
      // Let the dismissal repaint land before handing back control.
      setTimeout(() => {
        drain()
        settle(commands())
      }, PROBE_DISMISS_MS)
    }

    const commands = (): AgentCommandDef[] =>
      [...merged.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, description]) => ({ name, description }))

    const tick = (): void => {
      if (settled) return
      drain()
      const added = mergeVisible()
      noNewStreak = added > 0 ? 0 : noNewStreak + 1

      if (isWrapped() || noNewStreak >= PROBE_STALL_STEPS || step >= PROBE_MAX_STEPS) {
        finish()
        return
      }

      step++
      try {
        session.pty.write('\x1b[B') // ArrowDown — scroll the menu
      } catch {
        settle([])
        return
      }
      setTimeout(tick, PROBE_SCROLL_MS)
    }

    try {
      session.pty.write('/')
    } catch {
      settle([])
      return
    }
    setTimeout(tick, PROBE_CAPTURE_MS)
  })
}

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
    // Resolve command: parse .cmd shims to spawn node directly (bypasses
    // cmd.exe so TUI apps get raw PTY access for keyboard input).
    const { file, args } = buildSpawnTarget(command)
    logger.info('agentHub:pty', 'spawning', { sessionId, command, target: file, args, workDir, cols, rows })

    const proc = pty.spawn(file, args, {
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

    const session: PtySession = { pty: proc, sessionId, lastOutputAt: Date.now(), captureBuffer: null }
    sessions.set(sessionId, session)

    proc.onData((data: string) => {
      session.lastOutputAt = Date.now()
      // While a probe is in flight, capture the rendered menu instead of
      // forwarding it — the user should never see the injected "/" flash.
      if (session.captureBuffer !== null) {
        session.captureBuffer += data
        return
      }
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
