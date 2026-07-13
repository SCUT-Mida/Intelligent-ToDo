import { useState, useMemo } from 'react'
import type { Task, Quadrant, YearHolidayData } from '@shared/types'
import { QUADRANTS } from '@shared/types'
import { getDayInfo } from '@shared/workday'

interface CalendarViewProps {
  tasks: Task[]
  onToggle: (id: string) => void
  onEdit: (task: Task) => void
  /** User-fetched holiday overrides (take precedence over bundled data). */
  holidayOverrides?: Record<number, YearHolidayData>
  /** Company rule: last Saturday of month is a workday. */
  companyLastSaturday?: boolean
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** Local today string yyyy-mm-dd */
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Build a 6x7 grid of date cells for a given month (leading/trailing days from adjacent months). */
function buildMonthGrid(year: number, month: number): Array<{ dateStr: string; day: number; inMonth: boolean } | null> {
  const first = new Date(year, month, 1)
  const startWeekday = first.getDay() // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<{ dateStr: string; day: number; inMonth: boolean } | null> = []
  // leading blanks (previous month tail) — keep grid aligned, render as empty
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  const p = (n: number): string => String(n).padStart(2, '0')
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: `${year}-${p(month + 1)}-${p(d)}`, day: d, inMonth: true })
  }
  // trailing fill to complete the last week
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export default function CalendarView({ tasks, onToggle, onEdit, holidayOverrides, companyLastSaturday = true }: CalendarViewProps): JSX.Element {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth()) // 0-11
  const [selectedDate, setSelectedDate] = useState<string>(todayStr())

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth])

  // tasks grouped by due date for quick lookup
  const tasksByDate = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.dueDate) continue
      const arr = m.get(t.dueDate) ?? []
      arr.push(t)
      m.set(t.dueDate, arr)
    }
    return m
  }, [tasks])

  // statistics
  const stats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.completed).length
    const incomplete = total - done
    const rate = total === 0 ? 0 : Math.round((done / total) * 100)
    const overdue = tasks.filter((t) => !t.completed && t.dueDate && t.dueDate < todayStr()).length
    const byQuadrant = QUADRANTS.map((q) => ({
      meta: q,
      total: tasks.filter((t) => t.quadrant === q.id).length,
      done: tasks.filter((t) => t.quadrant === q.id && t.completed).length
    }))
    const maxQuad = Math.max(1, ...byQuadrant.map((q) => q.total))
    // Workdays in the currently-viewed month (for planning). Accounts for
    // holidays + 调休补班 + the company last-Saturday rule.
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    let monthWorkdays = 0
    for (let d = 1; d <= daysInMonth; d++) {
      if (getDayInfo(new Date(viewYear, viewMonth, d), holidayOverrides, { companyLastSaturday }).isWorkday) monthWorkdays++
    }
    return { total, done, incomplete, rate, overdue, byQuadrant, maxQuad, monthWorkdays }
  }, [tasks, viewYear, viewMonth, holidayOverrides, companyLastSaturday])

  const todayTasks = tasksByDate.get(todayStr()) ?? []
  const selectedTasks = tasksByDate.get(selectedDate) ?? []

  const goPrevMonth = (): void => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }
  const goNextMonth = (): void => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  return (
    <div className="calendar-view">
      {/* LEFT: month calendar + selected day tasks */}
      <div className="calendar-view__left">
        <div className="calendar-header">
          <button className="calendar-nav" onClick={goPrevMonth} aria-label="上个月">
            ‹
          </button>
          <div className="calendar-title">
            {viewYear} 年 {viewMonth + 1} 月
          </div>
          <button className="calendar-nav" onClick={goNextMonth} aria-label="下个月">
            ›
          </button>
          <button
            className="btn btn--ghost calendar-today"
            onClick={() => {
              setViewYear(now.getFullYear())
              setViewMonth(now.getMonth())
              setSelectedDate(todayStr())
            }}
          >
            今天
          </button>
        </div>

        <div className="calendar-grid">
          {WEEKDAYS.map((w) => (
            <div key={w} className="calendar-grid__weekday">
              {w}
            </div>
          ))}
          {grid.map((cell, i) => {
            if (!cell) return <div key={`blank-${i}`} className="calendar-grid__cell calendar-grid__cell--blank" />
            const cellTasks = tasksByDate.get(cell.dateStr) ?? []
            const visible = cellTasks.slice(0, 2)
            const overflow = cellTasks.length - visible.length
            const isToday = cell.dateStr === todayStr()
            const isSelected = cell.dateStr === selectedDate
            // Workday / holiday info for this cell
            const [yy, mm, dd] = cell.dateStr.split('-').map(Number)
            const info = getDayInfo(new Date(yy, mm - 1, dd), holidayOverrides, { companyLastSaturday })
            const showBadge = info.type === 'adjusted-workday' || info.type === 'company-workday'
            return (
              <button
                key={cell.dateStr}
                className={`calendar-grid__cell calendar-grid__cell--${info.type} ${isToday ? 'calendar-grid__cell--today' : ''} ${isSelected ? 'calendar-grid__cell--selected' : ''} ${cellTasks.length > 0 ? 'calendar-grid__cell--has' : ''}`}
                onClick={() => setSelectedDate(cell.dateStr)}
              >
                <span className="calendar-grid__day">
                  {cell.day}
                  {showBadge && <span className="calendar-grid__daybadge">{info.label}</span>}
                  {cellTasks.length > 0 && (
                    <span className="calendar-grid__daycount">{cellTasks.length}</span>
                  )}
                </span>
                <div className="calendar-grid__chips">
                  {info.type === 'holiday' && (
                    <span className="cal-chip cal-chip--rest" title={`${info.label}（法定节假日）`}>
                      {info.label}
                    </span>
                  )}
                  {info.type === 'weekend' && (
                    <span className="cal-chip cal-chip--rest" title="周末休息日">
                      休息日
                    </span>
                  )}
                  {visible.map((t) => (
                    <span
                      key={t.id}
                      className={`cal-chip cal-chip--${t.quadrant} ${t.completed ? 'cal-chip--done' : ''}`}
                      title={t.content}
                    >
                      {t.content}
                    </span>
                  ))}
                  {overflow > 0 && <span className="cal-chip cal-chip--more">+{overflow}</span>}
                </div>
              </button>
            )
          })}
        </div>

        <div className="calendar-daytasks">
          <div className="calendar-daytasks__head">
            <span className="calendar-daytasks__date">
              📅 {selectedDate === todayStr() ? '今天' : selectedDate}
            </span>
            <span className="calendar-daytasks__count">{selectedTasks.length} 个任务</span>
          </div>
          <div className="calendar-daytasks__list">
            {selectedTasks.length === 0 ? (
              <div className="calendar-daytasks__empty">这一天没有截止任务</div>
            ) : (
              selectedTasks.map((t) => (
                <div key={t.id} className={`daytask ${t.completed ? 'daytask--done' : ''}`}>
                  <input
                    type="checkbox"
                    className="daytask__check"
                    checked={t.completed}
                    onChange={() => onToggle(t.id)}
                  />
                  <span
                    className={`daytask__quad daytask__quad--${t.quadrant}`}
                    title={QUADRANTS.find((q) => q.id === t.quadrant)?.title}
                  />
                  <span className="daytask__content">{t.content}</span>
                  <button className="daytask__edit" title="编辑" onClick={() => onEdit(t)}>
                    ✎
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* RIGHT: statistics dashboard */}
      <aside className="calendar-view__right">
        <div className="stats-panel">
          <div className="stats-panel__title">数据总览</div>

          <div className="stats-cards">
            <div className="stats-card">
              <div className="stats-card__value">{stats.total}</div>
              <div className="stats-card__label">总任务</div>
            </div>
            <div className="stats-card stats-card--done">
              <div className="stats-card__value">{stats.done}</div>
              <div className="stats-card__label">已完成</div>
            </div>
            <div className="stats-card stats-card--pending">
              <div className="stats-card__value">{stats.incomplete}</div>
              <div className="stats-card__label">待办</div>
            </div>
            <div className="stats-card stats-card--overdue">
              <div className="stats-card__value">{stats.overdue}</div>
              <div className="stats-card__label">逾期</div>
            </div>
          </div>

          <div className="stats-block">
            <div className="stats-block__head">
              <span>完成率</span>
              <span className="stats-block__pct">{stats.rate}%</span>
            </div>
            <div className="stats-bar">
              <div className="stats-bar__fill" style={{ width: `${stats.rate}%` }} />
            </div>
          </div>

          <div className="stats-block">
            <div className="stats-block__head">四象限分布</div>
            <div className="stats-quad">
              {stats.byQuadrant.map((q) => (
                <div key={q.meta.id} className="stats-quad__row">
                  <span className={`stats-quad__label stats-quad__label--${q.meta.id as Quadrant}`}>
                    {q.meta.shortLabel}
                  </span>
                  <div className="stats-quad__track">
                    <div
                      className={`stats-quad__bar stats-quad__bar--${q.meta.id as Quadrant}`}
                      style={{ width: `${(q.total / stats.maxQuad) * 100}%` }}
                    />
                  </div>
                  <span className="stats-quad__count">
                    {q.done}/{q.total}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="stats-block">
            <div className="stats-block__head">
              <span>本月工作日</span>
              <span className="stats-block__pct">{stats.monthWorkdays} 天</span>
            </div>
            <div className="field__hint" style={{ marginTop: 2 }}>
              已扣除周末与法定节假日，含调休补班与月末最后一个周六（贵司规则）
            </div>
          </div>

          <div className="stats-block">
            <div className="stats-block__head">今日聚焦</div>
            <div className="stats-focus">
              {todayTasks.length === 0 ? (
                <div className="stats-focus__empty">今天没有截止任务，节奏自由 🎯</div>
              ) : (
                todayTasks.map((t) => (
                  <div key={t.id} className={`stats-focus__item ${t.completed ? 'stats-focus__item--done' : ''}`}>
                    <span className={`stats-focus__dot stats-focus__dot--${t.quadrant}`} />
                    <span className="stats-focus__text">{t.content}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
