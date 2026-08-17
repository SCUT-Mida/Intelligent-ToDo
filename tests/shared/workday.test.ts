import { describe, it, expect } from 'vitest'
import { getDayInfo, remainingWorkdays, describeDay } from '../../src/shared/workday'

// Fixture dates against the bundled 2026 dataset:
//   2026-01-01..03  元旦 (holiday)
//   2026-01-04      元旦调休 (adjusted workday, Sunday)
//   2026-02-15..23  春节
//   2026-02-14/28   春节调休

const d = (iso: string): Date => {
  const [y, m, day] = iso.split('-').map(Number)
  return new Date(y, m - 1, day)
}

describe('getDayInfo (bundled 2026 data)', () => {
  it('marks legal holidays as non-workdays with their name', () => {
    const info = getDayInfo(d('2026-01-01'))
    expect(info.type).toBe('holiday')
    expect(info.isWorkday).toBe(false)
    expect(info.label).toBe('元旦')
  })

  it('marks adjusted workdays (调休补班) as workdays even on weekends', () => {
    const info = getDayInfo(d('2026-01-04')) // Sunday, 元旦调休
    expect(info.type).toBe('adjusted-workday')
    expect(info.isWorkday).toBe(true)
  })

  it('treats spring-festival makeup days as workdays', () => {
    expect(getDayInfo(d('2026-02-14')).type).toBe('adjusted-workday') // Saturday makeup
    expect(getDayInfo(d('2026-02-16')).type).toBe('holiday') // 春节 holiday proper
  })

  it('classifies plain weekdays and weekends', () => {
    expect(getDayInfo(d('2026-03-02')).type).toBe('workday') // Monday
    expect(getDayInfo(d('2026-03-07')).type).toBe('weekend') // Saturday
    expect(getDayInfo(d('2026-03-08')).type).toBe('weekend') // Sunday
  })

  it('treats the LAST Saturday of a month as a company workday by default', () => {
    // 2026-01-31 is the last Saturday of January.
    const info = getDayInfo(d('2026-01-31'))
    expect(info.type).toBe('company-workday')
    expect(info.isWorkday).toBe(true)
  })

  it('honors companyLastSaturday=false to disable the company rule', () => {
    const info = getDayInfo(d('2026-01-31'), undefined, { companyLastSaturday: false })
    expect(info.type).toBe('weekend')
    expect(info.isWorkday).toBe(false)
  })

  it('user overrides replace bundled data for that year', () => {
    const overrides = {
      2026: {
        holidays: { '2026-03-02': '测试假' },
        adjustedWorkdays: { '2026-03-03': true as const }
      }
    }
    expect(getDayInfo(d('2026-03-02'), overrides).label).toBe('测试假')
    expect(getDayInfo(d('2026-03-03'), overrides).type).toBe('adjusted-workday')
  })

  it('years without data fall back to weekend-only logic', () => {
    expect(getDayInfo(d('2030-03-04')).type).toBe('workday') // Monday
    expect(getDayInfo(d('2030-03-09')).type).toBe('weekend') // Saturday
  })
})

describe('describeDay', () => {
  it('renders Chinese descriptions', () => {
    expect(describeDay(getDayInfo(d('2026-01-01')))).toContain('法定节假日')
    expect(describeDay(getDayInfo(d('2026-01-04')))).toContain('调休补班日')
    expect(describeDay(getDayInfo(d('2026-03-02')))).toBe('工作日')
  })
})

describe('remainingWorkdays', () => {
  it('counts workdays strictly after `from` through `to`', () => {
    // Mon 2026-03-02 → Fri 2026-03-06: Mar 3..6 = 4 workdays (from exclusive).
    expect(remainingWorkdays(d('2026-03-02'), d('2026-03-06'))).toBe(4)
  })

  it('excludes weekend days and holidays, includes 调休补班', () => {
    // 2026-01-01..03 are 元旦 holidays; 2026-01-04 (Sun) is the makeup workday.
    // After Jan 1 through Jan 8: Jan 2,3 (holidays) skipped; Jan 4(补班),
    // 5, 6, 7, 8 = 5 workdays.
    expect(remainingWorkdays(d('2026-01-01'), d('2026-01-08'))).toBe(5)
  })

  it('returns 0 when `to` is on/before `from`', () => {
    expect(remainingWorkdays(d('2026-03-06'), d('2026-03-06'))).toBe(0)
    expect(remainingWorkdays(d('2026-03-06'), d('2026-03-01'))).toBe(0)
  })

  it('company last-Saturday rule adds a workday', () => {
    // 2026-01-31 is the last Saturday of January (company workday when on).
    const on = remainingWorkdays(d('2026-01-29'), d('2026-01-31'), undefined, { companyLastSaturday: true })
    const off = remainingWorkdays(d('2026-01-29'), d('2026-01-31'), undefined, { companyLastSaturday: false })
    expect(on).toBe(2) // Jan 30 (Fri) + Jan 31 (company Saturday)
    expect(off).toBe(1) // Jan 30 only
  })
})
