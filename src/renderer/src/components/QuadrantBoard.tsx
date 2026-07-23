import { useState } from 'react'
import type { Task, Quadrant } from '@shared/types'
import { QUADRANTS } from '@shared/types'
import { formatRecurrence } from '@shared/recurrence'

interface QuadrantBoardProps {
  tasks: Task[]
  onToggle: (id: string) => void
  onEdit: (task: Task) => void
  onDelete: (id: string) => void
  onAddTask?: (quadrant: Quadrant) => void
  /** Move a task to a different quadrant (drag-and-drop). Only in non-compact mode. */
  onMoveTask?: (taskId: string, targetQuadrant: Quadrant) => void
  compact?: boolean
}

/** Local today string yyyy-mm-dd */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Classify a due date for styling */
function dueState(due: string | null): 'none' | 'overdue' | 'today' | 'future' {
  if (!due) return 'none'
  const today = todayStr()
  if (due < today) return 'overdue'
  if (due === today) return 'today'
  return 'future'
}

/** Human-friendly due label */
function dueLabel(due: string | null): string {
  if (!due) return ''
  const today = todayStr()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tp = (n: number): string => String(n).padStart(2, '0')
  const tomorrowStr = `${tomorrow.getFullYear()}-${tp(tomorrow.getMonth() + 1)}-${tp(tomorrow.getDate())}`
  if (due === today) return '今天'
  if (due === tomorrowStr) return '明天'
  return due
}

export default function QuadrantBoard({
  tasks,
  onToggle,
  onEdit,
  onDelete,
  onAddTask,
  onMoveTask,
  compact = false
}: QuadrantBoardProps): JSX.Element {
  // Hide-completed toggle (per-board, default ON = hide completed).
  const [hideCompleted, setHideCompleted] = useState(true)
  // Drag-and-drop state (only in non-compact mode)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [dragOverQuadrant, setDragOverQuadrant] = useState<Quadrant | null>(null)
  const canDrag = !compact && !!onMoveTask
  const containerClass = compact ? 'quadrant-board quadrant-board--compact' : 'board'

  // Pre-filter: drop completed tasks when hideCompleted is on. Counts in
  // headers reflect the visible set so the user sees consistent numbers.
  const visibleTasks = compact ? tasks : (hideCompleted ? tasks.filter((t) => !t.completed) : tasks)

  return (
    <div className="quadrant-board-wrap">
      {/* Toolbar with toggle — hidden in compact mode (priority view sidebar) */}
      {!compact && (
        <div className="quadrant-board-toolbar">
          <label className="hide-completed-toggle">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(e) => setHideCompleted(e.target.checked)}
            />
            <span>隐藏已完成任务</span>
            {hideCompleted && tasks.some((t) => t.completed) && (
              <span className="hide-completed-toggle__count">
                （{tasks.filter((t) => t.completed).length} 个已隐藏）
              </span>
            )}
          </label>
        </div>
      )}

      <div className={containerClass}>
      {QUADRANTS.map((q) => {
        const list = visibleTasks
          .filter((t) => t.quadrant === q.id)
          .sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1
            if (!a.dueDate) return 1
            if (!b.dueDate) return -1
            return a.dueDate.localeCompare(b.dueDate)
          })
        return (
          <section
            key={q.id}
            className={`quadrant quadrant--${q.id} ${dragOverQuadrant === q.id ? 'quadrant--drag-over' : ''}`}
            onDragOver={canDrag ? (e) => {
              if (!draggedTaskId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOverQuadrant !== q.id) setDragOverQuadrant(q.id)
            } : undefined}
            onDragLeave={canDrag ? () => {
              setDragOverQuadrant((prev) => prev === q.id ? null : prev)
            } : undefined}
            onDrop={canDrag ? (e) => {
              e.preventDefault()
              if (draggedTaskId) {
                onMoveTask?.(draggedTaskId, q.id)
              }
              setDraggedTaskId(null)
              setDragOverQuadrant(null)
            } : undefined}
          >
            <div className="quadrant__header">
              <div className="quadrant__titles">
                <span className="quadrant__title">{q.title}</span>
                <span className="quadrant__subtitle">{q.subtitle}</span>
              </div>
              <span className="quadrant__count">{list.length}</span>
              {onAddTask && !compact && (
                <button
                  className="quadrant__add"
                  title="在此象限新建任务"
                  onClick={() => onAddTask(q.id)}
                >
                  +
                </button>
              )}
            </div>
            <div className="quadrant__list">
              {list.length === 0 ? (
                <div className="quadrant__empty">暂无任务，点击 + 添加</div>
              ) : (
                list.map((t) => {
                  const ds = dueState(t.dueDate)
                  return (
                    <div
                      key={t.id}
                      className={`task ${t.completed ? 'task--done' : ''} ${draggedTaskId === t.id ? 'task--dragging' : ''}`}
                      draggable={canDrag}
                      onDragStart={canDrag ? (e) => {
                        setDraggedTaskId(t.id)
                        e.dataTransfer.effectAllowed = 'move'
                      } : undefined}
                      onDragEnd={canDrag ? () => {
                        setDraggedTaskId(null)
                        setDragOverQuadrant(null)
                      } : undefined}
                    >
                      <input
                        type="checkbox"
                        className="task__check"
                        checked={t.completed}
                        onChange={() => onToggle(t.id)}
                      />
                      <div className="task__body">
                        <div className="task__content">{t.content}</div>
                        {(t.dueDate || (t.progress ?? 0) > 0 || t.recurrence) && (
                          <div className="task__meta">
                            {t.dueDate && (
                              <span
                                className={`task__due ${
                                  !t.completed && ds === 'overdue'
                                    ? 'task__due--overdue'
                                    : !t.completed && ds === 'today'
                                      ? 'task__due--today'
                                      : ''
                                }`}
                              >
                                📅 {dueLabel(t.dueDate)}
                                {!t.completed && ds === 'overdue' ? ' · 已逾期' : ''}
                              </span>
                            )}
                            {t.recurrence && (
                              <span className="task__recurrence">🔁 {formatRecurrence(t.recurrence)}</span>
                            )}
                            {(t.progress ?? 0) > 0 && (
                              <span
                                className={`task__progress ${t.progress === 100 ? 'task__progress--done' : ''}`}
                              >
                                {t.progress === 100 ? '✓ 已完成' : `进度 ${t.progress}%`}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {!compact && (
                        <div className="task__actions">
                          <button
                            className="task__action"
                            title="编辑"
                            onClick={() => onEdit(t)}
                          >
                            ✎
                          </button>
                          <button
                            className="task__action btn--danger"
                            title="删除"
                            onClick={() => onDelete(t.id)}
                          >
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>
        )
      })}
      </div>
    </div>
  )
}
