import { describe, it, expect } from 'vitest'
import { parseStreamJsonLine, buildTaskArgv } from '../../../src/main/agentHub/streamJson'

describe('parseStreamJsonLine', () => {
  it('parses assistant text blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '让我看看这个仓库' }] }
    })
    expect(parseStreamJsonLine(line)).toEqual({ type: 'assistant_message', text: '让我看看这个仓库' })
  })

  it('parses tool_use blocks with stringified input', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls -la' } }]
      }
    })
    const parsed = parseStreamJsonLine(line)
    expect(parsed?.type).toBe('tool_call')
    expect(parsed?.toolName).toBe('Bash')
    expect(JSON.parse(parsed?.toolInput ?? '')).toEqual({ command: 'ls -la' })
  })

  it('parses tool_result user events', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file list output' }] }
    })
    expect(parseStreamJsonLine(line)).toEqual({ type: 'tool_result', toolResult: 'file list output' })
  })

  it('parses the final result event with usage', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '任务完成',
      usage: { input_tokens: 120, output_tokens: 80 }
    })
    expect(parseStreamJsonLine(line)).toEqual({
      type: 'run_finished',
      result: '任务完成',
      usage: { inputTokens: 120, outputTokens: 80 },
      error: undefined
    })
  })

  it('maps error results to run_error', () => {
    const line = JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' })
    const parsed = parseStreamJsonLine(line)
    expect(parsed?.type).toBe('run_error')
    expect(parsed?.error).toBe('boom')
  })

  it('ignores system init lines and unknown types (defensive)', () => {
    expect(parseStreamJsonLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }))).toBeNull()
    expect(parseStreamJsonLine(JSON.stringify({ type: 'future_kind', payload: 1 }))).toBeNull()
  })

  it('ignores blank / non-JSON / torn lines without throwing', () => {
    expect(parseStreamJsonLine('')).toBeNull()
    expect(parseStreamJsonLine('   ')).toBeNull()
    expect(parseStreamJsonLine('not json at all')).toBeNull()
    expect(parseStreamJsonLine('{"type":"assistant","message":{"con')).toBeNull()
  })

  it('truncates huge tool results to keep the event log bounded', () => {
    const huge = 'x'.repeat(20000)
    const line = JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't', content: huge }] }
    })
    const parsed = parseStreamJsonLine(line)
    expect(parsed?.toolResult?.length).toBeLessThanOrEqual(8000 + 20)
  })
})

describe('buildTaskArgv', () => {
  it('claude (stream-json): -p prompt --output-format stream-json --verbose', () => {
    expect(buildTaskArgv('stream-json', '做点什么', [])).toEqual([
      '-p', '做点什么', '--output-format', 'stream-json', '--verbose'
    ])
  })

  it('claude with user args keeps them and strips conflicting flags', () => {
    expect(buildTaskArgv('stream-json', 'task', ['--model', 'opus', '-p', 'stale', '--output-format', 'text'])).toEqual([
      '--model', 'opus', '-p', 'task', '--output-format', 'stream-json', '--verbose'
    ])
  })

  it('print/generic: prompt as trailing positional (dsh headless style)', () => {
    expect(buildTaskArgv('print', 'do the thing', ['--profile', 'headless'])).toEqual([
      '--profile', 'headless', 'do the thing'
    ])
    expect(buildTaskArgv('generic', 'hi', [])).toEqual(['hi'])
  })
})
