import { describe, it, expect } from 'vitest'
import { buildHandoffPrompt } from '../../src/shared/agentHub'

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
