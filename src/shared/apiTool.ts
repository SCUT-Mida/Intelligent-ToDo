/**
 * API 调试工具（Postman-lite）— shared types, IPC channels, pure helpers.
 *
 * A fourth sub-app (v1.25): a login-free HTTP client for internal networks
 * where Postman's account-gated features are unavailable. GET/POST only,
 * all requests executed in the MAIN process via Electron net (system-proxy
 * aware), all data persisted locally.
 *
 * Pure helpers (buildFinalUrl / buildHeaderMap / validateJsonBody /
 * prettyJsonBody) live here so main and renderer share ONE implementation
 * and unit tests cover them (tests/shared/apiTool.test.ts).
 */

// ── IPC channels (renderer → main, request/response) ────────────────────────

export const API_TOOL_IPC = {
  /** Execute an HTTP request described by ApiRequestSpec. */
  SEND: 'apiTool:send',
  /** Load persisted data (saved requests + history). */
  GET_DATA: 'apiTool:getData',
  /** Persist full data (renderer is source of truth). */
  SAVE_DATA: 'apiTool:saveData'
} as const

// ── Request types ───────────────────────────────────────────────────────────

export type ApiHttpMethod = 'GET' | 'POST'

/** One key/value row (query param or header) with an enable checkbox. */
export interface ApiKeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type ApiBodyType = 'none' | 'json' | 'text'

/** A complete request definition — the unit saved/loaded/sent. */
export interface ApiRequestSpec {
  name: string
  method: ApiHttpMethod
  url: string
  params: ApiKeyValue[]
  headers: ApiKeyValue[]
  bodyType: ApiBodyType
  /** Raw body text (json/text). Ignored when bodyType is 'none' or GET. */
  body: string
}

// ── Response types ──────────────────────────────────────────────────────────

/** Result of one executed request (network errors become `error`). */
export interface ApiResponseResult {
  /** True when a response arrived (any status) — false on network error. */
  ok: boolean
  status: number
  statusText: string
  /** Response headers (multi-values joined with ', '). */
  headers: Record<string, string>
  /** Raw response body as text. */
  body: string
  /** Total request duration in ms. */
  durationMs: number
  /** Body size in bytes (UTF-8 byte length). */
  sizeBytes: number
  /** Chinese, actionable error message when ok is false. */
  error?: string
}

// ── Persistence types ───────────────────────────────────────────────────────

export interface SavedApiRequest extends ApiRequestSpec {
  id: string
  createdAt: string
  updatedAt: string
}

/** One history entry — a snapshot of the spec + outcome, newest last. */
export interface ApiHistoryEntry {
  id: string
  at: string
  method: ApiHttpMethod
  url: string
  /** HTTP status, or null when the request failed at network level. */
  status: number | null
  durationMs: number | null
  /** Full spec snapshot for one-click restore. */
  spec: ApiRequestSpec
}

export interface ApiToolData {
  version: 1
  requests: SavedApiRequest[]
  history: ApiHistoryEntry[]
  updatedAt: string
}

export const API_HISTORY_LIMIT = 50

export function createDefaultApiToolData(): ApiToolData {
  return { version: 1, requests: [], history: [], updatedAt: new Date().toISOString() }
}

/** Blank editable spec used by the "new request" state. */
export function createDefaultApiRequestSpec(): ApiRequestSpec {
  return {
    name: '未命名请求',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyType: 'json',
    body: ''
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Append enabled query params to a base URL. Handles the '?'/'&' boundary
 * (a base URL may already carry its own query string) and percent-encodes
 * keys/values via URLSearchParams (UTF-8 / 中文 safe).
 */
export function buildFinalUrl(url: string, params: ApiKeyValue[]): string {
  const enabled = params.filter((p) => p.enabled && p.key.trim() !== '')
  if (enabled.length === 0) return url
  const qs = new URLSearchParams()
  for (const p of enabled) {
    qs.append(p.key.trim(), p.value)
  }
  const separator = url.includes('?') ? '&' : '?'
  return url + separator + qs.toString().replace(/\+/g, '%20')
}

/**
 * Build the request header map from enabled rows. When bodyType is 'json'
 * and no content-type was set by the user, application/json is added
 * (user-provided values always win, case-insensitive key match).
 */
export function buildHeaderMap(
  headers: ApiKeyValue[],
  bodyType: ApiBodyType
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const h of headers) {
    if (!h.enabled || h.key.trim() === '') continue
    map[h.key.trim()] = h.value
  }
  if (bodyType === 'json') {
    const hasContentType = Object.keys(map).some(
      (k) => k.toLowerCase() === 'content-type'
    )
    if (!hasContentType) map['Content-Type'] = 'application/json'
  }
  return map
}

/**
 * Validate a JSON request body. Returns null when valid (or blank — blank is
 * treated as "send nothing"), or a Chinese error message describing the
 * parse failure position.
 */
export function validateJsonBody(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed === '') return null
  try {
    JSON.parse(trimmed)
    return null
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return `请求体不是合法的 JSON：${detail}`
  }
}

/**
 * Pretty-print a response body when it parses as JSON; returns the original
 * text otherwise. Used by the response panel's 美化 view.
 */
export function prettyJsonBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return body
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return body
  }
}

/** Row factory for the key/value editors. */
export function createApiKeyValue(key = '', value = ''): ApiKeyValue {
  return { id: `kv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`, key, value, enabled: true }
}
