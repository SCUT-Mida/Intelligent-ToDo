import { describe, it, expect } from 'vitest'
import { buildHandoffPrompt, sortHistoryEntries } from '../../src/shared/agentHub'
import type { SessionHistoryEntry } from '../../src/shared/agentHub'

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
