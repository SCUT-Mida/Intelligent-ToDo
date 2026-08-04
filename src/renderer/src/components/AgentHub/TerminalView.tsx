import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import '@xterm/xterm/css/xterm.css'

export interface TerminalHandle {
  /** Inject text into the terminal as a paste. Returns false if terminal not ready. */
  paste: (text: string, submit?: boolean) => boolean
}

interface TerminalViewProps {
  /** Unique session id — used to match PTY data events. */
  sessionId: string
  /** Agent command to spawn (e.g. 'claude', 'hermes'). */
  command: string
  /** Working directory for the PTY. */
  workDir: string
  /** Whether this terminal panel is the currently visible one. */
  active: boolean
  /** Called when the PTY process exits. */
  onExit?: (exitCode: number) => void
  /** Called after a paste (manual or injected) successfully lands in the terminal. */
  onPasted?: (content: string) => void
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
const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { sessionId, command, workDir, active, onExit, onPasted }: TerminalViewProps,
  ref
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)

  // Keep the latest onPasted callback in a ref — the main effect deps MUST NOT
  // include it (re-running the effect would recreate the PTY and kill the terminal).
  const onPastedRef = useRef(onPasted)
  onPastedRef.current = onPasted

  // Timestamp of the last keyboard-initiated paste (Ctrl/Cmd+V). Used to skip a
  // DOM 'paste' event that may still fire right after the keydown handler above
  // performed the paste (double-paste guard).
  const lastPasteRef = useRef(0)

  useImperativeHandle(
    ref,
    () => ({
      paste: (text: string, submit?: boolean): boolean => {
        if (!terminalRef.current) return false
        terminalRef.current.paste(text)
        // When submit is requested, send a carriage return OUTSIDE the
        // bracketed-paste wrapping (term.paste) so the agent acts immediately.
        // A raw '\r' inside the paste markers would just be treated as content.
        if (submit === true) {
          window.agentHub.sendInput(sessionId, '\r')
        }
        return true
      }
    }),
    []
  )

  useEffect(() => {
    if (!containerRef.current) return

    // Create xterm.js terminal with a dark theme matching typical CLI tools.
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      // NOTE: the trailing emoji/icon fonts are critical — CLI agents (opencode,
      // claude, hermes) emit emoji + Nerd Font glyphs for status icons. Without an
      // emoji-capable fallback, Chromium glyph-falls-back to Segoe UI Emoji whose
      // double-width metrics get clipped to a single cell (icon shows half).
      fontFamily:
        '"Cascadia Code", "Fira Code", "SF Mono", Consolas, "Courier New", "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", monospace',
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

    // Fix half-clipped emoji/icons (xterm.js issue #5893): the default Unicode
    // V6 width tables classify emoji as single-width, so the canvas renderer
    // draws the double-width glyph into ONE cell and clips the right half.
    // The graphemes addon activates Unicode 15 (emoji-aware cell widths), so
    // status icons render whole.
    term.loadAddon(new UnicodeGraphemesAddon())

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
      // Hidden panels (display:none — inactive sessions or sub-app switches)
      // report 0 size. Fitting here would resize the PTY to ~1x1, which makes
      // TUI agents (opencode, claude, ...) crash with exit code 3. Skip until
      // the panel is visible again — RO then fires with the real dimensions.
      const el = containerRef.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
      try { fitAddon.fit() } catch { /* not ready */ }
    })
    resizeObserver.observe(containerRef.current)

    // ── Paste: bypass xterm's native (clipboardData-dependent) handling ──
    // Known Electron quirk: clipboards written via navigator.clipboard.writeText()
    // (async API) can surface as EMPTY event.clipboardData on a subsequent paste,
    // so xterm's built-in paste handler silently drops the text. We intercept the
    // paste in the CAPTURE phase (runs before xterm's target-phase listener),
    // prevent the default insertion, and read the clipboard from the MAIN process
    // (electron.clipboard.readText()) which is always reliable.
    //
    // The text is injected via term.paste() — NOT raw sendInput — because paste()
    // normalizes CRLF/LF line endings to \r and wraps the text in bracketed-paste
    // markers (\x1b[200~ ... \x1b[201~) when the CLI app enabled them. Without the
    // markers, a multi-line paste would be executed line-by-line as if typed.
    // term.paste() then fires onData, which the handler above forwards to the PTY.
    const container = containerRef.current

    // Keyboard-initiated paste (Ctrl/Cmd+V): the default Electron menu is removed,
    // so the keydown reaches the renderer. We intercept it in the CAPTURE phase
    // (runs before xterm's own listeners), prevent the default insertion, and read
    // the clipboard from the MAIN process (electron.clipboard.readText()) which is
    // always reliable — this also covers the async-clipboard empty-clipboardData quirk.
    // The text is injected via term.paste() so line endings and bracketed-paste
    // markers are handled identically to the 'paste' event path below.
    const onKeyDownCapture = (e: KeyboardEvent): void => {
      const isPasteChord = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'v'
      if (!isPasteChord) return
      e.preventDefault()
      e.stopPropagation()
      lastPasteRef.current = Date.now()
      window.agentHub
        .readClipboard()
        .then((text) => {
          if (text && terminalRef.current) {
            terminalRef.current.paste(text)
            onPastedRef.current?.(text)
          }
        })
        .catch((err: unknown) => {
          console.error('[TerminalView] readClipboard failed', err)
        })
    }

    const onPasteCapture = (e: ClipboardEvent): void => {
      // The keydown handler above already performed the paste — skip the DOM
      // 'paste' event if it still fires right after (double-paste guard).
      if (Date.now() - lastPasteRef.current < 500) return
      e.preventDefault()
      e.stopPropagation()

      const clipText = e.clipboardData?.getData('text/plain') ?? ''
      if (clipText) {
        // clipboardData has the text — inject straight to the terminal (no IPC round-trip)
        term.paste(clipText)
        onPastedRef.current?.(clipText)
      } else {
        // clipboardData empty (Electron async-clipboard quirk) → read via main process
        window.agentHub
          .readClipboard()
          .then((text) => {
            if (text && terminalRef.current) {
              terminalRef.current.paste(text)
              onPastedRef.current?.(text)
            }
          })
          .catch((err: unknown) => {
            console.error('[TerminalView] readClipboard failed', err)
          })
      }
    }
    container.addEventListener('paste', onPasteCapture, true)
    container.addEventListener('keydown', onKeyDownCapture, true)

    // ── Focus terminal for immediate interaction ──
    term.focus()

    // ── Cleanup on unmount ──
    return () => {
      container.removeEventListener('paste', onPasteCapture, true)
      container.removeEventListener('keydown', onKeyDownCapture, true)
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

  // Scroll to the latest output when the panel becomes visible again. Panels
  // stay always-mounted and are hidden via display:none; when React flips the
  // style back to 'flex', xterm's viewport re-appears at the TOP of the
  // scrollback, forcing the user to scroll down after every session switch.
  // Must be a SEPARATE effect — adding `active` to the main effect's deps
  // would recreate the PTY and kill the terminal session.
  useEffect(() => {
    if (!active) return
    // Double rAF: the first waits for the display:none→flex switch to lay out,
    // the second lets the ResizeObserver-driven fit() resize settle so the
    // scroll position actually lands at the bottom.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        terminalRef.current?.scrollToBottom()
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [active])

  return <div ref={containerRef} className="terminal-view__container" />
})

export default TerminalView
