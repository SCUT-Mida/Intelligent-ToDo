import { useState, useCallback } from 'react'
import type { SavedApiRequest, ApiHistoryEntry, ApiHttpMethod } from '@shared/apiTool'

interface ApiSidebarProps {
  requests: SavedApiRequest[]
  history: ApiHistoryEntry[]
  activeRequestId: string | null
  onSelectRequest: (id: string) => void
  onNewRequest: () => void
  onRenameRequest: (id: string, name: string) => void
  onDeleteRequest: (id: string) => void
  onRestoreHistory: (entry: ApiHistoryEntry) => void
  onClearHistory: () => void
}

function statusClass(status: number | null): string {
  if (status === null) return 'api-sidebar__status--err'
  if (status >= 200 && status < 300) return 'api-sidebar__status--ok'
  if (status >= 400) return 'api-sidebar__status--err'
  return 'api-sidebar__status--warn'
}

function methodClass(method: ApiHttpMethod): string {
  return method === 'GET' ? 'api-sidebar__method--get' : 'api-sidebar__method--post'
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.host + (u.pathname === '/' ? '' : u.pathname)
  } catch {
    return url
  }
}

/**
 * API tool sidebar — saved requests (click to load / rename / delete) above
 * a collapsible history section (click to restore the full spec snapshot).
 */
export default function ApiSidebar({
  requests,
  history,
  activeRequestId,
  onSelectRequest,
  onNewRequest,
  onRenameRequest,
  onDeleteRequest,
  onRestoreHistory,
  onClearHistory
}: ApiSidebarProps): JSX.Element {
  const [historyOpen, setHistoryOpen] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const commitRename = useCallback(
    (id: string): void => {
      const trimmed = editValue.trim()
      if (trimmed) onRenameRequest(id, trimmed)
      setEditingId(null)
    },
    [editValue, onRenameRequest]
  )

  return (
    <div className="api-sidebar">
      <div className="api-sidebar__header">
        <span className="api-sidebar__title">请求</span>
        <button
          className="btn btn--primary"
          style={{ padding: '4px 12px', fontSize: 12 }}
          onClick={onNewRequest}
        >
          ＋ 新建
        </button>
      </div>

      <div className="api-sidebar__list">
        {requests.length === 0 ? (
          <div className="api-sidebar__empty">暂无收藏请求。配置好请求后点「保存」收藏。</div>
        ) : (
          requests.map((req) => {
            const isActive = req.id === activeRequestId
            const isEditing = req.id === editingId
            return (
              <div
                key={req.id}
                className={`api-sidebar__item ${isActive ? 'api-sidebar__item--active' : ''}`}
                onClick={() => onSelectRequest(req.id)}
              >
                <span className={`api-sidebar__method ${methodClass(req.method)}`}>{req.method}</span>
                <div className="api-sidebar__item-body">
                  {isEditing ? (
                    <input
                      className="api-sidebar__item-input"
                      value={editValue}
                      autoFocus
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitRename(req.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(req.id)
                        if (e.key === 'Escape') setEditingId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div
                      className="api-sidebar__item-name"
                      title={req.name}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setEditingId(req.id)
                        setEditValue(req.name)
                      }}
                    >
                      {req.name}
                    </div>
                  )}
                  <div className="api-sidebar__item-url" title={req.url}>
                    {shortUrl(req.url)}
                  </div>
                </div>
                <button
                  className="api-sidebar__item-action"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditingId(req.id)
                    setEditValue(req.name)
                  }}
                >
                  ✏️
                </button>
                <button
                  className="api-sidebar__item-action api-sidebar__item-action--danger"
                  title="删除收藏"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteRequest(req.id)
                  }}
                >
                  🗑
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* History section */}
      <div className="api-sidebar__history">
        <button
          className="api-sidebar__history-header"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <span className={`api-sidebar__history-chevron ${historyOpen ? 'api-sidebar__history-chevron--open' : ''}`}>
            {historyOpen ? '▾' : '▸'}
          </span>
          <span className="api-sidebar__history-title">历史记录</span>
          <span className="api-sidebar__history-count">{history.length}</span>
          {history.length > 0 && (
            <span
              className="api-sidebar__history-clear"
              title="清空历史"
              onClick={(e) => {
                e.stopPropagation()
                onClearHistory()
              }}
            >
              清空
            </span>
          )}
        </button>
        {historyOpen && (
          <div className="api-sidebar__history-list">
            {history.length === 0 ? (
              <div className="api-sidebar__empty">暂无历史。发送的请求会记录在这里。</div>
            ) : (
              [...history].reverse().map((entry) => (
                <button
                  key={entry.id}
                  className="api-sidebar__history-item"
                  onClick={() => onRestoreHistory(entry)}
                  title={`${entry.method} ${entry.url}\n点击还原该请求`}
                >
                  <span className={`api-sidebar__method ${methodClass(entry.method)}`}>{entry.method}</span>
                  <span className="api-sidebar__history-url">{shortUrl(entry.url)}</span>
                  <span className={`api-sidebar__status ${statusClass(entry.status)}`}>
                    {entry.status ?? '失败'}
                  </span>
                  <span className="api-sidebar__history-time">{relativeTime(entry.at)}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
