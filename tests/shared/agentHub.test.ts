import { describe, it, expect } from 'vitest'
import {
  buildHandoffPrompt,
  sortHistoryEntries,
  pruneHistoryEntries,
  HISTORY_PRUNE_LIMIT,
  isScheduleDue
} from '../../src/shared/agentHub'
import type { SessionHistoryEntry, ScheduledTask } from '../../src/shared/agentHub'

describe('pruneHistoryEntries (safety valve, v1.26.3)', () => {
  const mk = (i: number, pinned = false): SessionHistoryEntry => ({
    id: `e${i}`,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    content: `c${i}`,
    source: 'markdown',
    pinned
  })

  it('keeps everything when under the threshold', () => {
    const entries = Array.from({ length: 50 }, (_, i) => mk(i))
    expect(pruneHistoryEntries(entries)).toHaveLength(50)
  })

  it('keeps pinned entries regardless of age, trims old non-pinned', () => {
    // 2 pinned old ones + 5050 non-pinned → pinned kept + newest 5000.
    const entries = [mk(9000, true), mk(9001, true)]
    for (let i = 0; i < HISTORY_PRUNE_LIMIT + 50; i++) entries.push(mk(i))
    const out = pruneHistoryEntries(entries)
    expect(out).toHaveLength(HISTORY_PRUNE_LIMIT + 2)
    expect(out.filter((e) => e.pinned).map((e) => e.id)).toEqual(['e9000', 'e9001'])
    // oldest surviving non-pinned is index 50
    const nonPinned = out.filter((e) => !e.pinned)
    expect(nonPinned[0].id).toBe('e50')
    expect(nonPinned[nonPinned.length - 1].id).toBe(`e${HISTORY_PRUNE_LIMIT + 49}`)
  })

  it('handles the pathological case where pinned alone exceed nothing (all pinned kept)', () => {
    const entries = Array.from({ length: HISTORY_PRUNE_LIMIT + 10 }, (_, i) => mk(i, true))
    expect(pruneHistoryEntries(entries)).toHaveLength(entries.length)
  })
})

describe('isScheduleDue (scheduled tasks, v1.28)', () => {
  const task = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
    id: 's1',
    name: 'n',
    agentId: 'a',
    workDir: 'D:/x',
    prompt: 'p',
    hour: 9,
    minute: 30,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  })

  it('is due when the scheduled time has passed and it has not run today', () => {
    const now = new Date(2026, 2, 10, 10, 0) // 10:00, scheduled 09:30
    expect(isScheduleDue(task(), now)).toBe(true)
  })

  it('is due exactly at the scheduled minute', () => {
    expect(isScheduleDue(task(), new Date(2026, 2, 10, 9, 30))).toBe(true)
  })

  it('is not due before the scheduled time', () => {
    expect(isScheduleDue(task(), new Date(2026, 2, 10, 9, 29))).toBe(false)
  })

  it('is not due when it already ran today (any earlier time)', () => {
    const ran = task({ lastRunAt: new Date(2026, 2, 10, 9, 31).toISOString() })
    expect(isScheduleDue(ran, new Date(2026, 2, 10, 10, 0))).toBe(false)
  })

  it('is due again the next day', () => {
    const ran = task({ lastRunAt: new Date(2026, 2, 10, 9, 31).toISOString() })
    expect(isScheduleDue(ran, new Date(2026, 2, 11, 9, 30))).toBe(true)
  })

  it('is not due when disabled or the time is invalid', () => {
    expect(isScheduleDue(task({ enabled: false }), new Date(2026, 2, 10, 10, 0))).toBe(false)
    expect(isScheduleDue(task({ hour: 25 }), new Date(2026, 2, 10, 10, 0))).toBe(false)
    expect(isScheduleDue(task({ minute: 60 }), new Date(2026, 2, 10, 10, 0))).toBe(false)
  })
})

describe('sortHistoryEntries (history pin, v1.26)', () => {
  const e = (id: string, at: string, pinned = false): SessionHistoryEntry => ({
    id,
    at,
    content: `c-${id}`,
    source: 'markdown',
    pinned
  })

  it('renders newest-first when nothing is pinned', () => {
    const out = sortHistoryEntries([e('a', '2026-01-01T00:00:00Z'), e('b', '2026-02-01T00:00:00Z')])
    expect(out.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('floats pinned entries above everything, newest pinned first', () => {
    const out = sortHistoryEntries([
      e('new', '2026-03-01T00:00:00Z'),
      e('pin-old', '2026-01-01T00:00:00Z', true),
      e('mid', '2026-02-01T00:00:00Z'),
      e('pin-new', '2026-02-15T00:00:00Z', true)
    ])
    expect(out.map((x) => x.id)).toEqual(['pin-new', 'pin-old', 'new', 'mid'])
  })

  it('does not mutate the input array', () => {
    const input = [e('a', '2026-01-01T00:00:00Z'), e('b', '2026-02-01T00:00:00Z', true)]
    const snapshot = [...input]
    sortHistoryEntries(input)
    expect(input).toEqual(snapshot)
  })

  it('handles an empty list', () => {
    expect(sortHistoryEntries([])).toEqual([])
  })
})

describe('buildHandoffPrompt (Todo → Agent hand-off, v1.24)', () => {
  it('builds a prompt with title, notes and a summary request', () => {
    const p = buildHandoffPrompt({ title: '修复登录页崩溃', notes: '复现：点击记住我' })
    expect(p).toContain('请完成以下任务：')
    expect(p).toContain('修复登录页崩溃')
    expect(p).toContain('任务备注：')
    expect(p).toContain('复现：点击记住我')
    expect(p).toContain('简明总结')
  })

  it('omits the notes block when there are no notes', () => {
    const p = buildHandoffPrompt({ title: '写周报' })
    expect(p).toContain('写周报')
    expect(p).not.toContain('任务备注')
  })

  it('is deterministic for the same input', () => {
    const a = buildHandoffPrompt({ title: 'x', notes: 'y' })
    const b = buildHandoffPrompt({ title: 'x', notes: 'y' })
    expect(a).toBe(b)
  })
})
