import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AgentSession, SessionHistoryEntry } from '@shared/agentHub'
import { sortHistoryEntries } from '@shared/agentHub'

/** How many entries to render initially and per "load more" step (v1.26.1). */
const PAGE_SIZE = 30

interface HistoryEntryProps {
  entry: SessionHistoryEntry
  highlighted: boolean
  onReEdit: (entry: SessionHistoryEntry) => void
  onTogglePin: (entry: SessionHistoryEntry) => void
  onDelete: (entry: SessionHistoryEntry) => void
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
function HistoryEntry({ entry, highlighted, onReEdit, onTogglePin, onDelete }: HistoryEntryProps): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
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

  // Deep-link from the sidebar search (v1.26.1): scroll into view and fade.
  useEffect(() => {
    if (!highlighted) return
    setExpanded(true)
    rootRef.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  const collapsed = !expanded && overflowing
  // Case-insensitive content match for the active query (v1.26.1).
  const content = entry.content

  return (
    <div
      ref={rootRef}
      className={`session-history-dialog__entry${
        entry.pinned ? ' session-history-dialog__entry--pinned' : ''
      }${highlighted ? ' session-history-dialog__entry--focus' : ''}`}
    >
      <div className="session-history-dialog__entry-meta">
        <span className="session-history-dialog__time">
          {new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}
        </span>
        <span
          className={`session-history-dialog__badge session-history-dialog__badge--${entry.source}`}
        >
          {entry.source === 'markdown' ? 'Markdown 发送' : '终端粘贴'}
        </span>
        {entry.pinned && (
          <span className="session-history-dialog__badge session-history-dialog__badge--pin">
            📌 置顶
          </span>
        )}
      </div>
      <pre
        ref={preRef}
        className={`session-history-dialog__content${
          collapsed ? ' session-history-dialog__content--collapsed' : ''
        }`}
      >
        {content}
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
          className="session-history-dialog__pin-btn"
          onClick={() => onTogglePin(entry)}
          title={entry.pinned ? '取消置顶' : '置顶：常用提问固定在历史最上方'}
        >
          {entry.pinned ? '📌 取消置顶' : '📌 置顶'}
        </button>
        <button
          type="button"
          className="session-history-dialog__reedit-btn"
          onClick={() => onReEdit(entry)}
          title="把这条内容载入 Markdown 编辑器"
        >
          ✏️ 重新编辑
        </button>
        <button
          type="button"
          className="session-history-dialog__delete-btn"
          onClick={() => {
            if (window.confirm('确定删除这条提问记录吗？删除后无法恢复。')) {
              onDelete(entry)
            }
          }}
          title="从历史中删除这条记录"
        >
          🗑 删除
        </button>
      </div>
    </div>
  )
}

interface SessionHistoryDialogProps {
  /** Session whose history is shown (null while closing). */
  session: AgentSession | null
  /** This session's history entries (chronological, possibly long — v1.26.1 allows up to 500). */
  entries: SessionHistoryEntry[]
  /** Entry to scroll-to/highlight on open (deep-link from sidebar search). */
  focusEntryId?: string | null
  onClose: () => void
  /** Load an entry back into that session's markdown editor for editing. */
  onReEdit: (entry: SessionHistoryEntry) => void
  /** Toggle an entry's pinned flag (pinned entries float to the top). */
  onTogglePin: (entry: SessionHistoryEntry) => void
  /** Delete one entry from the history (v1.26.2, confirmed by the entry card). */
  onDelete: (entry: SessionHistoryEntry) => void
}

/**
 * Modal dialog listing a session's pasted/sent question history.
 *
 * v1.26.1 scaling: the store may hold up to 500 entries per repo, so the
 * list is (a) filterable by a case-insensitive content query and (b)
 * rendered incrementally — PAGE_SIZE cards at first, a 加载更多 button
 * extends the page. Sorting stays: pinned first, then newest-first.
 */
export default function SessionHistoryDialog({
  session,
  entries,
  focusEntryId,
  onClose,
  onReEdit,
  onTogglePin,
  onDelete
}: SessionHistoryDialogProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const searchRef = useRef<HTMLInputElement>(null)

  // Close on Escape (unless typing in the search box — Esc clears it first).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (query) {
          setQuery('')
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, query])

  // Reset paging + search state whenever the dialog (re)opens for a session.
  useEffect(() => {
    if (session === null) return
    setQuery('')
    setVisibleCount(PAGE_SIZE)
    if (!focusEntryId) {
      // Auto-focus the search box for quick keyboard filtering.
      const t = window.setTimeout(() => searchRef.current?.focus(), 50)
      return () => window.clearTimeout(t)
    }
  }, [session?.id, focusEntryId])

  // Filter → sort. Filtering is case-insensitive over the content.
  const q = query.trim().toLowerCase()
  const ordered = useMemo(() => {
    const filtered = q
      ? entries.filter((e) => e.content.toLowerCase().includes(q))
      : entries
    return sortHistoryEntries(filtered)
  }, [entries, q])

  // Render just enough pages to include the focus entry (v1.26.3) —
  // previously this rendered up to 500 cards at once, making search
  // deep-links janky to open.
  const focusIndex = focusEntryId ? ordered.findIndex((e) => e.id === focusEntryId) : -1
  const focusPages = focusIndex >= 0 ? Math.ceil((focusIndex + 1) / PAGE_SIZE) * PAGE_SIZE : 0
  const effectiveVisible = Math.max(visibleCount, focusPages)
  const visible = ordered.slice(0, effectiveVisible)
  const hasMore = ordered.length > visible.length

  if (session === null) {
    return null
  }

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
            <span className="session-history-dialog__count">
              {q ? `（匹配 ${ordered.length} / ${entries.length} 条）` : `（${entries.length} 条）`}
            </span>
          </span>
          <button className="session-history-dialog__close" onClick={onClose} title="关闭">
            ✕
          </button>
        </div>

        {entries.length > 0 && (
          <div className="session-history-dialog__search">
            <input
              ref={searchRef}
              className="session-history-dialog__search-input"
              placeholder="🔍 在提问历史中检索内容…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setVisibleCount(PAGE_SIZE)
              }}
              spellCheck={false}
            />
            {query && (
              <button
                className="session-history-dialog__search-clear"
                onClick={() => setQuery('')}
                title="清除检索"
              >
                ×
              </button>
            )}
          </div>
        )}

        {entries.length === 0 ? (
          <div className="session-history-dialog__empty">
            暂无提问记录（从 Markdown 发送或向终端粘贴的内容会记录在这里）
          </div>
        ) : ordered.length === 0 ? (
          <div className="session-history-dialog__empty">没有匹配「{query}」的提问</div>
        ) : (
          <div className="session-history-dialog__list">
            {visible.map((entry) => (
              <HistoryEntry
                key={entry.id}
                entry={entry}
                highlighted={focusEntryId === entry.id}
                onReEdit={onReEdit}
                onTogglePin={onTogglePin}
                onDelete={onDelete}
              />
            ))}
            {hasMore && (
              <button
                type="button"
                className="session-history-dialog__load-more"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                加载更多（已显示 {visible.length} / {ordered.length}）
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
