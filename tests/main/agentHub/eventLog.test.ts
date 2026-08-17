import { describe, it, expect } from 'vitest'
import { parseEventLogBody } from '../../../src/main/agentHub/eventLog'

function ev(seq: number, type: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ seq, at: '2026-08-17T00:00:00.000Z', type, runId: 'run-x', ...extra })
}

describe('parseEventLogBody (torn-tail handling)', () => {
  it('parses a well-formed log', () => {
    const body = [ev(0, 'run_started'), ev(1, 'user_message', { prompt: 'hi' }), ev(2, 'run_finished')].join('\n') + '\n'
    const { events, goodLength, badLines } = parseEventLogBody(body)
    expect(events).toHaveLength(3)
    expect(events[1].prompt).toBe('hi')
    expect(goodLength).toBe(body.length)
    expect(badLines).toBe(0)
  })

  it('keeps complete lines and reports a torn (partial) final line', () => {
    const good = ev(0, 'run_started') + '\n' + ev(1, 'user_message', { prompt: 'x' }) + '\n'
    const torn = '{"seq":2,"at":"2026-08-17T00:00:0'
    const { events, goodLength, badLines } = parseEventLogBody(good + torn)
    expect(events).toHaveLength(2)
    expect(goodLength).toBe(good.length)
    expect(badLines).toBeGreaterThan(0)
  })

  it('stops at a mid-file bad line (everything after is suspect)', () => {
    const body = ev(0, 'run_started') + '\n' + 'garbage\n' + ev(1, 'user_message') + '\n'
    const { events, badLines } = parseEventLogBody(body)
    expect(events).toHaveLength(1)
    expect(badLines).toBeGreaterThan(0)
  })

  it('rejects lines without a type field', () => {
    const body = JSON.stringify({ seq: 0, at: 'x', runId: 'r' }) + '\n'
    const { events } = parseEventLogBody(body)
    expect(events).toHaveLength(0)
  })

  it('handles an empty body', () => {
    const { events, goodLength } = parseEventLogBody('')
    expect(events).toHaveLength(0)
    expect(goodLength).toBe(0)
  })
})
