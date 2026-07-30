import { useState, useCallback, useRef, useEffect } from 'react'
import type { AgentSession, AgentDescriptor } from '@shared/agentHub'

interface SessionSidebarProps {
  sessions: AgentSession[]
  agents: AgentDescriptor[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
}

/**
 * Session sidebar — shows a list of conversations.
 * New session button at top, sessions in reverse-chronological order.
 * Supports click-to-select, hover-delete, double-click-to-rename.
 */
export default function SessionSidebar({
  sessions,
  agents,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename
}: SessionSidebarProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const sorted = [...sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )

  // Focus input when starting edit
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const handleDoubleClick = useCallback((id: string, title: string) => {
    setEditingId(id)
    setEditValue(title)
  }, [])

  const handleRenameSubmit = useCallback(
    (id: string) => {
      const trimmed = editValue.trim()
      if (trimmed) {
        onRename(id, trimmed)
      }
      setEditingId(null)
    },
    [editValue, onRename]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, id: string) => {
      if (e.key === 'Enter') {
        handleRenameSubmit(id)
      } else if (e.key === 'Escape') {
        setEditingId(null)
      }
    },
    [handleRenameSubmit]
  )

  function getAgentIcon(agentId: string): string {
    return agents.find((a) => a.id === agentId)?.icon ?? '💬'
  }

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return '刚刚'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} 天前`
    const months = Math.floor(days / 30)
    return `${months} 个月前`
  }

  return (
    <div className="agent-hub__sidebar">
      <div className="agent-hub__sidebar-header">
        <span className="agent-hub__sidebar-title">会话</span>
        <button className="btn btn--primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={onNew}>
          ＋ 新建
        </button>
      </div>
      <div className="agent-hub__sidebar-list">
        {sorted.length === 0 ? (
          <div style={{ padding: '20px 14px', textAlign: 'center', fontSize: 13, color: 'var(--text-faint)' }}>
            暂无会话，点击「＋ 新建」开始
          </div>
        ) : (
          sorted.map((session) => {
            const isActive = session.id === activeSessionId
            const isEditing = session.id === editingId
            const statusIndicator =
              session.status === 'running'
                ? '⟳'
                : session.status === 'error'
                  ? '✗'
                  : ''

            return (
              <div
                key={session.id}
                className={`agent-hub__sidebar-item ${isActive ? 'agent-hub__sidebar-item--active' : ''}`}
                onClick={() => onSelect(session.id)}
              >
                <span className="agent-hub__sidebar-item-icon">
                  {statusIndicator || getAgentIcon(session.agentId)}
                </span>
                <div className="agent-hub__sidebar-item-body">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      className="agent-hub__sidebar-item-title-input"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(session.id)}
                      onKeyDown={(e) => handleKeyDown(e, session.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      className="agent-hub__sidebar-item-title"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        handleDoubleClick(session.id, session.title)
                      }}
                      title={session.title}
                    >
                      {session.title}
                    </div>
                  )}
                  <div className="agent-hub__sidebar-item-meta">
                    <span>{session.messages.length} 条消息</span>
                    <span>·</span>
                    <span>{relativeTime(session.updatedAt)}</span>
                  </div>
                </div>
                <button
                  className="agent-hub__sidebar-item-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(session.id)
                  }}
                  title="删除会话"
                >
                  🗑
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
