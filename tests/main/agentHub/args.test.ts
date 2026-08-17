import { describe, it, expect } from 'vitest'
import { tokenizeArgs } from '../../../src/main/agentHub/args'

describe('tokenizeArgs', () => {
  it('splits on whitespace', () => {
    expect(tokenizeArgs('--model opus')).toEqual(['--model', 'opus'])
    expect(tokenizeArgs('  -p   --verbose  ')).toEqual(['-p', '--verbose'])
  })

  it('returns an empty array for empty/whitespace input', () => {
    expect(tokenizeArgs('')).toEqual([])
    expect(tokenizeArgs('   ')).toEqual([])
    expect(tokenizeArgs(undefined as unknown as string)).toEqual([])
  })

  it('preserves spaces inside double quotes (backslash literal)', () => {
    expect(tokenizeArgs('--msg "hello world"')).toEqual(['--msg', 'hello world'])
    // Windows path friendliness: backslash stays literal inside double quotes.
    expect(tokenizeArgs('"C:\\dir\\file"')).toEqual(['C:\\dir\\file'])
  })

  it('preserves spaces inside single quotes', () => {
    expect(tokenizeArgs("--name 'a b'")).toEqual(['--name', 'a b'])
  })

  it('escapes the next char with unquoted backslash', () => {
    expect(tokenizeArgs('path\\ with\\ spaces')).toEqual(['path with spaces'])
  })

  it('keeps a trailing lone backslash literal', () => {
    expect(tokenizeArgs('abc\\')).toEqual(['abc\\'])
  })

  it('treats unterminated quotes as literal to end of string (never throws)', () => {
    expect(tokenizeArgs('--msg "unterminated')).toEqual(['--msg', 'unterminated'])
    expect(tokenizeArgs("--x 'tail")).toEqual(['--x', 'tail'])
  })

  it('leaves shell metacharacters as plain text (no expansion by design)', () => {
    expect(tokenizeArgs('$HOME * ? `cmd`')).toEqual(['$HOME', '*', '?', '`cmd`'])
  })

  it('handles tabs and newlines as separators', () => {
    expect(tokenizeArgs('a\tb\nc')).toEqual(['a', 'b', 'c'])
  })
})
