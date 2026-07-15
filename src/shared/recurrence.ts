import type { TaskRecurrence } from './types'

const PAD = (n: number): string => String(n).padStart(2, '0')
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六']

/** Format a recurrence pattern into a human-readable label, e.g. "每周一、三、五". */
export function formatRecurrence(rec: TaskRecurrence): string {
  switch (rec.type) {
    case 'weekly':
      if (!rec.weekdays?.length) return '每周循环'
      const days = [...rec.weekdays].sort((a, b) => a - b).map((d) => '周' + WEEKDAY_NAMES[d])
      return `每${days.join('、')}`
    case 'monthly':
      return `每月${rec.monthDay ?? 1}日`
    case 'yearly':
      return `每年${rec.yearMonth ?? 1}月${rec.yearDay ?? 1}日`
    default:
      return '循环任务'
  }
}

/**
 * Compute the next occurrence date (yyyy-mm-dd) for a recurring task,
 * searching strictly AFTER `from` (defaults to now).
 */
export function computeNextOccurrence(rec: TaskRecurrence, from: Date = new Date()): string {
  // ── Weekly ──
  if (rec.type === 'weekly' && rec.weekdays?.length) {
    const sorted = [...rec.weekdays].sort((a, b) => a - b)
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
    d.setDate(d.getDate() + 1) // start searching from tomorrow
    for (let i = 0; i < 14; i++) {
      if (sorted.includes(d.getDay())) {
        return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`
      }
      d.setDate(d.getDate() + 1)
    }
  }

  // ── Monthly ──
  if (rec.type === 'monthly' && rec.monthDay) {
    const target = rec.monthDay
    // Try next month first, then the month after (handles months with fewer days)
    for (let offset = 1; offset <= 2; offset++) {
      const m = new Date(from.getFullYear(), from.getMonth() + offset, 1)
      const daysInMonth = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()
      const day = Math.min(target, daysInMonth)
      const candidate = new Date(m.getFullYear(), m.getMonth(), day)
      if (candidate > from) {
        return `${candidate.getFullYear()}-${PAD(candidate.getMonth() + 1)}-${PAD(candidate.getDate())}`
      }
    }
  }

  // ── Yearly ──
  if (rec.type === 'yearly' && rec.yearMonth && rec.yearDay) {
    let year = from.getFullYear()
    const thisYear = new Date(year, rec.yearMonth - 1, rec.yearDay)
    if (thisYear <= from) year++
    return `${year}-${PAD(rec.yearMonth)}-${PAD(rec.yearDay)}`
  }

  // Fallback: 7 days from now
  const fallback = new Date(from.getTime() + 7 * 86400000)
  return `${fallback.getFullYear()}-${PAD(fallback.getMonth() + 1)}-${PAD(fallback.getDate())}`
}
