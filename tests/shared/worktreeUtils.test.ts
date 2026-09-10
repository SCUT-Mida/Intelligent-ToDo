import { describe, it, expect } from 'vitest'
import {
  slugifyBranchSuffix,
  worktreeDirName,
  worktreeBranchName
} from '../../src/shared/worktreeUtils'

describe('slugifyBranchSuffix', () => {
  it('lowercases and dashes ASCII titles', () => {
    expect(slugifyBranchSuffix('Fix Login Page!')).toBe('fix-login-page')
  })

  it('collapses runs of separators', () => {
    expect(slugifyBranchSuffix('a  --  b___c')).toBe('a-b-c')
  })

  it('returns empty for Chinese-only titles (caller falls back to timestamp)', () => {
    expect(slugifyBranchSuffix('修复登录页崩溃')).toBe('')
  })

  it('mixed content keeps the ASCII tail', () => {
    expect(slugifyBranchSuffix('修复 login 页面')).toBe('login')
  })

  it('caps length and trims trailing dashes', () => {
    expect(slugifyBranchSuffix('aaaa bbbb cccc dddd eeee ffff', 24)).toBe(
      'aaaa-bbbb-cccc-dddd-eeee'
    )
  })

  it('handles empty input', () => {
    expect(slugifyBranchSuffix('')).toBe('')
  })
})

describe('worktreeDirName / worktreeBranchName', () => {
  it('composes sibling dir names', () => {
    expect(worktreeDirName('order-entry', 'fix-login')).toBe('order-entry-fix-login')
  })

  it('falls back to -task when the slug is empty', () => {
    expect(worktreeDirName('order-entry', '')).toBe('order-entry-task')
  })

  it('branch names are namespaced under task/', () => {
    expect(worktreeBranchName('fix-login')).toBe('task/fix-login')
    expect(worktreeBranchName('')).toBe('task/task')
  })
})
