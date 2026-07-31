import { useEffect } from 'react'
import type { AgentSession, SessionHistoryEntry } from '@shared/agentHub'

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
              <div key={entry.id} className="session-history-dialog__entry">
                <div className="session-history-dialog__entry-meta">
                  <span className="session-history-dialog__time">
                    {new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}
                  </span>
                  {entry.command && (
                    <span className="session-history-dialog__badge session-history-dialog__badge--command">
                      /{entry.command}
                    </span>
                  )}
                  <span
                    className={`session-history-dialog__badge session-history-dialog__badge--${entry.source}`}
                  >
                    {entry.source === 'markdown' ? 'Markdown 发送' : '终端粘贴'}
                  </span>
                </div>
                <pre className="session-history-dialog__content">{entry.content}</pre>
                <div className="session-history-dialog__entry-actions">
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
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
