import { useState, useCallback, useRef } from 'react'

/**
 * Collapsible Markdown editor panel with formatting helpers.
 *
 * Renders a toggle button in a header bar. When expanded, shows a textarea
 * with formatting shortcut buttons (bold, code, codeblock, list, numbered list)
 * and a "复制 Markdown" copy-to-clipboard button.
 *
 * Collapsed by default. When expanded, intended to take ~30% of the terminal
 * area height (controlled by the parent's flex layout).
 */
export default function MarkdownEditor(): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState('')
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const handleCopy = useCallback((): void => {
    navigator.clipboard.writeText(content).catch((err: unknown) => {
      console.error('Failed to copy Markdown', err)
    })
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }, [content])

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      setContent(e.target.value)
    },
    []
  )

  return (
    <div className={`markdown-editor ${expanded ? 'markdown-editor--expanded' : ''}`}>
      <div className="markdown-editor__header">
        <button
          className="markdown-editor__toggle"
          onClick={handleToggle}
          title={expanded ? '收起 Markdown' : '打开 Markdown 编辑器'}
        >
          📝
        </button>

        {expanded && (
          <div className="markdown-editor__toolbar">
            <button className="markdown-editor__toolbar-btn" onClick={handleBold} title="加粗">
              <strong>B</strong>
            </button>
            <button className="markdown-editor__toolbar-btn" onClick={handleInlineCode} title="行内代码">
              {'</>'}
            </button>
            <button className="markdown-editor__toolbar-btn" onClick={handleCodeblock} title="代码块">
              {'```'}
            </button>

            <div className="markdown-editor__toolbar-sep" />

            <button className="markdown-editor__toolbar-btn" onClick={handleUnorderedList} title="无序列表">
              —
            </button>
            <button className="markdown-editor__toolbar-btn" onClick={handleOrderedList} title="有序列表">
              1.
            </button>

            <button
              className={`markdown-editor__copy-btn ${copied ? 'markdown-editor__copy-btn--copied' : ''}`}
              onClick={handleCopy}
              title="复制 Markdown 内容到剪贴板"
            >
              {copied ? '✓ 已复制' : '复制 Markdown'}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <textarea
          ref={textareaRef}
          className="markdown-editor__textarea"
          value={content}
          onChange={handleTextareaChange}
          placeholder="在此编写 Markdown…"
          spellCheck={false}
        />
      )}
    </div>
  )
}
