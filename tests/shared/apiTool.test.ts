import { describe, it, expect } from 'vitest'
import {
  buildFinalUrl,
  buildHeaderMap,
  validateJsonBody,
  prettyJsonBody,
  createApiKeyValue,
  classifyNetError,
  normalizeApiToolSettings
} from '../../src/shared/apiTool'

describe('buildFinalUrl', () => {
  const kv = (key: string, value: string, enabled = true): ReturnType<typeof createApiKeyValue> => ({
    ...createApiKeyValue(key, value),
    enabled
  })

  it('appends params with ? when the URL has none', () => {
    expect(buildFinalUrl('http://a.b/api', [kv('page', '1'), kv('size', '20')])).toBe(
      'http://a.b/api?page=1&size=20'
    )
  })

  it('joins with & when the URL already has a query string', () => {
    expect(buildFinalUrl('http://a.b/api?x=1', [kv('y', '2')])).toBe('http://a.b/api?x=1&y=2')
  })

  it('skips disabled rows and blank keys', () => {
    expect(
      buildFinalUrl('http://a.b', [kv('a', '1', false), kv('', 'ignored'), kv('b', '2')])
    ).toBe('http://a.b?b=2')
  })

  it('percent-encodes Chinese and reserved characters', () => {
    const out = buildFinalUrl('http://a.b', [kv('q', '你好 world')])
    expect(out).toContain('q=')
    expect(out).not.toContain('你好')
    expect(out).not.toContain(' ') // space encoded
  })

  it('returns the URL untouched when no enabled params', () => {
    expect(buildFinalUrl('http://a.b/x', [])).toBe('http://a.b/x')
    expect(buildFinalUrl('http://a.b/x', [kv('a', '1', false)])).toBe('http://a.b/x')
  })
})

describe('buildHeaderMap', () => {
  it('collects enabled rows and trims keys', () => {
    const h = buildHeaderMap(
      [
        { ...createApiKeyValue(' Authorization ', 'Bearer x') },
        { ...createApiKeyValue('X-Off', 'y'), enabled: false }
      ],
      'none'
    )
    expect(h).toEqual({ Authorization: 'Bearer x' })
  })

  it("adds application/json for json bodies when content-type isn't set", () => {
    const h = buildHeaderMap([], 'json')
    expect(h['Content-Type']).toBe('application/json')
  })

  it('respects a user-set content-type (case-insensitive detection)', () => {
    const h = buildHeaderMap(
      [{ ...createApiKeyValue('content-type', 'text/plain') }],
      'json'
    )
    expect(h['content-type']).toBe('text/plain')
    expect(h['Content-Type']).toBeUndefined()
  })

  it('does not add content-type for non-json bodies', () => {
    expect(buildHeaderMap([], 'none')).toEqual({})
    expect(buildHeaderMap([], 'text')).toEqual({})
  })
})

describe('validateJsonBody', () => {
  it('accepts valid objects and arrays', () => {
    expect(validateJsonBody('{"a":1}')).toBeNull()
    expect(validateJsonBody('[1,2,3]')).toBeNull()
  })

  it('treats blank as empty (no error)', () => {
    expect(validateJsonBody('')).toBeNull()
    expect(validateJsonBody('   ')).toBeNull()
  })

  it('returns a Chinese error message for invalid JSON', () => {
    const err = validateJsonBody('{ not json }')
    expect(err).toContain('不是合法的 JSON')
    expect(err).not.toBeNull()
  })
})

describe('prettyJsonBody', () => {
  it('pretty-prints JSON objects', () => {
    expect(prettyJsonBody('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('returns the original text for non-JSON bodies', () => {
    expect(prettyJsonBody('plain text')).toBe('plain text')
    expect(prettyJsonBody('<html>ok</html>')).toBe('<html>ok</html>')
  })

  it('returns the original for malformed JSON', () => {
    expect(prettyJsonBody('{"broken":')).toBe('{"broken":')
  })
})

describe('classifyNetError (v1.25.1)', () => {
  it('extracts the net::ERR code from raw messages', () => {
    expect(classifyNetError('请求失败：net::ERR_CERT_AUTHORITY_INVALID。').code).toBe(
      'ERR_CERT_AUTHORITY_INVALID'
    )
    expect(classifyNetError('no code here').code).toBe('')
  })

  it('certificate errors suggest ignoreCert', () => {
    for (const code of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_COMMON_NAME_INVALID', 'ERR_SSL_PROTOCOL_ERROR']) {
      const cls = classifyNetError(`net::${code}`)
      expect(cls.suggestFix).toBe('ignoreCert')
      expect(cls.cause).toContain('证书')
    }
  })

  it('proxy/tunnel errors suggest direct', () => {
    for (const code of ['ERR_TUNNEL_CONNECTION_FAILED', 'ERR_PROXY_CONNECTION_FAILED']) {
      expect(classifyNetError(`net::${code}`).suggestFix).toBe('direct')
    }
  })

  it('connection issues suggest direct; DNS issues have no fix', () => {
    expect(classifyNetError('net::ERR_CONNECTION_TIMED_OUT').suggestFix).toBe('direct')
    expect(classifyNetError('net::ERR_CONNECTION_REFUSED').suggestFix).toBe('direct')
    expect(classifyNetError('net::ERR_NAME_NOT_RESOLVED').suggestFix).toBeNull()
  })

  it('unclassified codes get a generic cause', () => {
    const cls = classifyNetError('net::ERR_INCOMPLETE_CHUNKED_ENCODING')
    expect(cls.suggestFix).toBeNull()
    expect(cls.cause).toBeTruthy()
  })
})

describe('normalizeApiToolSettings (v1.25.1)', () => {
  it('falls back to safe defaults for missing/legacy data', () => {
    expect(normalizeApiToolSettings(undefined)).toEqual({
      proxyMode: 'system',
      ignoreCert: false,
      timeoutMs: 30000
    })
    expect(normalizeApiToolSettings({})).toEqual(normalizeApiToolSettings(undefined))
  })

  it('keeps valid values and clamps the timeout', () => {
    expect(
      normalizeApiToolSettings({ proxyMode: 'direct', ignoreCert: true, timeoutMs: 5000 })
    ).toEqual({ proxyMode: 'direct', ignoreCert: true, timeoutMs: 5000 })
    expect(normalizeApiToolSettings({ timeoutMs: 10 }).timeoutMs).toBe(30000) // too small
    expect(normalizeApiToolSettings({ timeoutMs: 999999 }).timeoutMs).toBe(300000) // clamp max
  })

  it('ignores invalid proxyMode values', () => {
    expect(normalizeApiToolSettings({ proxyMode: 'socks' as 'direct' }).proxyMode).toBe('system')
  })
})
