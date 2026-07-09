import { useState } from 'react'
import type { Task, Quadrant, DailyPriority } from '@shared/types'
import { getQuadrantMeta } from '@shared/types'
import QuadrantBoard from './QuadrantBoard'

type AiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

interface TodayPriorityViewProps {
  /** All tasks (used to resolve priority items -> task content/quadrant) */
  tasks: Task[]
  /** Today's priority snapshot, or null if not yet generated */
  todayPriority: DailyPriority | null
  /** Past daily priorities (excluding today), should be sorted newest-first by caller */
  history: DailyPriority[]
  /** Current AI call state */
  aiState: AiState
  /** Number of incomplete tasks (for the "start analysis" gate) */
  incompleteCount: number
  /** Trigger AI re-analysis */
  onRegenerate: () => void
  /** Toggle a priority item's completion (also toggles linked task) */
  onTogglePriorityItem: (taskId: string) => void
  /** Update a priority item's progress (0-100) */
  onUpdateProgress: (taskId: string, progress: number) => void
  /** Board handlers (forwarded to compact QuadrantBoard) */
  onToggleTask: (id: string) => void
  onEditTask: (task: Task) => void
  onDeleteTask: (id: string) => void
  onAddTask: (quadrant: Quadrant) => void
}

const PROGRESS_STEPS = [0, 25, 50, 75, 100]

/** Format a yyyy-mm-dd string as "7月9日 周三". */
function formatDateZh(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  const date = new Date(y, m - 1, d)
  if (Number.isNaN(date.getTime())) return dateStr
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`
}

export default function TodayPriorityView({
  tasks,
  todayPriority,
  history,
  aiState,
  incompleteCount,
  onRegenerate,
  onTogglePriorityItem,
  onUpdateProgress,
  onToggleTask,
  onEditTask,
  onDeleteTask,
  onAddTask
}: TodayPriorityViewProps): JSX.Element {
  const [tab, setTab] = useState<'today' | 'history'>('today')
  const [expandedDate, setExpandedDate] = useState<string | null>(null)
  // Left board defaults to collapsed — focus on the priority list.
  const [boardExpanded, setBoardExpanded] = useState(false)

  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const todayHasItems = !!todayPriority && todayPriority.items.length > 0

  return (
    <div className={`priority-view ${boardExpanded ? 'priority-view--expanded' : 'priority-view--collapsed'}`}>
      {/* LEFT: compact four-quadrant board (collapsible, hidden by default) */}
      {boardExpanded && (
        <div className="priority-view__left">
          <QuadrantBoard
            tasks={tasks}
            onToggle={onToggleTask}
            onEdit={onEditTask}
            onDelete={onDeleteTask}
            onAddTask={onAddTask}
            compact
          />
        </div>
      )}

      {/* RIGHT: priority panel */}
      <aside className="priority-view__right">
        <div className="priority-panel">
          <div className="priority-panel__header">
            <div className="priority-panel__headrow">
              <div>
                <div className="priority-panel__title">今日优先</div>
                <div className="priority-panel__hint">
                  AI 根据四象限与截止日期，为你智能排序今日最该做的事
                </div>
              </div>
              <button
                className="btn btn--ghost priority-panel__toggle"
                onClick={() => setBoardExpanded((v) => !v)}
                title={boardExpanded ? '收起任务看板' : '展开任务看板'}
              >
                {boardExpanded ? '收起看板 ‹' : '› 展开看板'}
              </button>
            </div>
          </div>

          <div className="priority-panel__tabs">
            <button
              className={`priority-panel__tab ${tab === 'today' ? 'priority-panel__tab--active' : ''}`}
              onClick={() => setTab('today')}
            >
              今日
            </button>
            <button
              className={`priority-panel__tab ${tab === 'history' ? 'priority-panel__tab--active' : ''}`}
              onClick={() => setTab('history')}
            >
              历史 {history.length > 0 ? `(${history.length})` : ''}
            </button>
          </div>

          <div className="priority-panel__body">
            {tab === 'today' && (
              <TodayTab
                todayPriority={todayPriority}
                aiState={aiState}
                incompleteCount={incompleteCount}
                totalTasks={tasks.length}
                taskMap={taskMap}
                todayHasItems={todayHasItems}
                onRegenerate={onRegenerate}
                onTogglePriorityItem={onTogglePriorityItem}
                onUpdateProgress={onUpdateProgress}
                onEditTask={onEditTask}
              />
            )}

            {tab === 'history' && (
              <HistoryTab
                history={history}
                taskMap={taskMap}
                expandedDate={expandedDate}
                onToggleExpand={(date) =>
                  setExpandedDate((cur) => (cur === date ? null : date))
                }
              />
            )}
          </div>

          {tab === 'today' && incompleteCount > 0 && (
            <div className="priority-panel__actions">
              <button
                className="btn btn--primary"
                onClick={onRegenerate}
                disabled={aiState.kind === 'loading'}
              >
                {aiState.kind === 'loading'
                  ? '分析中...'
                  : todayHasItems
                    ? '重新分析'
                    : '开始智能分析'}
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}

// ---------------- Today tab ----------------

interface TodayTabProps {
  todayPriority: DailyPriority | null
  aiState: AiState
  incompleteCount: number
  totalTasks: number
  taskMap: Map<string, Task>
  todayHasItems: boolean
  onRegenerate: () => void
  onTogglePriorityItem: (taskId: string) => void
  onUpdateProgress: (taskId: string, progress: number) => void
  /** Open the full task editor (content + quadrant + due date) for a priority item */
  onEditTask: (task: Task) => void
}

function TodayTab({
  todayPriority,
  aiState,
  incompleteCount,
  totalTasks,
  taskMap,
  todayHasItems,
  onRegenerate,
  onTogglePriorityItem,
  onUpdateProgress,
  onEditTask
}: TodayTabProps): JSX.Element {
  if (aiState.kind === 'loading') {
    return (
      <div className="priority-panel__loading">
        <div className="spinner" />
        <div>AI 正在分析你的任务，请稍候...</div>
      </div>
    )
  }

  if (aiState.kind === 'error') {
    return (
      <>
        <div className="priority-panel__error">{aiState.message}</div>
        <button className="btn btn--ghost" onClick={onRegenerate}>
          重试
        </button>
      </>
    )
  }

  // No incomplete tasks AND no prior analysis: nothing to show or do.
  // (If analysis exists, we fall through and show the completed items below.)
  if (incompleteCount === 0 && !todayPriority) {
    return (
      <div className="priority-panel__empty">
        <div style={{ fontSize: 32 }}>{totalTasks === 0 ? '📝' : '🎉'}</div>
        <div>
          {totalTasks === 0 ? '当前没有任何任务' : '所有任务已完成，太棒了！'}
        </div>
        <div className="field__hint">
          {totalTasks === 0
            ? '先在左侧看板添加任务，再来让 AI 智能排序'
            : '如需重新规划，可以添加新任务后再进行分析'}
        </div>
      </div>
    )
  }

  // There are incomplete tasks, but analysis hasn't been run yet.
  if (!todayPriority) {
    return (
      <div className="priority-panel__empty">
        <div style={{ fontSize: 32 }}>🎯</div>
        <div>今日尚未进行智能分析</div>
        <div className="field__hint">
          点击下方「开始智能分析」，AI 将根据四象限与截止日期为你推荐今日优先事项
        </div>
      </div>
    )
  }

  // Analysis ran but produced no valid items (all taskIds filtered out, etc.)
  if (!todayHasItems) {
    return (
      <div className="priority-panel__empty">
        <div style={{ fontSize: 32 }}>🤔</div>
        <div>本次分析未能生成有效的推荐项</div>
        <div className="field__hint">
          可能是 AI 返回的任务 ID 不匹配。点击「重新分析」再试一次
        </div>
      </div>
    )
  }

  return (
    <>
      {todayPriority.summary && (
        <div className="priority-panel__summary">
          <span className="priority-panel__summary-label">今日行动建议</span>
          {todayPriority.summary}
        </div>
      )}
      {todayPriority.items.map((item, idx) => {
        const task = taskMap.get(item.taskId)
        const reason = item.reason
        return (
          <div
            key={item.taskId + idx}
            className={`priority-item ${item.completed ? 'priority-item--done' : ''}`}
          >
            <input
              type="checkbox"
              className="priority-item__check"
              checked={item.completed}
              onChange={() => onTogglePriorityItem(item.taskId)}
            />
            <div className="priority-item__body">
              <div className="priority-item__head">
                <div className={`priority-item__content ${!task ? 'priority-item__content--deleted' : ''}`}>
                  {task ? task.content : '（原任务已删除）'}
                </div>
                <span className="priority-item__index">#{idx + 1}</span>
                {task && (
                  <button
                    className="priority-item__edit"
                    title="编辑任务（内容 / 优先级 / 截止日期）"
                    onClick={() => onEditTask(task)}
                  >
                    ✎
                  </button>
                )}
              </div>
              {reason && <div className="priority-item__reason">{reason}</div>}
              {!task && (
                <div className="priority-item__deleted">该任务已被删除</div>
              )}
              {task && (
                <div className="priority-item__meta">
                  <span
                    className="priority-item__quadrant"
                    data-q={task.quadrant}
                  >
                    {getQuadrantMeta(task.quadrant).shortLabel}
                  </span>
                  <ProgressSteps
                    current={item.progress}
                    completed={item.completed}
                    onChange={(p) => onUpdateProgress(item.taskId, p)}
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

// ---------------- Progress steps ----------------

interface ProgressStepsProps {
  current: number
  completed: boolean
  onChange: (progress: number) => void
}

function ProgressSteps({
  current,
  completed,
  onChange
}: ProgressStepsProps): JSX.Element {
  const display = completed ? 100 : current
  return (
    <div className="priority-progress">
      <span className="priority-progress__label">进度 {display}%</span>
      {PROGRESS_STEPS.map((step) => {
        // Step 0 is never "filled"; steps > 0 fill up to the current level.
        const isFilled = step > 0 && step <= display
        const isDone = step === 100 && display === 100
        return (
          <button
            key={step}
            type="button"
            className={`progress-step ${isFilled ? 'progress-step--filled' : ''} ${isDone ? 'progress-step--done' : ''}`}
            title={`${step}%`}
            onClick={() => onChange(step)}
          >
            {step === 0 ? '0' : step === 100 ? '✓' : ''}
          </button>
        )
      })}
    </div>
  )
}

// ---------------- History tab ----------------

interface HistoryTabProps {
  history: DailyPriority[]
  taskMap: Map<string, Task>
  expandedDate: string | null
  onToggleExpand: (date: string) => void
}

function HistoryTab({
  history,
  taskMap,
  expandedDate,
  onToggleExpand
}: HistoryTabProps): JSX.Element {
  if (history.length === 0) {
    return (
      <div className="priority-history__empty">
        暂无历史记录。每次进行「智能分析」后，当天的结果都会自动保存到这里。
      </div>
    )
  }

  return (
    <div className="priority-history">
      {history.map((dp) => {
        const isOpen = expandedDate === dp.date
        const doneCount = dp.items.filter((it) => it.completed).length
        return (
          <div
            key={dp.date}
            className={`priority-history__item ${isOpen ? 'priority-history__item--open' : ''}`}
          >
            <div
              className="priority-history__head"
              onClick={() => onToggleExpand(dp.date)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="priority-history__date">
                  {formatDateZh(dp.date)}
                </div>
                <div className="priority-history__summary">
                  {dp.summary || '（无行动建议）'}
                </div>
              </div>
              <span className="priority-history__count">
                {doneCount}/{dp.items.length}
              </span>
              <span className="priority-history__chevron">›</span>
            </div>
            {isOpen && (
              <div className="priority-history__items">
                {dp.items.map((item, idx) => {
                  const task = taskMap.get(item.taskId)
                  return (
                    <div key={item.taskId + idx} className="priority-history__sub-item">
                      <span
                        className={`priority-history__sub-check ${item.completed ? 'priority-history__sub-check--done' : ''}`}
                      >
                        {item.completed ? '✓' : '○'}
                      </span>
                      <span
                        className={`priority-history__sub-content ${item.completed ? 'priority-history__sub-content--done' : ''}`}
                      >
                        {task ? task.content : '（原任务已删除）'}
                      </span>
                      <span className="priority-history__sub-progress">
                        {item.completed ? '已完成' : `${item.progress}%`}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
