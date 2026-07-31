import { useEffect } from 'react'
import type { AgentSession, SessionHistoryEntry } from '@shared/agentHub'

interface SessionHistoryDialogProps {
  /** Session whose history is shown (null while closing). */
  session: AgentSession | null
  /** This session's history entries (newest last). */
  entries: SessionHistoryEntry[]
  onClose: () => void
  /** Copy entry content to clipboard. */
  onCopy: (content: string) => void
  /** Re-inject an entry into that session's terminal. Returns success. */
  onSendAgain: (sessionId: string, content: string) => boolean
}

/**
 * Modal dialog listing a session's pasted/sent question history.
 *
 * Renders newest-first cards (timestamp + source badge + content + actions).
 * Esc closes the dialog; clicking the overlay (not the box) also closes it.
 * Follows the `.new-session-dialog` overlay pattern with a light theme.
 */
export default function SessionHistoryDialog({
  session,
  entries,
  onClose,
  onCopy,
  onSendAgain
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

  const handleSendAgain = (entry: SessionHistoryEntry): void => {
    const ok = onSendAgain(session.id, entry.content)
    if (!ok) {
      window.alert('该会话终端未就绪，请稍后再试')
    }
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
                  <span
                    className={`session-history-dialog__badge session-history-dialog__badge--${entry.source}`}
                  >
                    {entry.source === 'markdown' ? 'Markdown 发送' : '终端粘贴'}
                  </span>
                </div>
                <pre className="session-history-dialog__content">{entry.content}</pre>
                <div className="session-history-dialog__entry-actions">
                  <button
                    className="btn btn--ghost session-history-dialog__action-btn"
                    onClick={() => onCopy(entry.content)}
                  >
                    复制
                  </button>
                  <button
                    className="btn btn--ghost session-history-dialog__action-btn"
                    onClick={() => handleSendAgain(entry)}
                  >
                    再次发送
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
