import { useState, useCallback, useRef, useEffect } from 'react'
import type { AgentSession, AgentDescriptor } from '@shared/agentHub'

// Group key for sessions without a workDir (shouldn't normally happen).
const OTHER_GROUP = '\u0000other'

interface SessionSidebarProps {
  sessions: AgentSession[]
  agents: AgentDescriptor[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
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
 * then by createdAt. Supports click-to-select, always-visible rename/delete
 * actions, and double-click-rename. Never-launched sessions show a 新建 badge.
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
  collapsed,
  width,
  onToggleCollapse,
  onResize
}: SessionSidebarProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // WorkDir groups collapsed by the user (keyed by the group key).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Sort: most recent launch first, then by creation date
  const sorted = [...sessions].sort((a, b) => {
    const aTime = a.lastLaunchedAt ? new Date(a.lastLaunchedAt).getTime() : 0
    const bTime = b.lastLaunchedAt ? new Date(b.lastLaunchedAt).getTime() : 0
    if (aTime !== bTime) return bTime - aTime
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  // Group sessions by workDir (repo). Groups are ordered by their newest
  // session's activity so the most recently used repos float to the top.
  const groupKeys: string[] = []
  const groupsMap = new Map<string, AgentSession[]>()
  for (const s of sorted) {
    const key = s.workDir || OTHER_GROUP
    const arr = groupsMap.get(key)
    if (arr) {
      arr.push(s)
    } else {
      groupsMap.set(key, [s])
      groupKeys.push(key)
    }
  }
  const newestTime = (list: AgentSession[]): number =>
    list.reduce(
      (max, s) => Math.max(max, s.lastLaunchedAt ? new Date(s.lastLaunchedAt).getTime() : new Date(s.createdAt).getTime()),
      0
    )
  groupKeys.sort((a, b) => newestTime(groupsMap.get(a)!) - newestTime(groupsMap.get(b)!))

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const getGroupLabel = (key: string): string =>
    key === OTHER_GROUP ? '其他' : getDirBasename(key)

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
          groupKeys.map((key) => {
            const group = groupsMap.get(key)!
            const isCollapsed = collapsedGroups.has(key)
            return (
              <div key={key} className="agent-hub__sidebar-group">
                <button
                  type="button"
                  className="agent-hub__sidebar-group-header"
                  onClick={() => toggleGroup(key)}
                  title={key === OTHER_GROUP ? undefined : key}
                >
                  <span className="agent-hub__sidebar-group-chevron">{isCollapsed ? '▸' : '▾'}</span>
                  <span className="agent-hub__sidebar-group-label">{getGroupLabel(key)}</span>
                  <span className="agent-hub__sidebar-group-count">{group.length}</span>
                </button>
                {!isCollapsed &&
                  group.map((session) => {
                    const isActive = session.id === activeSessionId
                    const isEditing = session.id === editingId

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
                            {session.launchCount > 0 && (
                              <>
                                <span className="agent-hub__sidebar-item-count">
                                  {session.launchCount} 次
                                </span>
                                <span>·</span>
                              </>
                            )}
                            {session.lastLaunchedAt ? (
                              <span>{relativeTime(session.lastLaunchedAt)}</span>
                            ) : (
                              <span className="agent-hub__sidebar-item-new">新建</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="agent-hub__sidebar-item-action"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDoubleClick(session.id, session.title)
                          }}
                          title="重命名"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="agent-hub__sidebar-item-action agent-hub__sidebar-item-action--danger"
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
                  })}
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
