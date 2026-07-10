import { useState, useEffect, useCallback } from 'react'
import type { AppData, Task, Quadrant, AppConfig, DailyPriority } from '@shared/types'
import { createDefaultData } from '@shared/types'
import TaskModal from './components/TaskModal'
import ConfigModal from './components/ConfigModal'
import QuadrantBoard from './components/QuadrantBoard'
import TodayPriorityView from './components/TodayPriorityView'
import CalendarView from './components/CalendarView'
import PomodoroView from './components/PomodoroView'
import { generateMarkdown, defaultMdFileName } from './lib/markdown'

type View = 'board' | 'priority' | 'calendar' | 'pomodoro'

type AiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

/** Local today string yyyy-mm-dd */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export default function App(): JSX.Element {
  const [data, setData] = useState<AppData>(createDefaultData())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [taskModal, setTaskModal] = useState<{ task: Task | null; quadrant: Quadrant } | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [view, setView] = useState<View>('board')
  const [aiState, setAiState] = useState<AiState>({ kind: 'idle' })

  // ---- persistence ----
  useEffect(() => {
    window.api
      .loadData()
      .then((result) => {
        const nextData: AppData = {
          ...result.data,
          // Ensure priorities array exists for backward compatibility with old data files.
          priorities: result.data.priorities ?? [],
          // Ensure pomodoro state exists for backward compatibility.
          pomodoro: result.data.pomodoro ?? { date: '', count: 0 },
          // Ensure holiday overrides map exists for backward compatibility.
          holidayOverrides: result.data.holidayOverrides ?? {}
        }
        setData(nextData)
        if (!result.ok) {
          // Corrupted file was backed up and reset by the main process.
          setLoadError(result.error ?? '数据加载失败')
        }
        setLoaded(true)
      })
      .catch((e) => {
        console.error('load failed', e)
        setLoadError(e instanceof Error ? e.message : String(e))
        setLoaded(true)
      })
  }, [])

  useEffect(() => {
    if (!loaded) return
    window.api.saveData(data).catch((e) => console.error('save failed', e))
  }, [data, loaded])

  // ---- task ops ----
  const handleSaveTask = useCallback(
    (input: { content: string; quadrant: Quadrant; dueDate: string | null; progress: number }): void => {
      const now = new Date().toISOString()
      const today = todayStr()
      // Reaching 100% completes the task; below 100% never auto-uncompletes it.
      const completedByProgress = input.progress === 100
      setData((prev) => {
        const editingId = taskModal?.task?.id
        if (editingId) {
          const wasCompleted = prev.tasks.find((t) => t.id === editingId)?.completed ?? false
          const newCompleted = completedByProgress || wasCompleted
          return {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === editingId
                ? { ...t, ...input, completed: newCompleted, updatedAt: now }
                : t
            ),
            // reverse-sync: keep today's priority item in step when edited via task detail
            priorities: (prev.priorities ?? []).map((dp) =>
              dp.date === today
                ? {
                    ...dp,
                    updatedAt: now,
                    items: dp.items.map((it) =>
                      it.taskId === editingId
                        ? {
                            ...it,
                            progress: input.progress,
                            completed: completedByProgress || it.completed,
                            completedAt: completedByProgress && !it.completedAt ? now : it.completedAt
                          }
                        : it
                    )
                  }
                : dp
            )
          }
        }
        const nt: Task = {
          id: newId(),
          ...input,
          completed: completedByProgress,
          createdAt: now,
          updatedAt: now
        }
        return { ...prev, tasks: [...prev.tasks, nt] }
      })
      setTaskModal(null)
    },
    [taskModal]
  )

  const toggleTask = useCallback((id: string): void => {
    const now = new Date().toISOString()
    const today = todayStr()
    setData((prev) => {
      const task = prev.tasks.find((t) => t.id === id)
      if (!task) return prev
      const newCompleted = !task.completed
      return {
        ...prev,
        tasks: prev.tasks.map((t) =>
          t.id === id ? { ...t, completed: newCompleted, updatedAt: now } : t
        ),
        // Keep today's priority items in sync when a task is toggled from the board.
        priorities: (prev.priorities ?? []).map((dp) =>
          dp.date === today
            ? {
                ...dp,
                updatedAt: now,
                items: dp.items.map((item) =>
                  item.taskId === id
                    ? {
                        ...item,
                        completed: newCompleted,
                        // Snapping progress to 100 on complete; leave as-is when un-completing.
                        progress: newCompleted ? 100 : item.progress,
                        completedAt: newCompleted ? now : null
                      }
                    : item
                )
              }
            : dp
        )
      }
    })
  }, [])

  const deleteTask = useCallback((id: string): void => {
    setData((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== id) }))
  }, [])

  const saveConfig = useCallback((config: AppConfig): void => {
    setData((prev) => ({ ...prev, config }))
    setConfigOpen(false)
  }, [])

  const exportMd = useCallback(async (): Promise<void> => {
    const md = generateMarkdown(data.tasks)
    try {
      await window.api.exportMarkdown(md, defaultMdFileName())
    } catch (e) {
      console.error('export failed', e)
    }
  }, [data.tasks])

  // Fetch a year's official holiday data and persist it locally so the calendar
  // keeps working offline afterward. User does this once per year in Settings.
  const fetchHolidays = useCallback(async (year: number): Promise<void> => {
    const result = await window.api.fetchHolidays(year)
    setData((prev) => ({
      ...prev,
      holidayOverrides: { ...(prev.holidayOverrides ?? {}), [year]: result }
    }))
  }, [])

  // Flush the latest data to disk, then run the update installer. Guarantees no
  // in-flight save is cut off by the quit-and-install.
  const installUpdate = useCallback(async (): Promise<void> => {
    try {
      await window.api.saveData(data)
    } catch (e) {
      console.error('pre-update save failed', e)
    }
    window.api.installUpdate()
  }, [data])

  // ---- AI priority ops ----
  const handleAiRegenerate = useCallback(async (): Promise<void> => {
    const today = todayStr()
    const existing = (data.priorities ?? []).find((p) => p.date === today)
    if (existing && existing.items.length > 0) {
      if (!window.confirm('今日已有分析结果，重新分析将覆盖当前内容，确认继续？')) return
    }
    setAiState({ kind: 'loading' })
    try {
      const result = await window.api.aiRecommend(data.tasks, data.config, data.holidayOverrides)
      const now = new Date().toISOString()
      const newPriority: DailyPriority = {
        date: today,
        items: result.items.map((item) => ({
          taskId: item.taskId,
          reason: item.reason,
          progress: 0,
          completed: false,
          completedAt: null
        })),
        summary: result.summary,
        createdAt: now,
        updatedAt: now
      }
      setData((prev) => {
        const filtered = (prev.priorities ?? []).filter((p) => p.date !== today)
        return { ...prev, priorities: [...filtered, newPriority] }
      })
      setAiState({ kind: 'idle' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setAiState({ kind: 'error', message })
    }
  }, [data.tasks, data.config, data.priorities])

  const handleTogglePriorityItem = useCallback((taskId: string): void => {
    const today = todayStr()
    const now = new Date().toISOString()
    setData((prev) => {
      const task = prev.tasks.find((t) => t.id === taskId)
      return {
        ...prev,
        // Toggle linked task completion if the task still exists
        tasks: task
          ? prev.tasks.map((t) =>
              t.id === taskId ? { ...t, completed: !t.completed, updatedAt: now } : t
            )
          : prev.tasks,
        priorities: (prev.priorities ?? []).map((dp) =>
          dp.date === today
            ? {
                ...dp,
                updatedAt: now,
                items: dp.items.map((item) =>
                  item.taskId === taskId
                    ? {
                        ...item,
                        completed: !item.completed,
                        // When marking complete via checkbox, snap progress to 100.
                        // When un-completing, leave progress as-is.
                        progress: !item.completed ? 100 : item.progress,
                        completedAt: !item.completed ? now : null
                      }
                    : item
                )
              }
            : dp
        )
      }
    })
  }, [])

  const handleUpdateProgress = useCallback((taskId: string, progress: number): void => {
    const today = todayStr()
    const now = new Date().toISOString()
    setData((prev) => {
      const task = prev.tasks.find((t) => t.id === taskId)
      const reachesHundred = progress === 100
      return {
        ...prev,
        // Sync progress onto the Task itself (source of truth) + complete at 100%.
        tasks: prev.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                progress,
                completed: reachesHundred ? true : t.completed,
                updatedAt: now
              }
            : t
        ),
        // Keep today's priority item in step too.
        priorities: (prev.priorities ?? []).map((dp) =>
          dp.date === today
            ? {
                ...dp,
                updatedAt: now,
                items: dp.items.map((item) =>
                  item.taskId === taskId
                    ? {
                        ...item,
                        progress,
                        completed: reachesHundred ? true : item.completed,
                        completedAt:
                          reachesHundred && !item.completedAt ? now : item.completedAt
                      }
                    : item
                )
              }
            : dp
        )
      }
    })
  }, [])

  // ---- pomodoro ----
  // Increment today's completed-work-session count, rolling over on a new day.
  const handleCompleteWorkSession = useCallback((): void => {
    const today = todayStr()
    setData((prev) => {
      const cur = prev.pomodoro
      if (!cur || cur.date !== today) {
        return { ...prev, pomodoro: { date: today, count: 1 } }
      }
      return { ...prev, pomodoro: { date: today, count: cur.count + 1 } }
    })
  }, [])

  // ---- derived ----
  const today = todayStr()
  const todayPriority = (data.priorities ?? []).find((p) => p.date === today) ?? null
  const history = (data.priorities ?? [])
    .filter((p) => p.date !== today)
    .sort((a, b) => b.date.localeCompare(a.date))
  const incompleteCount = data.tasks.filter((t) => !t.completed).length
  const totalTasks = data.tasks.length
  const doneTasks = data.tasks.filter((t) => t.completed).length
  const pendingTasks = totalTasks - doneTasks
  const pomodoroTodayCount =
    data.pomodoro && data.pomodoro.date === today ? data.pomodoro.count : 0

  if (!loaded) {
    return (
      <div className="app">
        <div className="ai-panel__loading" style={{ margin: 'auto' }}>
          <div className="spinner" />
          <div>加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {/* Load error banner */}
      {loadError && (
        <div className="load-banner">
          <span>⚠ {loadError}</span>
          <button className="load-banner__close" onClick={() => setLoadError(null)}>
            知道了
          </button>
        </div>
      )}
      {/* Toolbar */}
      <header className="toolbar">
        <div className="toolbar__title">智能化代办</div>
        <div className="toolbar__tabs">
          <button
            className={`toolbar__tab ${view === 'board' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setView('board')}
          >
            任务看板
          </button>
          <button
            className={`toolbar__tab ${view === 'priority' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setView('priority')}
          >
            今日优先
          </button>
          <button
            className={`toolbar__tab ${view === 'calendar' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setView('calendar')}
          >
            日历总览
          </button>
          <button
            className={`toolbar__tab ${view === 'pomodoro' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setView('pomodoro')}
          >
            番茄钟
          </button>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setTaskModal({ task: null, quadrant: 'q1' })}
        >
          + 新建任务
        </button>
        <div className="toolbar__spacer" />
        <div className="toolbar__stats">
          <span>
            待办 <b>{pendingTasks}</b>
          </span>
          <span>
            已完成 <b>{doneTasks}</b>
          </span>
          <span>
            共 <b>{totalTasks}</b>
          </span>
        </div>
        <button
          className="btn btn--icon"
          onClick={() => setConfigOpen(true)}
          title="设置"
          aria-label="设置"
        >
          ⚙
        </button>
      </header>

      {/* Main content — switches between views */}
      {view === 'board' && (
        <QuadrantBoard
          tasks={data.tasks}
          onToggle={toggleTask}
          onEdit={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
          onDelete={deleteTask}
          onAddTask={(q) => setTaskModal({ task: null, quadrant: q })}
        />
      )}

      {view === 'priority' && (
        <TodayPriorityView
          tasks={data.tasks}
          todayPriority={todayPriority}
          history={history}
          aiState={aiState}
          incompleteCount={incompleteCount}
          onRegenerate={handleAiRegenerate}
          onTogglePriorityItem={handleTogglePriorityItem}
          onUpdateProgress={handleUpdateProgress}
          onToggleTask={toggleTask}
          onEditTask={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
          onDeleteTask={deleteTask}
          onAddTask={(q) => setTaskModal({ task: null, quadrant: q })}
        />
      )}

      {view === 'calendar' && (
        <CalendarView
          tasks={data.tasks}
          onToggle={toggleTask}
          onEdit={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
          holidayOverrides={data.holidayOverrides}
        />
      )}

      {view === 'pomodoro' && (
        <PomodoroView
          tasks={data.tasks}
          todayCount={pomodoroTodayCount}
          onCompleteWorkSession={handleCompleteWorkSession}
        />
      )}

      {/* Modals */}
      {taskModal && (
        <TaskModal
          task={taskModal.task}
          defaultQuadrant={taskModal.quadrant}
          onSave={handleSaveTask}
          onClose={() => setTaskModal(null)}
        />
      )}
      {configOpen && (
        <ConfigModal
          config={data.config}
          onSave={saveConfig}
          onClose={() => setConfigOpen(false)}
          onExportMarkdown={exportMd}
          taskCount={totalTasks}
          loadedHolidayYears={Object.keys(data.holidayOverrides ?? {}).map(Number).sort((a, b) => a - b)}
          onFetchHolidays={fetchHolidays}
          onInstallUpdate={installUpdate}
        />
      )}
    </div>
  )
}
