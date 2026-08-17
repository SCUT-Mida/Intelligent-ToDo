import { useEffect, useRef, useState } from 'react'
import type { TaskEvent, TaskRunInfo } from '@shared/agentHub'
import { renderMarkdown } from '../../lib/markdownRender'

interface TaskTimelineProps {
  sessionId: string
  events: TaskEvent[]
  /** Live runs for this session (from the main registry). */
  runs: TaskRunInfo[]
  onCancelRun: (runId: string) => void
  onRerun: () => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Short single-line summary of a tool_call input JSON. */
function toolSummary(input?: string): string {
  if (!input) return ''
  try {
    const obj = JSON.parse(input) as Record<string, unknown>
    const first = Object.values(obj)[0]
    if (typeof first === 'string') return first.slice(0, 120)
    return input.slice(0, 120)
  } catch {
    return input.slice(0, 120)
  }
}

/**
 * Structured timeline of a session's event log (v1.23): user prompts,
 * assistant markdown, tool calls/results, and run boundaries. Live events
 * appended by the task runner appear immediately (the parent feeds them in).
 */
export default function TaskTimeline({
  sessionId,
  events,
  runs,
  onCancelRun,
  onRerun
}: TaskTimelineProps): JSX.Element {
  const runningHere = runs.filter((r) => r.sessionId === sessionId && r.status === 'running')
  const bottomRef = useRef<HTMLDivElement>(null)
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  const toggleTool = (key: string): void => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (events.length === 0 && runningHere.length === 0) {
    return (
      <div className="task-timeline task-timeline--empty">
        <div className="task-timeline__empty-icon">📋</div>
        <div className="task-timeline__empty-text">该会话还没有结构化任务记录</div>
        <div className="task-timeline__empty-hint">
          点击上方「运行任务」，以非交互方式让 agent 完成一次性任务；过程与结果会解析为结构化时间线并持久化。
        </div>
        <button className="btn btn--primary" onClick={onRerun}>▶ 运行任务</button>
      </div>
    )
  }

  return (
    <div className="task-timeline">
      {runningHere.length > 0 && (
        <div className="task-timeline__running">
          <span className="spinner spinner--sm" />
          <span>{runningHere.length} 个任务运行中…</span>
          {runningHere.map((r) => (
            <button
              key={r.runId}
              className="btn btn--ghost btn--sm"
              onClick={() => onCancelRun(r.runId)}
              title={`取消 ${r.runId}`}
            >
              取消
            </button>
          ))}
        </div>
      )}
      {events.map((e) => {
        const key = `${e.seq}`
        switch (e.type) {
          case 'run_started':
            return (
              <div key={key} className="task-timeline__divider">
                <span className="task-timeline__divider-time">{formatTime(e.at)}</span>
                <span className="task-timeline__divider-label">任务开始</span>
                {e.command && <code className="task-timeline__divider-cmd" title={e.command}>{e.command}</code>}
              </div>
            )
          case 'user_message':
            return (
              <div key={key} className="task-timeline__bubble task-timeline__bubble--user">
                <div className="task-timeline__bubble-role">我</div>
                <div className="task-timeline__bubble-body task-timeline__bubble-body--pre">
                  {e.prompt}
                </div>
              </div>
            )
          case 'assistant_message':
            return (
              <div key={key} className="task-timeline__bubble task-timeline__bubble--assistant">
                <div className="task-timeline__bubble-role">Agent</div>
                <div className="task-timeline__bubble-body task-timeline__bubble-body--md">
                  {renderMarkdown(e.text ?? '')}
                </div>
              </div>
            )
          case 'tool_call':
            return (
              <div key={key} className="task-timeline__tool">
                <button
                  className="task-timeline__tool-head"
                  onClick={() => toggleTool(key)}
                  title="展开/收起工具输入"
                >
                  <span className="task-timeline__tool-chevron">
                    {expandedTools.has(key) ? '▾' : '▸'}
                  </span>
                  <span className="task-timeline__tool-name">🛠 {e.toolName ?? 'tool'}</span>
                  <span className="task-timeline__tool-summary">{toolSummary(e.toolInput)}</span>
                </button>
                {expandedTools.has(key) && e.toolInput && (
                  <pre className="task-timeline__tool-detail">{e.toolInput}</pre>
                )}
              </div>
            )
          case 'tool_result':
            return null // folded into the following assistant turn visually
          case 'run_finished':
            return (
              <div key={key} className="task-timeline__divider task-timeline__divider--done">
                <span className="task-timeline__divider-time">{formatTime(e.at)}</span>
                <span className="task-timeline__divider-label">
                  ✅ 任务完成{typeof e.exitCode === 'number' ? `（退出码 ${e.exitCode}）` : ''}
                </span>
                {e.usage && (
                  <span className="task-timeline__divider-usage">
                    {e.usage.inputTokens ?? 0} in / {e.usage.outputTokens ?? 0} out tokens
                  </span>
                )}
              </div>
            )
          case 'run_error':
            return (
              <div key={key} className="task-timeline__divider task-timeline__divider--error">
                <span className="task-timeline__divider-time">{formatTime(e.at)}</span>
                <span className="task-timeline__divider-label">❌ 任务失败</span>
                {e.error && <span className="task-timeline__divider-err">{e.error}</span>}
              </div>
            )
          case 'run_cancelled':
            return (
              <div key={key} className="task-timeline__divider">
                <span className="task-timeline__divider-time">{formatTime(e.at)}</span>
                <span className="task-timeline__divider-label">⏹ 已取消</span>
              </div>
            )
          default:
            return null
        }
      })}
      <div ref={bottomRef} />
    </div>
  )
}
