import { describe, it, expect } from 'vitest'
import {
  parseRegQueryPathValue,
  expandEnvVars,
  splitPathEntries,
  mergePathEntries
} from '../../../src/main/agentHub/winEnv'

describe('parseRegQueryPathValue', () => {
  it('parses REG_EXPAND_SZ with spaces in the value', () => {
    const out = [
      '',
      'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
      '',
      '    PATH    REG_EXPAND_SZ    C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs;D:\\Tool\\Git\\cmd',
      ''
    ].join('\r\n')
    expect(parseRegQueryPathValue(out)).toBe(
      'C:\\Windows\\system32;C:\\Windows;C:\\Program Files\\nodejs;D:\\Tool\\Git\\cmd'
    )
  })

  it('parses REG_SZ (user environment key shape)', () => {
    const out = 'HKEY_CURRENT_USER\\Environment\r\n    PATH    REG_SZ    D:\\Tools\\bin\r\n'
    expect(parseRegQueryPathValue(out)).toBe('D:\\Tools\\bin')
  })

  it('returns null when the key or value is absent', () => {
    expect(parseRegQueryPathValue('ERROR: The system was unable to find the specified registry key or value.')).toBeNull()
    expect(parseRegQueryPathValue('HKEY_CURRENT_USER\\Environment\r\n    OTHER    REG_SZ    x\r\n')).toBeNull()
    expect(parseRegQueryPathValue('')).toBeNull()
  })
})

describe('expandEnvVars', () => {
  const vars = { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev' }

  it('expands %-vars case-insensitively', () => {
    expect(expandEnvVars('%SystemRoot%\\System32', vars)).toBe('C:\\Windows\\System32')
    expect(expandEnvVars('%systemroot%\\System32', vars)).toBe('C:\\Windows\\System32')
  })

  it('expands multiple vars and leaves unknown ones literal', () => {
    expect(expandEnvVars('%USERPROFILE%\\bin;%NOPE%\\x', vars)).toBe('C:\\Users\\dev\\bin;%NOPE%\\x')
  })

  it('handles one level of nesting (result containing another var)', () => {
    expect(expandEnvVars('%A%', { A: '%B%', B: 'done' })).toBe('done')
  })
})

describe('splitPathEntries / mergePathEntries', () => {
  it('splits, trims and drops empties', () => {
    expect(splitPathEntries(' C:\\a ;; ;D:\\b; ')).toEqual(['C:\\a', 'D:\\b'])
  })

  it('merges with first-occurrence priority, case-insensitive dedupe', () => {
    const merged = mergePathEntries('C:\\A;D:\\B', 'c:\\a;D:\\b\\;E:\\C')
    expect(merged).toBe('C:\\A;D:\\B;E:\\C')
  })

  it('trailing slash variants dedupe (forward/back, mixed case)', () => {
    expect(mergePathEntries('C:\\Git\\cmd', 'C:/git/cmd/')).toBe('C:\\Git\\cmd')
  })

  it('keeps registry entries that the sanitized PATH lacks', () => {
    const sanitized = 'C:\\Windows\\System32'
    const registry = 'C:\\Windows\\system32;C:\\Windows;D:\\Tool\\Git\\cmd;C:\\Program Files\\nodejs'
    const merged = mergePathEntries(sanitized, registry)
    expect(merged).toContain('D:\\Tool\\Git\\cmd')
    expect(merged).toContain('C:\\Program Files\\nodejs')
    // no duplicates of system32
    expect(merged.toLowerCase().split(';').filter((p) => p.includes('system32'))).toHaveLength(1)
  })
})
