import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { AgentCommandDef } from '@shared/agentHub'

interface MarkdownEditorProps {
  /** Send content (optionally prefixed by the selected slash command) into the
   *  active terminal. The command, if any, is sent as "/<command> <content>"
   *  — one space between. Returns success. */
  onSend?: (content: string, command?: string) => boolean
  /**
   * Slash commands the session's agent supports (live-probed from its
   * terminal). Shown as clickable chips in the command bar — clicking one
   * selects it as the "current command"; the selected command is joined with
   * the editor content (one space) when sending.
   */
  commands: AgentCommandDef[]
  /** Called when the "⚡ 命令" button is clicked — re-probes the live terminal. */
  onProbeCommands?: () => void
  /** Expanded editor width in px (shared across sessions, controlled by the parent). */
  width: number
  /** Called while the user drags the editor's right-edge resizer. */
  onResize?: (w: number) => void
  /** Called when the user clicks the history button in the navbar. */
  onOpenHistory?: () => void
}

export interface MarkdownHandle {
  /** Replace the editor content (and optionally the selected command) and
   *  expand the panel (used by history re-edit). */
  setContent: (text: string, command?: string) => void
}

/**
 * Shared column-resize helper. Attaches mousemove/mouseup listeners on window
 * for the duration of the drag and reports the new width through onWidth.
 */
function startResizeDrag(
  e: React.MouseEvent,
  startWidth: number,
  min: number,
  max: number,
  onWidth: (w: number) => void
): void {
  e.preventDefault()
  const startX = e.clientX
  const onMove = (ev: MouseEvent): void => {
    const next = Math.min(max, Math.max(min, startWidth + (ev.clientX - startX)))
    onWidth(next)
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/**
 * Collapsible Markdown editor panel with a command bar and formatting helpers.
 *
 * Expanded layout is 5 rows:
 *   1. Navbar — collapse toggle (left) + history button (right)
 *   2. Command bar — "⚡ 命令" probe button + the agent's slash commands as
 *      clickable chips. This row is completely separate from the input box:
 *      clicking a chip SELECTS it as the current command (highlighted);
 *      the command is joined with the content when sending to the terminal.
 *   3. Toolbar — markdown formatting shortcuts
 *   4. Editor — the textarea (plain Markdown input, no command palette)
 *   5. Footer — copy + send-to-terminal buttons
 * Collapsed: a narrow vertical strip showing only the toggle button.
 *
 * The width is controlled by the parent's shared layout state and can be
 * adjusted with the right-edge resizer. Exposes an imperative handle
 * (MarkdownHandle.setContent) for loading a history entry back into the editor.
 */
const MarkdownEditor = forwardRef<MarkdownHandle, MarkdownEditorProps>(function MarkdownEditor(
  { onSend, width, onResize, onOpenHistory, commands, onProbeCommands }: MarkdownEditorProps,
  ref
): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState('')
  /** Currently selected slash command name (no leading '/'), if any. */
  const [selectedCommand, setSelectedCommand] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [sentState, setSentState] = useState<'sent' | 'failed' | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sentTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  // Imperative handle: loading a history entry replaces the content AND expands
  // the panel so the loaded text is immediately visible.
  useImperativeHandle(
    ref,
    () => ({
      setContent: (text: string, command?: string): void => {
        setContent(text)
        setSelectedCommand(command ?? null)
        setExpanded(true)
      }
    }),
    []
  )

  // Clear any pending feedback timers on unmount
  useEffect(() => {
    return () => {
      if (sentTimerRef.current !== null) {
        window.clearTimeout(sentTimerRef.current)
      }
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const handleToggle = useCallback((): void => {
    setExpanded((v) => !v)
    // Focus textarea after expand animation
    if (!expanded) {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [expanded])

  const insertFormatting = useCallback(
    (before: string, after: string, placeholder?: string): void => {
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const selected = content.substring(start, end)
      const insertion = selected
        ? `${before}${selected}${after}`
        : `${before}${placeholder ?? ''}${after}`
      const next = content.substring(0, start) + insertion + content.substring(end)
      setContent(next)
      // Restore focus and place cursor after insertion
      requestAnimationFrame(() => {
        ta.focus()
        const pos = start + insertion.length
        ta.setSelectionRange(pos, pos)
      })
    },
    [content]
  )

  const handleBold = useCallback((): void => {
    insertFormatting('**', '**', '粗体文字')
  }, [insertFormatting])

  const handleInlineCode = useCallback((): void => {
    insertFormatting('`', '`', '行内代码')
  }, [insertFormatting])

  const handleCodeblock = useCallback((): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.substring(start, end)
    if (selected) {
      const insertion = '```\n' + selected + '\n```'
      const next = content.substring(0, start) + insertion + content.substring(end)
      setContent(next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(start + insertion.length, start + insertion.length)
      })
    } else {
      const insertion = '```\n语言\n```'
      const next = content + '\n' + insertion
      setContent(next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(next.length, next.length)
      })
    }
  }, [content])

  const handleUnorderedList = useCallback((): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.substring(start, end)
    if (selected) {
      const lines = selected.split('\n')
      const listed = lines.map((l) => `- ${l}`).join('\n')
      const next = content.substring(0, start) + listed + content.substring(end)
      setContent(next)
    } else {
      const insertion = '\n- 列表项'
      const pos = start + insertion.length
      const next = content.substring(0, start) + insertion + content.substring(end)
      setContent(next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    }
  }, [content])

  const handleOrderedList = useCallback((): void => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.substring(start, end)
    if (selected) {
      const lines = selected.split('\n')
      const listed = lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
      const next = content.substring(0, start) + listed + content.substring(end)
      setContent(next)
    } else {
      const insertion = '\n1. 列表项'
      const pos = start + insertion.length
      const next = content.substring(0, start) + insertion + content.substring(end)
      setContent(next)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(pos, pos)
      })
    }
  }, [content])

  // Copy feedback resets after ~1800ms; a new click clears the pending timer first.
  const scheduleCopiedReset = useCallback((): void => {
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800)
  }, [])

  const handleCopy = useCallback((): void => {
    // Prefer the main-process clipboard API (electron.clipboard.writeText) — it is
    // reliable regardless of renderer focus. Fall back to the async web API, then
    // show the success feedback only if one of the two actually resolved.
    window.agentHub
      .writeClipboard(content)
      .catch(() => navigator.clipboard.writeText(content)) // fallback
      .then(() => {
        setCopied(true)
        scheduleCopiedReset()
      })
      .catch((err: unknown) => {
        console.error('Failed to copy Markdown', err)
      })
  }, [content, scheduleCopiedReset])

  // Send feedback resets after ~1800ms; a new click clears the pending timer first.
  const scheduleSentReset = useCallback((): void => {
    if (sentTimerRef.current !== null) {
      window.clearTimeout(sentTimerRef.current)
    }
    sentTimerRef.current = window.setTimeout(() => setSentState(null), 1800)
  }, [])

  const handleSend = useCallback((): void => {
    // Nothing to send when both the command and the content are empty.
    if (!selectedCommand && !content.trim()) {
      setSentState('failed')
      scheduleSentReset()
      return
    }
    const ok = onSend?.(content, selectedCommand ?? undefined) ?? false
    setSentState(ok ? 'sent' : 'failed')
    scheduleSentReset()
  }, [content, selectedCommand, onSend, scheduleSentReset])

  // Toggle a command as "selected". The command is stored separately from the
  // content — the parent joins them with a single space when sending.
  const toggleCommand = useCallback(
    (command: AgentCommandDef): void => {
      setSelectedCommand((prev) => (prev === command.name ? null : command.name))
    },
    []
  )

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      // Ctrl/Cmd + Enter → send content into the active terminal
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleProbeCommands = useCallback((): void => {
    onProbeCommands?.()
  }, [onProbeCommands])

  return (
    <div
      className={`markdown-editor ${expanded ? 'markdown-editor--expanded' : 'markdown-editor--collapsed'}`}
      style={{ width: expanded ? width : 32 }}
    >
      {/* Row 1 — Navbar: collapse toggle (left) + history button (right) */}
      <div className="markdown-editor__navbar">
        <button type="button" className="markdown-editor__toggle" onClick={handleToggle} title="展开/收起">
          📝
        </button>
        {expanded && (
          <button
            type="button"
            className="markdown-editor__history-btn"
            onClick={onOpenHistory}
            title="查看该会话的提问历史"
          >
            📜 历史
          </button>
        )}
      </div>

      {expanded && (
        <>
          {/* Row 2 — Command bar: agent slash commands, SEPARATE from the input box.
              The "⚡ 命令" button re-probes the live terminal; command chips are
              toggled as the "current command" — joined with the content (one
              space) when sending to the terminal. */}
          <div className="markdown-editor__command-bar">
            <button
              type="button"
              className="markdown-editor__probe-btn"
              onClick={handleProbeCommands}
              title="从当前终端探测 Agent 的斜杠命令"
            >
              ⚡ 命令
            </button>
            {selectedCommand && (
              <button
                type="button"
                className="markdown-editor__command-selected"
                onClick={() => setSelectedCommand(null)}
                title={`当前命令：/${selectedCommand}（点击取消）`}
              >
                /{selectedCommand} ✕
              </button>
            )}
            {commands.length === 0 ? (
              <span className="markdown-editor__command-bar-hint">
                点击「⚡ 命令」探测当前 Agent 支持的斜杠命令
              </span>
            ) : (
              <div className="markdown-editor__command-chips">
                {commands.map((c) => (
                  <button
                    type="button"
                    key={c.name}
                    className={`markdown-editor__command-chip ${
                      selectedCommand === c.name ? 'markdown-editor__command-chip--selected' : ''
                    }`}
                    onClick={() => toggleCommand(c)}
                    title={c.description}
                  >
                    /{c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Row 3 — Toolbar: markdown formatting shortcuts only */}
          <div className="markdown-editor__toolbar">
            <button type="button" className="markdown-editor__toolbar-btn" onClick={handleBold} title="加粗">
              <strong>B</strong>
            </button>
            <button type="button" className="markdown-editor__toolbar-btn" onClick={handleInlineCode} title="行内代码">
              {'</>'}
            </button>
            <button type="button" className="markdown-editor__toolbar-btn" onClick={handleCodeblock} title="代码块">
              {'```'}
            </button>

            <div className="markdown-editor__toolbar-sep" />

            <button type="button" className="markdown-editor__toolbar-btn" onClick={handleUnorderedList} title="无序列表">
              —
            </button>
            <button type="button" className="markdown-editor__toolbar-btn" onClick={handleOrderedList} title="有序列表">
              1.
            </button>
          </div>

          {/* Row 4 — Editor: plain Markdown input (no command palette) */}
          <div className="markdown-editor__editor-wrap">
            <textarea
              ref={textareaRef}
              className="markdown-editor__textarea"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="在此编写 Markdown…（点击上方命令栏的命令，发送时会与内容拼接）"
              spellCheck={false}
            />
          </div>

          {/* Row 5 — Footer: copy + send-to-terminal */}
          <div className="markdown-editor__footer">
            <button
              type="button"
              className={`markdown-editor__copy-btn ${copied ? 'markdown-editor__copy-btn--copied' : ''}`}
              onClick={handleCopy}
              title="复制 Markdown 内容到剪贴板"
            >
              {copied ? '✓ 已复制' : '复制 Markdown'}
            </button>

            <button
              type="button"
              className={`markdown-editor__send-btn ${
                sentState === 'sent'
                  ? 'markdown-editor__send-btn--sent'
                  : sentState === 'failed'
                    ? 'markdown-editor__send-btn--failed'
                    : ''
              }`}
              onClick={handleSend}
              title="把内容追加到当前终端的输入框"
            >
              {sentState === 'sent' ? '✓ 已发送' : sentState === 'failed' ? '发送失败' : '发送到终端'}
            </button>
          </div>
        </>
      )}

      {expanded && onResize && (
        <div
          className="markdown-editor__resizer"
          onMouseDown={(e) => startResizeDrag(e, width, 200, 520, onResize)}
          title="拖拽调整宽度"
        />
      )}
    </div>
  )
})

export default MarkdownEditor
