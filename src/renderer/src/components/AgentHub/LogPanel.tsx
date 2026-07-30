import { useRef, useEffect } from 'react'

interface LogPanelProps {
  logs: string[]
  onClear: () => void
  open: boolean
  onToggle: () => void
}

/**
 * Collapsible panel showing raw process output (stdout/stderr).
 * Auto-scrolls to bottom on new content.
 */
export default function LogPanel({ logs, onClear, open, onToggle }: LogPanelProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [logs, open])

  return (
    <div className="log-panel">
      <div className="log-panel__header" onClick={onToggle}>
        <span className="log-panel__title">
          <span>{open ? '▼' : '▶'}</span>
          <span>进程日志</span>
          {logs.length > 0 && <span>({logs.length})</span>}
        </span>
        {open && logs.length > 0 && (
          <button
            className="log-panel__clear-btn"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
          >
            清空
          </button>
        )}
      </div>
      {open && (
        <div className="log-panel__body" ref={bodyRef}>
          {logs.length === 0 ? (
            <div className="log-panel__empty">暂无日志</div>
          ) : (
            logs.map((line, i) => (
              <div
                key={i}
                className={`log-panel__line ${line.startsWith('[stderr]') ? 'log-panel__line--stderr' : ''}`}
              >
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
