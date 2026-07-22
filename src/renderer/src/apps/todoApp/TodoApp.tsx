import { useState, useCallback } from 'react'
import type { Task, Quadrant, TaskRecurrence, DailyPriority, AppConfig } from '@shared/types'
import { computeNextOccurrence } from '@shared/recurrence'
import { useAppContext } from '../../store/AppContext'
import TaskModal from '../../components/TaskModal'
import QuadrantBoard from '../../components/QuadrantBoard'
import TodayPriorityView from '../../components/TodayPriorityView'
import CalendarView from '../../components/CalendarView'
import PomodoroView from '../../components/PomodoroView'
import { generateMarkdown, defaultMdFileName } from '../../lib/markdown'

type TodoView = 'board' | 'priority' | 'calendar' | 'pomodoro'

type AiState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }

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

export default function TodoApp(): JSX.Element {
  const { state, dispatch } = useAppContext()
  const { data } = state

  const [todoView, setTodoView] = useState<TodoView>('board')
  const [taskModal, setTaskModal] = useState<{ task: Task | null; quadrant: Quadrant } | null>(null)
  const [aiState, setAiState] = useState<AiState>({ kind: 'idle' })

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

  // ---- task ops ----
  const handleSaveTask = useCallback(
    (input: { content: string; quadrant: Quadrant; dueDate: string | null; progress: number; recurrence?: TaskRecurrence }): void => {
      const now = new Date().toISOString()
      const todayLocal = todayStr()
      const effectiveDue = input.recurrence ? computeNextOccurrence(input.recurrence) : input.dueDate
      const completedByProgress = input.progress === 100

      dispatch({
        type: 'SET_DATA',
        payload: (() => {
          const prev = state.data
          const editingId = taskModal?.task?.id
          if (editingId) {
            const wasCompleted = prev.tasks.find((t) => t.id === editingId)?.completed ?? false
            const newCompleted = completedByProgress || wasCompleted
            return {
              ...prev,
              tasks: prev.tasks.map((t) =>
                t.id === editingId
                  ? { ...t, ...input, dueDate: effectiveDue, recurrence: input.recurrence, completed: newCompleted, updatedAt: now }
                  : t
              ),
              priorities: (prev.priorities ?? []).map((dp) =>
                dp.date === todayLocal
                  ? {
                      ...dp,
                      updatedAt: now,
                      items: dp.items.map((it) =>
                        it.taskId === editingId
                          ? { ...it, progress: input.progress, completed: completedByProgress || it.completed, completedAt: completedByProgress && !it.completedAt ? now : it.completedAt }
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
            dueDate: effectiveDue,
            recurrence: input.recurrence,
            completed: completedByProgress,
            createdAt: now,
            updatedAt: now
          }
          return { ...prev, tasks: [...prev.tasks, nt] }
        })()
      })
      setTaskModal(null)
    },
    [state.data, taskModal, dispatch]
  )

  const toggleTask = useCallback((id: string): void => {
    const now = new Date().toISOString()
    const todayLocal = todayStr()
    dispatch({
      type: 'SET_DATA',
      payload: (() => {
        const prev = state.data
        const task = prev.tasks.find((t) => t.id === id)
        if (!task) return prev
        const newCompleted = !task.completed

        if (newCompleted && task.recurrence) {
          const nextDue = computeNextOccurrence(task.recurrence)
          return {
            ...prev,
            tasks: prev.tasks.map((t) =>
              t.id === id
                ? { ...t, completed: false, progress: 0, dueDate: nextDue, updatedAt: now }
                : t
            ),
            priorities: (prev.priorities ?? []).map((dp) =>
              dp.date === todayLocal
                ? { ...dp, updatedAt: now, items: dp.items.map((item) => item.taskId === id ? { ...item, completed: false, progress: 0, completedAt: null } : item) }
                : dp
            )
          }
        }

        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === id ? { ...t, completed: newCompleted, updatedAt: now } : t
          ),
          priorities: (prev.priorities ?? []).map((dp) =>
            dp.date === todayLocal
              ? {
                  ...dp,
                  updatedAt: now,
                  items: dp.items.map((item) =>
                    item.taskId === id
                      ? { ...item, completed: newCompleted, progress: newCompleted ? 100 : item.progress, completedAt: newCompleted ? now : item.completedAt }
                      : item
                  )
                }
              : dp
          )
        }
      })()
    })
  }, [state.data, dispatch])

  const deleteTask = useCallback((id: string): void => {
    dispatch({ type: 'SET_DATA', payload: { ...state.data, tasks: state.data.tasks.filter((t) => t.id !== id) } })
  }, [state.data, dispatch])

  // ---- AI priority ops ----
  const handleAiRegenerate = useCallback(async (): Promise<void> => {
    const todayLocal = todayStr()
    const existing = (state.data.priorities ?? []).find((p) => p.date === todayLocal)
    if (existing && existing.items.length > 0) {
      if (!window.confirm('今日已有分析结果，重新分析将覆盖当前内容，确认继续？')) return
    }
    setAiState({ kind: 'loading' })
    try {
      const result = await window.api.aiRecommend(
        state.data.tasks,
        state.data.config,
        state.data.holidayOverrides,
        { companyLastSaturday: state.data.companyLastSaturday ?? true }
      )
      const now = new Date().toISOString()
      const newPriority: DailyPriority = {
        date: todayLocal,
        items: result.items.map((item) => ({
          taskId: item.taskId,
          reason: item.reason
            .replace(/\[ID:\s*[^\]]*\]/gi, '')
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
            .replace(/ID[：:]\s*[0-9a-f\-]{8,}/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim(),
          progress: 0,
          completed: false,
          completedAt: null
        })),
        summary: result.summary,
        createdAt: now,
        updatedAt: now
      }
      const prev = state.data
      const filtered = (prev.priorities ?? []).filter((p) => p.date !== todayLocal)
      dispatch({ type: 'SET_DATA', payload: { ...prev, priorities: [...filtered, newPriority] } })
      setAiState({ kind: 'idle' })
    } catch (e) {
      // Check if this was a user-initiated cancel
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('超时') || msg.includes('timeout') || msg.includes('abort') || msg.includes('Abort')) {
        setAiState({ kind: 'idle' })  // silent return to idle on cancel
      } else {
        setAiState({ kind: 'error', message: msg })
      }
    }
  }, [state.data, dispatch])

  const handleAiCancel = useCallback(async (): Promise<void> => {
    await window.api.cancelAiRecommend()
    setAiState({ kind: 'idle' })
  }, [])

  const handleTogglePriorityItem = useCallback((taskId: string): void => {
    const todayLocal = todayStr()
    const now = new Date().toISOString()
    dispatch({
      type: 'SET_DATA',
      payload: (() => {
        const prev = state.data
        const task = prev.tasks.find((t) => t.id === taskId)
        return {
          ...prev,
          tasks: task
            ? prev.tasks.map((t) => t.id === taskId ? { ...t, completed: !t.completed, updatedAt: now } : t)
            : prev.tasks,
          priorities: (prev.priorities ?? []).map((dp) =>
            dp.date === todayLocal
              ? {
                  ...dp,
                  updatedAt: now,
                  items: dp.items.map((item) =>
                    item.taskId === taskId
                      ? { ...item, completed: !item.completed, progress: !item.completed ? 100 : item.progress, completedAt: !item.completed ? now : null }
                      : item
                  )
                }
              : dp
          )
        }
      })()
    })
  }, [state.data, dispatch])

  const handleUpdateProgress = useCallback((taskId: string, progress: number): void => {
    const todayLocal = todayStr()
    const now = new Date().toISOString()
    dispatch({
      type: 'SET_DATA',
      payload: (() => {
        const prev = state.data
        const reachesHundred = progress === 100
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId
              ? { ...t, progress, completed: reachesHundred ? true : t.completed, updatedAt: now }
              : t
          ),
          priorities: (prev.priorities ?? []).map((dp) =>
            dp.date === todayLocal
              ? {
                  ...dp,
                  updatedAt: now,
                  items: dp.items.map((item) =>
                    item.taskId === taskId
                      ? { ...item, progress, completed: reachesHundred ? true : item.completed, completedAt: reachesHundred && !item.completedAt ? now : item.completedAt }
                      : item
                  )
                }
              : dp
          )
        }
      })()
    })
  }, [state.data, dispatch])

  // ---- pomodoro ----
  const handleCompleteWorkSession = useCallback((): void => {
    const todayLocal = todayStr()
    dispatch({
      type: 'SET_DATA',
      payload: (() => {
        const prev = state.data
        const cur = prev.pomodoro
        if (!cur || cur.date !== todayLocal) {
          return { ...prev, pomodoro: { date: todayLocal, count: 1 } }
        }
        return { ...prev, pomodoro: { date: todayLocal, count: cur.count + 1 } }
      })()
    })
  }, [state.data, dispatch])

  // ---- export / config ----
  const exportMd = useCallback(async (): Promise<void> => {
    const md = generateMarkdown(state.data.tasks)
    try {
      await window.api.exportMarkdown(md, defaultMdFileName())
    } catch (e) {
      console.error('export failed', e)
    }
  }, [state.data.tasks])

  const installUpdate = useCallback(async (): Promise<void> => {
    try {
      await window.api.saveData(state.data)
    } catch (e) {
      console.error('pre-update save failed', e)
    }
    window.api.installUpdate()
  }, [state.data])

  const fetchHolidays = useCallback(async (year: number): Promise<void> => {
    const result = await window.api.fetchHolidays(year)
    const prev = state.data
    dispatch({
      type: 'SET_DATA',
      payload: { ...prev, holidayOverrides: { ...(prev.holidayOverrides ?? {}), [year]: result } }
    })
  }, [state.data, dispatch])

  const toggleCompanyLastSaturday = useCallback((v: boolean): void => {
    dispatch({ type: 'SET_DATA', payload: { ...state.data, companyLastSaturday: v } })
  }, [state.data, dispatch])

  const saveConfig = useCallback((config: AppConfig): void => {
    dispatch({ type: 'UPDATE_CONFIG', payload: config })
  }, [dispatch])

  return (
    <div className="todo-app">
      {/* Toolbar */}
      <header className="toolbar">
        <div className="toolbar__title">智能化代办</div>
        <div className="toolbar__tabs">
          <button
            className={`toolbar__tab ${todoView === 'board' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setTodoView('board')}
          >
            任务看板
          </button>
          <button
            className={`toolbar__tab ${todoView === 'priority' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setTodoView('priority')}
          >
            今日优先
          </button>
          <button
            className={`toolbar__tab ${todoView === 'calendar' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setTodoView('calendar')}
          >
            日历总览
          </button>
          <button
            className={`toolbar__tab ${todoView === 'pomodoro' ? 'toolbar__tab--active' : ''}`}
            onClick={() => setTodoView('pomodoro')}
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
          <span>待办 <b>{pendingTasks}</b></span>
          <span>已完成 <b>{doneTasks}</b></span>
          <span>共 <b>{totalTasks}</b></span>
        </div>
      </header>

      {/* Main content */}
      <div className="todo-app__content">
        {todoView === 'board' && (
          <QuadrantBoard
            tasks={data.tasks}
            onToggle={toggleTask}
            onEdit={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
            onDelete={deleteTask}
            onAddTask={(q) => setTaskModal({ task: null, quadrant: q })}
          />
        )}

        {todoView === 'priority' && (
          <TodayPriorityView
            tasks={data.tasks}
            todayPriority={todayPriority}
            history={history}
            aiState={aiState}
            incompleteCount={incompleteCount}
            onRegenerate={handleAiRegenerate}
            onCancel={handleAiCancel}
            onTogglePriorityItem={handleTogglePriorityItem}
            onUpdateProgress={handleUpdateProgress}
            onEditTask={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
          />
        )}

        {todoView === 'calendar' && (
          <CalendarView
            tasks={data.tasks}
            onToggle={toggleTask}
            onEdit={(t) => setTaskModal({ task: t, quadrant: t.quadrant })}
            holidayOverrides={data.holidayOverrides}
            companyLastSaturday={data.companyLastSaturday ?? true}
          />
        )}

        {todoView === 'pomodoro' && (
          <PomodoroView
            tasks={data.tasks}
            todayCount={pomodoroTodayCount}
            onCompleteWorkSession={handleCompleteWorkSession}
          />
        )}
      </div>

      {/* Modals */}
      {taskModal && (
        <TaskModal
          task={taskModal.task}
          defaultQuadrant={taskModal.quadrant}
          onSave={handleSaveTask}
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  )
}
