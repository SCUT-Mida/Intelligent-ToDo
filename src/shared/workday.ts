// 工作日 / 休息日判定引擎（主进程与渲染进程共享）
//
// 优先级（高 → 低）：
//   1. 调休补班（国务院调休，周末改工作日） → 工作日，标「补班」
//   2. 法定节假日                          → 休息日，标节日名
//   3. 贵司规则：月末最后一个周六（且非法定节假日） → 工作日，标「班」
//   4. 普通周六 / 周日                     → 休息日
//   5. 工作日                             → 工作日
//
// 数据来源：内置 HOLIDAY_DATA（随包发布）+ 运行时 overrides（用户在设置里拉的权威数据）。
// overrides 优先：用户拉取某年后，该年以 overrides 为准（即使与内置冲突）。
// 数据维护：每年 11 月国务院发布次年安排后，用户在「设置 → 节假日数据」拉取即可，无需换版本。

import type { YearHolidayData } from './types'

/** Date → yyyy-mm-dd（本地时区）。 */
export function dateISO(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 展开连续日期区间为 ISO 字符串数组（闭区间）。 */
function expandRange(startISO: string, endISO: string): string[] {
  const out: string[] = []
  const d = new Date(startISO + 'T00:00:00')
  const end = new Date(endISO + 'T00:00:00')
  while (d <= end) {
    out.push(dateISO(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 由区间规格构建年份数据，避免手写每个日期出错。 */
function buildYearData(
  holidayRanges: Array<{ start: string; end: string; name: string }>,
  adjustedDays: string[]
): YearHolidayData {
  const holidays: Record<string, string> = {}
  for (const r of holidayRanges) {
    for (const iso of expandRange(r.start, r.end)) {
      holidays[iso] = r.name
    }
  }
  const adjustedWorkdays: Record<string, true> = {}
  for (const iso of adjustedDays) {
    adjustedWorkdays[iso] = true
  }
  return { holidays, adjustedWorkdays }
}

// 内置官方放假安排（兜底；用户在设置里拉取的 overrides 优先）。
// 年份缺失时引擎自动降级为「仅周末 + 贵司规则」。
const HOLIDAY_DATA: Record<number, YearHolidayData> = {
  2026: buildYearData(
    [
      { start: '2026-01-01', end: '2026-01-03', name: '元旦' },
      { start: '2026-02-15', end: '2026-02-23', name: '春节' },
      { start: '2026-04-04', end: '2026-04-06', name: '清明' },
      { start: '2026-05-01', end: '2026-05-05', name: '劳动节' },
      { start: '2026-06-19', end: '2026-06-21', name: '端午' },
      { start: '2026-09-25', end: '2026-09-27', name: '中秋' },
      { start: '2026-10-01', end: '2026-10-07', name: '国庆' }
    ],
    [
      '2026-01-04', // 元旦调休
      '2026-02-14', '2026-02-28', // 春节调休
      '2026-05-09', // 劳动节调休
      '2026-09-20', '2026-10-10' // 国庆调休
    ]
  )
}

/** 内置了哪些年份（用于设置页展示「内置」标记）。 */
export const BUNDLED_HOLIDAY_YEARS: number[] = Object.keys(HOLIDAY_DATA).map(Number)

export type DayType =
  | 'workday' // 普通工作日
  | 'weekend' // 普通周末
  | 'holiday' // 法定节假日
  | 'adjusted-workday' // 调休补班日（周末改工作日）
  | 'company-workday' // 贵司规则：月末最后一个周六

export interface DayInfo {
  type: DayType
  isWorkday: boolean
  /** 节假日名 / '补班' / '班'，用于显示 */
  label?: string
}

/** 是否月末最后一个周六（贵司规则）。 */
function isLastSaturdayOfMonth(date: Date): boolean {
  if (date.getDay() !== 6) return false // 不是周六
  const next = new Date(date)
  next.setDate(date.getDate() + 7)
  return next.getMonth() !== date.getMonth() // 7 天后跨月 → 这是本月最后一个周六
}

/**
 * 判定某一天的工作日属性。
 * @param overrides 用户在设置里拉取的权威数据；某年存在则以它为准，否则用内置数据。
 */
export function getDayInfo(date: Date, overrides?: Record<number, YearHolidayData>): DayInfo {
  const year = date.getFullYear()
  const iso = dateISO(date)
  const yearData = overrides?.[year] ?? HOLIDAY_DATA[year]
  const dow = date.getDay() // 0=周日, 6=周六

  // 1. 调休补班（最高优先级，显式覆盖为工作日）
  if (yearData?.adjustedWorkdays[iso]) {
    return { type: 'adjusted-workday', isWorkday: true, label: '补班' }
  }
  // 2. 法定节假日
  if (yearData?.holidays[iso]) {
    return { type: 'holiday', isWorkday: false, label: yearData.holidays[iso] }
  }
  // 3. 贵司规则：月末最后一个周六（走到这里说明非法定节假日）
  if (isLastSaturdayOfMonth(date)) {
    return { type: 'company-workday', isWorkday: true, label: '班' }
  }
  // 4. 普通周末
  if (dow === 0 || dow === 6) {
    return { type: 'weekend', isWorkday: false }
  }
  // 5. 普通工作日
  return { type: 'workday', isWorkday: true }
}

/** 把工作日属性转成自然语言描述（供 AI prompt 和界面提示使用）。 */
export function describeDay(info: DayInfo): string {
  switch (info.type) {
    case 'holiday':
      return `法定节假日${info.label ? '（' + info.label + '）' : ''}`
    case 'adjusted-workday':
      return '调休补班日（周末调休为工作日）'
    case 'company-workday':
      return '工作日（贵司月末最后一个周六）'
    case 'weekend':
      return '周末（休息日）'
    case 'workday':
    default:
      return '工作日'
  }
}

/** 中文星期几。 */
export const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/**
 * Count working days strictly AFTER `from` up to and including `to`.
 * Used to tell the AI how many workdays remain until a deadline.
 * Returns 0 if `to` is on/before `from`.
 */
export function remainingWorkdays(from: Date, to: Date, overrides?: Record<number, YearHolidayData>): number {
  if (to.getTime() <= from.getTime()) return 0
  let count = 0
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  d.setDate(d.getDate() + 1) // start from the day after `from`
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (d.getTime() <= end.getTime()) {
    if (getDayInfo(d, overrides).isWorkday) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}
