import { describe, it, expect } from 'vitest'
import { extractJson, extractJsonArray } from '../../src/shared/jsonUtils'

describe('extractJson (object variant)', () => {
  it('parses plain JSON objects', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('unwraps markdown code fences', () => {
    const content = 'Here you go:\n```json\n{"items": [], "summary": "x"}\n```'
    expect(extractJson(content)).toEqual({ items: [], summary: 'x' })
  })

  it('extracts the object out of surrounding prose', () => {
    const content = '好的，这是结果 { "taskId": "t-1", "reason": "今天截止" } 请查收'
    expect(extractJson(content)).toEqual({ taskId: 't-1', reason: '今天截止' })
  })

  it('returns null for empty or non-JSON content', () => {
    expect(extractJson('')).toBeNull()
    expect(extractJson('抱歉，我无法完成该请求')).toBeNull()
  })

  it('returns null on malformed JSON between braces', () => {
    expect(extractJson('{ not valid json }')).toBeNull()
  })
})

describe('extractJsonArray (array variant)', () => {
  it('parses plain JSON arrays', () => {
    expect(extractJsonArray('[1, 2, 3]')).toEqual([1, 2, 3])
  })

  it('unwraps code fences', () => {
    const content = '```\n[{"index": 0, "tags": ["react"]}]\n```'
    expect(extractJsonArray(content)).toEqual([{ index: 0, tags: ['react'] }])
  })

  it('extracts arrays out of prose', () => {
    const content = '结果如下 [{"index":0},{"index":1}] 以上'
    expect(extractJsonArray(content)).toEqual([{ index: 0 }, { index: 1 }])
  })

  it('returns null when the parsed value is not an array', () => {
    expect(extractJsonArray('{"a":1}')).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(extractJsonArray('')).toBeNull()
  })
})
