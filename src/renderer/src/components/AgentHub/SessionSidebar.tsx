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
  onHistory: (id: string) => void
  /** Whether the sidebar is collapsed to a narrow strip. */
  collapsed: boolean
  /** Expanded sidebar width in px (controlled by the parent). */
  width: number
  /** Called when the user clicks the expand/collapse toggle. */
  onToggleCollapse: () => void
  /** Called while the user drags the sidebar's right-edge resizer. */
  onResize: (w: number) => void
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
 * Session sidebar — shows a list of saved agent launch sessions.
 * New session button at top, sessions sorted by lastLaunchedAt (recent first),
 * then by createdAt. Supports click-to-select, hover-delete, double-click-rename.
 *
 * Collapsible to a narrow strip (expand ☰ + new-session ＋); when expanded the
 * width is controlled by the parent and adjustable with the right-edge resizer.
 */
export default function SessionSidebar({
  sessions,
  agents,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onHistory,
  collapsed,
  width,
  onToggleCollapse,
  onResize
}: SessionSidebarProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Sort: most recent launch first, then by creation date
  const sorted = [...sessions].sort((a, b) => {
    const aTime = a.lastLaunchedAt ? new Date(a.lastLaunchedAt).getTime() : 0
    const bTime = b.lastLaunchedAt ? new Date(b.lastLaunchedAt).getTime() : 0
    if (aTime !== bTime) return bTime - aTime
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

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

  function getDirBasename(path: string): string {
    if (!path) return ''
    const parts = path.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] ?? ''
  }

  function relativeTime(iso: string | null): string {
    if (!iso) return '从未启动'
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

  // Collapsed: narrow vertical strip with expand toggle + new-session shortcut.
  if (collapsed) {
    return (
      <div className="agent-hub__sidebar agent-hub__sidebar--collapsed" style={{ width: 36 }}>
        <div className="agent-hub__sidebar-strip">
          <button className="agent-hub__sidebar-toggle" onClick={onToggleCollapse} title="展开会话列表">
            ☰
          </button>
          <button className="agent-hub__sidebar-toggle" onClick={onNew} title="新建会话">
            ＋
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="agent-hub__sidebar" style={{ width }}>
      <div className="agent-hub__sidebar-header">
        <div className="agent-hub__sidebar-title-group">
          <span className="agent-hub__sidebar-title">会话</span>
          <button className="agent-hub__sidebar-collapse" onClick={onToggleCollapse} title="收起侧边栏">
            «
          </button>
        </div>
        <button className="btn btn--primary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={onNew}>
          ＋ 新建会话
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
            const dirBase = getDirBasename(session.workDir)

            return (
              <div
                key={session.id}
                className={`agent-hub__sidebar-item ${isActive ? 'agent-hub__sidebar-item--active' : ''}`}
                onClick={() => onSelect(session.id)}
              >
                <span className="agent-hub__sidebar-item-icon">
                  {getAgentIcon(session.agentId)}
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
                    {dirBase && (
                      <>
                        <span>{dirBase}</span>
                        <span>·</span>
                      </>
                    )}
                    {session.launchCount > 0 && (
                      <>
                        <span className="agent-hub__sidebar-item-count">
                          {session.launchCount} 次
                        </span>
                        <span>·</span>
                      </>
                    )}
                    <span>{relativeTime(session.lastLaunchedAt)}</span>
                  </div>
                </div>
                <button
                  className="agent-hub__sidebar-item-rename"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDoubleClick(session.id, session.title)
                  }}
                  title="重命名"
                >
                  ✏️
                </button>
                <button
                  className="agent-hub__sidebar-item-history"
                  onClick={(e) => {
                    e.stopPropagation()
                    onHistory(session.id)
                  }}
                  title="查看提问历史"
                >
                  📜
                </button>
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
      <div
        className="agent-hub__sidebar-resizer"
        onMouseDown={(e) => startResizeDrag(e, width, 160, 420, onResize)}
        title="拖拽调整宽度"
      />
    </div>
  )
}
