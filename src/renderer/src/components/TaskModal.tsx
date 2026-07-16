import { useState, useEffect } from 'react'
import type { Task, Quadrant, TaskRecurrence } from '@shared/types'
import { QUADRANTS } from '@shared/types'
import { formatRecurrence } from '@shared/recurrence'
import ProgressSteps from './ProgressSteps'

type FreqType = 'once' | 'weekly' | 'monthly' | 'yearly'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** Max days in a given month (1-12), non-leap-year for simplicity. */
function maxDaysInMonth(month: number): number {
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31
}

interface TaskModalProps {
  task?: Task | null
  defaultQuadrant?: Quadrant
  onSave: (data: { content: string; quadrant: Quadrant; dueDate: string | null; progress: number; recurrence?: TaskRecurrence }) => void
  onClose: () => void
}

export default function TaskModal({
  task,
  defaultQuadrant = 'q1',
  onSave,
  onClose
}: TaskModalProps): JSX.Element {
  const [content, setContent] = useState(task?.content ?? '')
  const [quadrant, setQuadrant] = useState<Quadrant>(task?.quadrant ?? defaultQuadrant)
  const [dueDate, setDueDate] = useState<string>(task?.dueDate ?? '')
  const [progress, setProgress] = useState<number>(task?.progress ?? 0)

  // Recurrence state
  const existingRec = task?.recurrence
  const [freqType, setFreqType] = useState<FreqType>(existingRec?.type ?? 'once')
  const [weekdays, setWeekdays] = useState<number[]>(existingRec?.weekdays ?? [])
  const [monthDay, setMonthDay] = useState<number>(existingRec?.monthDay ?? 1)
  const [yearMonth, setYearMonth] = useState<number>(existingRec?.yearMonth ?? 1)
  const [yearDay, setYearDay] = useState<number>(existingRec?.yearDay ?? 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isRecurring = freqType !== 'once'

  const buildRecurrence = (): TaskRecurrence | undefined => {
    if (freqType === 'weekly') return weekdays.length ? { type: 'weekly', weekdays: [...weekdays].sort() } : undefined
    if (freqType === 'monthly') return { type: 'monthly', monthDay }
    if (freqType === 'yearly') return { type: 'yearly', yearMonth, yearDay }
    return undefined
  }

  const handleSave = (): void => {
    const trimmed = content.trim()
    if (!trimmed) return
    onSave({
      content: trimmed,
      quadrant,
      dueDate: dueDate || null,
      progress,
      recurrence: buildRecurrence()
    })
  }

  const toggleWeekday = (day: number): void => {
    setWeekdays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day])
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">{task ? '编辑任务' : '新建任务'}</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">
          <div className="field">
            <label className="field__label">任务内容</label>
            <textarea className="textarea" placeholder="请输入任务内容..." value={content}
              onChange={(e) => setContent(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSave() }} />
            <div className="field__hint">Ctrl + Enter 快速保存</div>
          </div>

          <div className="field">
            <label className="field__label">优先级（四象限）</label>
            <div className="quad-picker">
              {QUADRANTS.map((q) => (
                <button key={q.id} type="button"
                  className={`quad-option ${quadrant === q.id ? 'quad-option--active' : ''}`}
                  data-q={q.id} onClick={() => setQuadrant(q.id)}>
                  <span className="quad-option__label">{q.shortLabel}</span>
                  <span className="quad-option__hint">{q.subtitle}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── 任务频次 ── */}
          <div className="field">
            <label className="field__label">任务频次</label>
            <div className="freq-picker">
              {([['once', '单次'], ['weekly', '按周'], ['monthly', '按月'], ['yearly', '按年']] as Array<[FreqType, string]>).map(([val, label]) => (
                <button key={val} type="button"
                  className={`freq-option ${freqType === val ? 'freq-option--active' : ''}`}
                  onClick={() => setFreqType(val)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Weekly: weekday checkboxes */}
            {freqType === 'weekly' && (
              <div className="freq-sub">
                <div className="weekday-picker">
                  {WEEKDAY_LABELS.map((label, day) => (
                    <button key={day} type="button"
                      className={`weekday-btn ${weekdays.includes(day) ? 'weekday-btn--active' : ''}`}
                      onClick={() => toggleWeekday(day)}>
                      {label}
                    </button>
                  ))}
                </div>
                {weekdays.length > 0 && (
                  <div className="field__hint">🔁 {formatRecurrence({ type: 'weekly', weekdays })}，完成时自动推进到下次</div>
                )}
              </div>
            )}

            {/* Monthly: day of month */}
            {freqType === 'monthly' && (
              <div className="freq-sub">
                <div className="field__row">
                  <span className="field__row-text">每月</span>
                  <input className="input" type="number" min={1} max={31} value={monthDay}
                    onChange={(e) => setMonthDay(Math.max(1, Math.min(31, parseInt(e.target.value) || 1)))}
                    style={{ maxWidth: 80 }} />
                  <span className="field__row-text">日</span>
                </div>
                <div className="field__hint">🔁 {formatRecurrence({ type: 'monthly', monthDay })}，完成时自动推进到下次</div>
                {monthDay > 28 && (
                  <div className="field__hint field__hint--error">提示：选 {monthDay} 日时，2 月等不足 {monthDay} 天的月份将自动取当月最后一天</div>
                )}
              </div>
            )}

            {/* Yearly: month + day (day max follows the chosen month) */}
            {freqType === 'yearly' && (
              <div className="freq-sub">
                <div className="field__row">
                  <span className="field__row-text">每年</span>
                  <select className="select" value={yearMonth}
                    onChange={(e) => {
                      const m = parseInt(e.target.value)
                      setYearMonth(m)
                      setYearDay((prev) => Math.min(prev, maxDaysInMonth(m)))
                    }}
                    style={{ maxWidth: 100 }}>
                    {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
                  </select>
                  <input className="input" type="number" min={1} max={maxDaysInMonth(yearMonth)} value={yearDay}
                    onChange={(e) => setYearDay(Math.max(1, Math.min(maxDaysInMonth(yearMonth), parseInt(e.target.value) || 1)))}
                    style={{ maxWidth: 80 }} />
                  <span className="field__row-text">日</span>
                </div>
                <div className="field__hint">🔁 {formatRecurrence({ type: 'yearly', yearMonth, yearDay })}，完成时自动推进到下次</div>
              </div>
            )}
          </div>

          {/* Due date — hidden for recurring tasks (auto-computed) */}
          {!isRecurring && (
            <div className="field">
              <label className="field__label">截止日期</label>
              <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}

          <div className="field">
            <label className="field__label">完成进度</label>
            <ProgressSteps current={progress} completed={progress === 100} onChange={setProgress} />
            <div className="field__hint">点击 0/25/50/75/100 调整进度，100% 自动标记为已完成{isRecurring ? '并推进到下次' : ''}</div>
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!content.trim() || (freqType === 'weekly' && weekdays.length === 0)}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
