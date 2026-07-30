import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalViewProps {
  /** Unique session id — used to match PTY data events. */
  sessionId: string
  /** Agent command to spawn (e.g. 'claude', 'hermes'). */
  command: string
  /** Working directory for the PTY. */
  workDir: string
  /** Called when the PTY process exits. */
  onExit?: (exitCode: number) => void
}

/**
 * Embedded terminal component using xterm.js connected to a real PTY
 * (Windows ConPTY) via IPC.
 *
 * On mount: creates an xterm.js Terminal, spawns a PTY in the main process,
 * and bidirectionally connects them:
 *   - PTY stdout → terminal.write(data)
 *   - terminal.onData(keyboard input) → PTY stdin
 *   - terminal.onResize(cols, rows) → PTY resize
 *
 * On unmount: kills the PTY and disposes the terminal.
 *
 * This gives 100% native CLI interaction — slash commands, TUI rendering,
 * ANSI colors, cursor movement — everything works because it's a real PTY.
 */
export default function TerminalView({ sessionId, command, workDir, onExit }: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Create xterm.js terminal with a dark theme matching typical CLI tools.
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", "SF Mono", Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      },
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

    // Fit terminal to container size (must be after open()).
    try { fitAddon.fit() } catch { /* container may not have size yet */ }

    terminalRef.current = term

    // ── Spawn PTY in main process ──
    const cols = term.cols || 80
    const rows = term.rows || 24
    window.agentHub.createTerminal(sessionId, command, workDir, cols, rows)

    // ── Connect: terminal keyboard input → PTY stdin ──
    const dataDisposable = term.onData((data: string) => {
      window.agentHub.sendInput(sessionId, data)
    })

    // ── Connect: PTY stdout → terminal display ──
    const unsubData = window.agentHub.onTerminalData((sid: string, data: string) => {
      if (sid === sessionId && terminalRef.current) {
        terminalRef.current.write(data)
      }
    })

    // ── Connect: PTY exit → callback + terminal message ──
    const unsubExit = window.agentHub.onTerminalExit((sid: string, exitCode: number) => {
      if (sid === sessionId) {
        if (terminalRef.current) {
          terminalRef.current.write(`\r\n\x1b[33m[进程已退出，代码 ${exitCode}]\x1b[0m\r\n`)
        }
        onExit?.(exitCode)
      }
    })

    // ── Connect: terminal resize → PTY resize ──
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      window.agentHub.resizeTerminal(sessionId, cols, rows)
    })

    // ── Auto-fit on container resize ──
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit() } catch { /* not ready */ }
    })
    resizeObserver.observe(containerRef.current)

    // ── Focus terminal for immediate interaction ──
    term.focus()

    // ── Cleanup on unmount ──
    return () => {
      resizeObserver.disconnect()
      resizeDisposable.dispose()
      dataDisposable.dispose()
      unsubData()
      unsubExit()
      window.agentHub.killTerminal(sessionId).catch(() => {})
      term.dispose()
      terminalRef.current = null
    }
  }, [sessionId, command, workDir, onExit])

  return <div ref={containerRef} className="terminal-view__container" />
}
