import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { Task, Quadrant } from '@shared/types'
import { getQuadrantMeta } from '@shared/types'

interface PomodoroViewProps {
  tasks: Task[]
  /** Today's completed pomodoro count */
  todayCount: number
  /** Called when a work session completes (caller persists + may roll over the day) */
  onCompleteWorkSession: () => void
}

type Mode = 'work' | 'break'

const WORK_SECONDS = 25 * 60
const BREAK_SECONDS = 5 * 60

/** Format seconds as MM:SS */
function fmt(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Compact due-date label + urgency state for the task picker. */
function formatDue(due: string | null): { text: string; state: 'overdue' | 'today' | 'future' } | null {
  if (!due) return null
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const t = new Date()
  t.setDate(t.getDate() + 1)
  const tomorrow = `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
  if (due < today) return { text: '已逾期', state: 'overdue' }
  if (due === today) return { text: '今天', state: 'today' }
  if (due === tomorrow) return { text: '明天', state: 'future' }
  return { text: due.slice(5), state: 'future' } // mm-dd
}

/** Play a short triple-beep using the Web Audio API (no asset needed). */
function playBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const playTone = (start: number): void => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + start)
      osc.stop(ctx.currentTime + start + 0.3)
    }
    playTone(0)
    playTone(0.35)
    playTone(0.7)
    setTimeout(() => ctx.close(), 1500)
  } catch {
    // AudioContext unavailable (rare in Electron) — silent fallback
  }
}

export default function PomodoroView({
  tasks,
  todayCount,
  onCompleteWorkSession
}: PomodoroViewProps): JSX.Element {
  const [mode, setMode] = useState<Mode>('work')
  const [secondsLeft, setSecondsLeft] = useState(WORK_SECONDS)
  const [running, setRunning] = useState(false)
  const [focusTaskId, setFocusTaskId] = useState<string>('')
  const intervalRef = useRef<number | null>(null)

  const incompleteTasks = tasks.filter((t) => !t.completed)
  // Sort picker by quadrant priority (q1→q4) then due date asc — most urgent first.
  const sortedTasks = useMemo(() => {
    const order: Record<Quadrant, number> = { q1: 0, q2: 1, q3: 2, q4: 3 }
    return [...incompleteTasks].sort((a, b) => {
      if (a.quadrant !== b.quadrant) return order[a.quadrant] - order[b.quadrant]
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return a.dueDate.localeCompare(b.dueDate)
    })
  }, [tasks])

  // Tick down every second while running
  useEffect(() => {
    if (!running) {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [running])

  // Handle reaching zero
  const handleComplete = useCallback(() => {
    playBeep()
    if (mode === 'work') {
      onCompleteWorkSession()
      // roll into break
      setMode('break')
      setSecondsLeft(BREAK_SECONDS)
    } else {
      setMode('work')
      setSecondsLeft(WORK_SECONDS)
    }
    setRunning(false)
  }, [mode, onCompleteWorkSession])

  useEffect(() => {
    if (secondsLeft === 0 && running) {
      handleComplete()
    }
  }, [secondsLeft, running, handleComplete])

  const handleStartPause = (): void => setRunning((r) => !r)

  const handleReset = (): void => {
    setRunning(false)
    setSecondsLeft(mode === 'work' ? WORK_SECONDS : BREAK_SECONDS)
  }

  const handleSkip = (): void => {
    setRunning(false)
    if (mode === 'work') {
      // skipping work doesn't count as a completed session
      setMode('break')
      setSecondsLeft(BREAK_SECONDS)
    } else {
      setMode('work')
      setSecondsLeft(WORK_SECONDS)
    }
  }

  const switchMode = (next: Mode): void => {
    setRunning(false)
    setMode(next)
    setSecondsLeft(next === 'work' ? WORK_SECONDS : BREAK_SECONDS)
  }

  // progress for the ring (0..1)
  const total = mode === 'work' ? WORK_SECONDS : BREAK_SECONDS
  const progress = 1 - secondsLeft / total
  const R = 130
  const CIRC = 2 * Math.PI * R
  const dashoffset = CIRC * (1 - progress)

  return (
    <div className="pomodoro-view">
      <div className="pomodoro-card">
        <div className="pomodoro-mode">
          <button
            className={`pomodoro-mode__tab ${mode === 'work' ? 'pomodoro-mode__tab--active' : ''}`}
            onClick={() => switchMode('work')}
          >
            专注 25:00
          </button>
          <button
            className={`pomodoro-mode__tab ${mode === 'break' ? 'pomodoro-mode__tab--active' : ''}`}
            onClick={() => switchMode('break')}
          >
            休息 5:00
          </button>
        </div>

        <div className={`pomodoro-ring pomodoro-ring--${mode}`}>
          <svg width="300" height="300" viewBox="0 0 300 300">
            <circle cx="150" cy="150" r={R} className="pomodoro-ring__track" />
            <circle
              cx="150"
              cy="150"
              r={R}
              className="pomodoro-ring__progress"
              strokeDasharray={CIRC}
              strokeDashoffset={dashoffset}
              transform="rotate(-90 150 150)"
            />
          </svg>
          <div className="pomodoro-ring__center">
            <div className="pomodoro-ring__time">{fmt(secondsLeft)}</div>
            <div className="pomodoro-ring__label">
              {mode === 'work' ? '专注中' : '休息中'}
            </div>
          </div>
        </div>

        <div className="pomodoro-controls">
          <button
            className={`btn ${running ? 'btn--ghost' : 'btn--primary'} pomodoro-controls__main`}
            onClick={handleStartPause}
          >
            {running ? '暂停' : secondsLeft === total && mode === 'work' ? '开始专注' : '继续'}
          </button>
          <button className="btn btn--ghost" onClick={handleReset} title="重置当前计时">
            重置
          </button>
          <button className="btn btn--ghost" onClick={handleSkip} title="跳到下一阶段">
            跳过
          </button>
        </div>

        <div className="pomodoro-focus">
          <label className="pomodoro-focus__label">专注任务（可选，按优先级排序）</label>
          <div className="pomo-picker">
            <button
              type="button"
              className={`pomo-task ${focusTaskId === '' ? 'pomo-task--active' : ''}`}
              onClick={() => setFocusTaskId('')}
            >
              <span className="pomo-task__content pomo-task__content--muted">不绑定任务，纯计时</span>
            </button>
            {sortedTasks.length === 0 ? (
              <div className="pomo-task__empty">暂无待办任务，去「任务看板」添加吧</div>
            ) : (
              sortedTasks.map((t) => {
                const due = formatDue(t.dueDate)
                const meta = getQuadrantMeta(t.quadrant)
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`pomo-task ${focusTaskId === t.id ? 'pomo-task--active' : ''}`}
                    onClick={() => setFocusTaskId(t.id)}
                    title={meta.title}
                  >
                    <span className={`pomo-task__dot pomo-task__dot--${t.quadrant}`} />
                    <span className={`pomo-task__tag pomo-task__tag--${t.quadrant}`}>{meta.shortLabel}</span>
                    <span className="pomo-task__content">{t.content}</span>
                    {due && (
                      <span className={`pomo-task__due pomo-task__due--${due.state}`}>{due.text}</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="pomodoro-stats">
          <span className="pomodoro-stats__label">今日番茄</span>
          <span className="pomodoro-stats__tomatoes">
            {todayCount > 0 ? '🍅'.repeat(Math.min(todayCount, 12)) : '还没有，开始第一个吧'}
            {todayCount > 12 && <span className="pomodoro-stats__more"> +{todayCount - 12}</span>}
          </span>
          <span className="pomodoro-stats__count">{todayCount}</span>
        </div>

        <div className="pomodoro-hint">
          25 分钟全神贯注 → 5 分钟休息放松。每完成一个专注，今日番茄数 +1。
        </div>
      </div>
    </div>
  )
}
