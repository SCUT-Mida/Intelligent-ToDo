import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AgentSession, SessionHistoryEntry } from '@shared/agentHub'

interface HistoryEntryProps {
  entry: SessionHistoryEntry
  onReEdit: (entry: SessionHistoryEntry) => void
}

/**
 * A single question-history card: meta row + content pre + actions.
 *
 * Long content is collapsed to 3 lines by default (via -webkit-line-clamp);
 * when it actually overflows, an 展开/收起 toggle is shown. Overflow is
 * detected by temporarily un-clamping the pre to measure its full height —
 * reading scrollHeight directly on a clamped element returns the clamped
 * height, so that naive check would never detect overflow.
 */
function HistoryEntry({ entry, onReEdit }: HistoryEntryProps): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  // Measure the real content height with the clamp removed, then restore.
  // Re-runs whenever content changes (e.g. the dialog re-opens with new data).
  useLayoutEffect(() => {
    const el = preRef.current
    if (!el) return
    // Force the clamp inline so measurement is independent of the current
    // expanded/collapsed class state (prevents a stale full-height clientHeight
    // when the entry was already expanded before the content changed).
    const prevDisplay = el.style.display
    const prevClamp = el.style.webkitLineClamp
    const prevBoxOrient = el.style.webkitBoxOrient
    const prevOverflow = el.style.overflow
    const prevMaxHeight = el.style.maxHeight
    // -webkit-line-clamp only takes effect together with box-orient: vertical
    // AND overflow: hidden — missing either turns it into a no-op, so the
    // "clamped" measurement would equal the full height and overflow would
    // never be detected (entries never collapse).
    el.style.display = '-webkit-box'
    el.style.webkitBoxOrient = 'vertical'
    el.style.webkitLineClamp = '3'
    el.style.overflow = 'hidden'
    el.style.maxHeight = 'none'
    const clampedHeight = el.clientHeight
    el.style.webkitLineClamp = 'unset'
    const fullHeight = el.scrollHeight
    el.style.display = prevDisplay
    el.style.webkitBoxOrient = prevBoxOrient
    el.style.webkitLineClamp = prevClamp
    el.style.overflow = prevOverflow
    el.style.maxHeight = prevMaxHeight
    setOverflowing(fullHeight > clampedHeight + 1)
    setExpanded(false)
  }, [entry.content])

  const collapsed = !expanded && overflowing

  return (
    <div className="session-history-dialog__entry">
      <div className="session-history-dialog__entry-meta">
        <span className="session-history-dialog__time">
          {new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}
        </span>
        <span
          className={`session-history-dialog__badge session-history-dialog__badge--${entry.source}`}
        >
          {entry.source === 'markdown' ? 'Markdown 发送' : '终端粘贴'}
        </span>
      </div>
      <pre
        ref={preRef}
        className={`session-history-dialog__content${
          collapsed ? ' session-history-dialog__content--collapsed' : ''
        }`}
      >
        {entry.content}
      </pre>
      <div className="session-history-dialog__entry-actions">
        {overflowing && (
          <button
            type="button"
            className="session-history-dialog__expand-btn"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? '收起' : '展开'}
          </button>
        )}
        <button
          type="button"
          className="session-history-dialog__reedit-btn"
          onClick={() => onReEdit(entry)}
          title="把这条内容载入 Markdown 编辑器"
        >
          ✏️ 重新编辑
        </button>
      </div>
    </div>
  )
}

interface SessionHistoryDialogProps {
  /** Session whose history is shown (null while closing). */
  session: AgentSession | null
  /** This session's history entries (newest last). */
  entries: SessionHistoryEntry[]
  onClose: () => void
  /** Load an entry back into that session's markdown editor for editing. */
  onReEdit: (entry: SessionHistoryEntry) => void
}

/**
 * Modal dialog listing a session's pasted/sent question history.
 *
 * Renders newest-first cards (timestamp + source badge + content + a single
 * "重新编辑" action that loads the entry back into the markdown editor).
 * Esc closes the dialog; clicking the overlay (not the box) also closes it.
 * Follows the `.new-session-dialog` overlay pattern with a light theme.
 */
export default function SessionHistoryDialog({
  session,
  entries,
  onClose,
  onReEdit
}: SessionHistoryDialogProps): JSX.Element | null {
  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  if (session === null) {
    return null
  }

  // Newest first — render in reverse without mutating the original array
  const newestFirst = [...entries].reverse()

  return (
    <div
      className="session-history-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="session-history-dialog__box">
        <div className="session-history-dialog__heading">
          <span className="session-history-dialog__title">
            「{session.title}」提问历史
            <span className="session-history-dialog__count">（{entries.length} 条）</span>
          </span>
          <button className="session-history-dialog__close" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="session-history-dialog__empty">
            暂无提问记录（从 Markdown 发送或向终端粘贴的内容会记录在这里）
          </div>
        ) : (
          <div className="session-history-dialog__list">
            {newestFirst.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} onReEdit={onReEdit} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
