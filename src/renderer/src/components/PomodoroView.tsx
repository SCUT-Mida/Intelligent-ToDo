import { useState, useEffect, useRef, useCallback } from 'react'
import type { Task } from '@shared/types'

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
  const focusTask = tasks.find((t) => t.id === focusTaskId) ?? null

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
          <label className="pomodoro-focus__label">专注任务（可选）</label>
          <select
            className="select pomodoro-focus__select"
            value={focusTaskId}
            onChange={(e) => setFocusTaskId(e.target.value)}
          >
            <option value="">— 不绑定任务 —</option>
            {incompleteTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.content}
              </option>
            ))}
          </select>
          {focusTask && (
            <div className="pomodoro-focus__current">
              正在专注：<b>{focusTask.content}</b>
            </div>
          )}
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
