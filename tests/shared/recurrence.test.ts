import { describe, it, expect } from 'vitest'
import { computeNextOccurrence, formatRecurrence } from '../../src/shared/recurrence'

describe('formatRecurrence', () => {
  it('formats weekly patterns sorted with Chinese day names', () => {
    expect(formatRecurrence({ type: 'weekly', weekdays: [3, 1, 5] })).toBe('每周一、周三、周五')
  })

  it('formats weekly without days as 每周循环', () => {
    expect(formatRecurrence({ type: 'weekly' })).toBe('每周循环')
    expect(formatRecurrence({ type: 'weekly', weekdays: [] })).toBe('每周循环')
  })

  it('formats monthly and yearly', () => {
    expect(formatRecurrence({ type: 'monthly', monthDay: 15 })).toBe('每月15日')
    expect(formatRecurrence({ type: 'yearly', yearMonth: 10, yearDay: 1 })).toBe('每年10月1日')
  })

  it('falls back for unknown types and missing fields', () => {
    expect(formatRecurrence({ type: 'monthly' })).toBe('每月1日')
    expect(formatRecurrence({ type: 'yearly', yearMonth: 2 })).toBe('每年2月1日')
  })
})

describe('computeNextOccurrence', () => {
  // 2026-03-06 is a Friday.
  const from = new Date(2026, 2, 6)

  it('finds the next weekday strictly after `from`', () => {
    // From Friday 2026-03-06, next Monday is 2026-03-09.
    expect(computeNextOccurrence({ type: 'weekly', weekdays: [1] }, from)).toBe('2026-03-09')
    // Same weekday → next week, not today.
    expect(computeNextOccurrence({ type: 'weekly', weekdays: [5] }, from)).toBe('2026-03-13')
  })

  it('handles multiple weekdays picking the nearest', () => {
    // From Friday: Sat(7)/Sun(0) this weekend come before Tue(2).
    expect(computeNextOccurrence({ type: 'weekly', weekdays: [0, 2] }, from)).toBe('2026-03-08')
  })

  it('rolls into the next month for monthly patterns', () => {
    // From 2026-03-06, day 10 → 2026-03-10; day 1 → 2026-04-01.
    expect(computeNextOccurrence({ type: 'monthly', monthDay: 10 }, from)).toBe('2026-03-10')
    expect(computeNextOccurrence({ type: 'monthly', monthDay: 1 }, from)).toBe('2026-04-01')
  })

  it('clamps monthDay in short months (Jan 31 → Feb 28)', () => {
    const jan = new Date(2026, 0, 31)
    expect(computeNextOccurrence({ type: 'monthly', monthDay: 31 }, jan)).toBe('2026-02-28')
  })

  it('moves yearly dates to next year when already passed', () => {
    expect(computeNextOccurrence({ type: 'yearly', yearMonth: 1, yearDay: 1 }, from)).toBe('2027-01-01')
    expect(computeNextOccurrence({ type: 'yearly', yearMonth: 4, yearDay: 1 }, from)).toBe('2026-04-01')
  })

  it('falls back to +7 days for incomplete patterns', () => {
    expect(computeNextOccurrence({ type: 'weekly' }, from)).toBe('2026-03-13')
  })
})
