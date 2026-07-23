import { useEffect } from 'react'

interface GuideModalProps {
  title: string
  content: string
  onClose: () => void
}

/**
 * Minimal markdown-to-JSX renderer. Supports:
 * - # / ## / ### headers
 * - - bullet lists
 * - **bold**
 * - `inline code`
 * - Paragraphs (blank-line separated)
 *
 * Intentionally minimal — no external markdown library needed.
 */
function renderMarkdown(md: string): JSX.Element[] {
  const lines = md.split('\n')
  const elements: JSX.Element[] = []
  let key = 0
  let listItems: string[] = []
  let paragraph: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return
    const text = paragraph.join(' ')
    elements.push(<p key={key++} className="guide__p">{renderInline(text)}</p>)
    paragraph = []
  }

  const flushList = (): void => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={key++} className="guide__ul">
        {listItems.map((item, i) => (
          <li key={i} className="guide__li">{renderInline(item)}</li>
        ))}
      </ul>
    )
    listItems = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      flushList()
      continue
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph()
      flushList()
      elements.push(<h4 key={key++} className="guide__h3">{renderInline(trimmed.slice(4))}</h4>)
    } else if (trimmed.startsWith('## ')) {
      flushParagraph()
      flushList()
      elements.push(<h3 key={key++} className="guide__h2">{renderInline(trimmed.slice(3))}</h3>)
    } else if (trimmed.startsWith('# ')) {
      flushParagraph()
      flushList()
      elements.push(<h2 key={key++} className="guide__h1">{renderInline(trimmed.slice(2))}</h2>)
    } else if (trimmed.startsWith('- ')) {
      flushParagraph()
      listItems.push(trimmed.slice(2))
    } else {
      flushList()
      paragraph.push(trimmed)
    }
  }

  flushParagraph()
  flushList()
  return elements
}

/** Render **bold** and `inline code` in a string. */
function renderInline(text: string): JSX.Element {
  // Split by **bold** and `code` patterns
  const parts: Array<{ type: 'text' | 'bold' | 'code'; content: string }> = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/)
    const codeMatch = remaining.match(/`(.+?)`/)

    if (boldMatch && (!codeMatch || boldMatch.index! < codeMatch.index!)) {
      if (boldMatch.index! > 0) parts.push({ type: 'text', content: remaining.slice(0, boldMatch.index) })
      parts.push({ type: 'bold', content: boldMatch[1] })
      remaining = remaining.slice(boldMatch.index! + boldMatch[0].length)
    } else if (codeMatch) {
      if (codeMatch.index! > 0) parts.push({ type: 'text', content: remaining.slice(0, codeMatch.index) })
      parts.push({ type: 'code', content: codeMatch[1] })
      remaining = remaining.slice(codeMatch.index! + codeMatch[0].length)
    } else {
      parts.push({ type: 'text', content: remaining })
      remaining = ''
    }
  }

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'bold') return <strong key={i}>{part.content}</strong>
        if (part.type === 'code') return <code key={i} className="guide__code">{part.content}</code>
        return <span key={i}>{part.content}</span>
      })}
    </>
  )
}

/**
 * Modal that renders a markdown-formatted guide for the user.
 * Closes on Escape, overlay click, or × button.
 */
export default function GuideModal({ title, content, onClose }: GuideModalProps): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal guide-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">{title}</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body guide-modal__body">
          {renderMarkdown(content)}
        </div>
        <div className="modal__footer">
          <button className="btn btn--primary" onClick={onClose}>我知道了</button>
        </div>
      </div>
    </div>
  )
}
