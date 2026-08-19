/**
 * API 调试工具 — IPC handler registration + persistence (v1.25).
 *
 * A login-free Postman-lite for internal networks. The renderer builds an
 * ApiRequestSpec; this module executes it in the MAIN process via netFetch
 * (Electron net → system-proxy aware, per the repo's "no renderer fetch /
 * no Node undici" rule) and returns a structured ApiResponseResult.
 *
 * Persisted at <userData>/api-tool.json using the shared atomic-write +
 * corrupt-backup pattern.
 */

import { ipcMain, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync } from 'fs'
import { API_TOOL_IPC } from '../../shared/apiTool'
import type {
  ApiRequestSpec,
  ApiResponseResult,
  ApiToolData
} from '../../shared/apiTool'
import { buildFinalUrl, buildHeaderMap, validateJsonBody } from '../../shared/apiTool'
import { createDefaultApiToolData, API_HISTORY_LIMIT } from '../../shared/apiTool'
import { writeJsonAtomic } from '../atomic'
import { netFetch } from '../netFetch'
import { logger } from '../logger'

const DATA_FILE = join(app.getPath('userData'), 'api-tool.json')

const REQUEST_TIMEOUT_MS = 30000

// ── Persistence ─────────────────────────────────────────────────────────────

/**
 * Load persisted data. Missing file → defaults; corrupted file → back up
 * (`.corrupt-<ts>`) then return defaults so the app stays usable.
 */
export function loadApiToolData(): ApiToolData {
  if (!existsSync(DATA_FILE)) return createDefaultApiToolData()
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as Partial<ApiToolData>
    return {
      version: 1,
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      history: Array.isArray(parsed.history) ? parsed.history.slice(-API_HISTORY_LIMIT) : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  } catch (err) {
    logger.warn('apiTool:persist', 'data unreadable, backing up and resetting', {
      error: err instanceof Error ? err.message : String(err)
    })
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${ts}`)
    } catch {
      // ignore backup failure
    }
    return createDefaultApiToolData()
  }
}

/** Persist data atomically (tmp + rename). Throws on failure. */
export function saveApiToolData(data: ApiToolData): void {
  const payload: ApiToolData = {
    version: 1,
    requests: data.requests,
    history: data.history.slice(-API_HISTORY_LIMIT),
    updatedAt: new Date().toISOString()
  }
  writeJsonAtomic(DATA_FILE, payload)
}

// ── Request execution ───────────────────────────────────────────────────────

/**
 * Execute one request. Never throws — network/timeout/URL problems become
 * `ApiResponseResult { ok: false, error }` with actionable Chinese messages
 * (mirrors classifyLlmError's tone).
 */
async function executeRequest(spec: ApiRequestSpec): Promise<ApiResponseResult> {
  const empty = (error: string): ApiResponseResult => ({
    ok: false,
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    durationMs: 0,
    sizeBytes: 0,
    error
  })

  const rawUrl = spec.url.trim()
  if (!rawUrl) return empty('请填写请求 URL')
  if (!/^https?:\/\//i.test(rawUrl)) {
    return empty('URL 必须以 http:// 或 https:// 开头')
  }

  let finalUrl: string
  try {
    finalUrl = buildFinalUrl(rawUrl, spec.params)
    // Validate via the URL parser (catches malformed hosts, bad ports…).
    new URL(finalUrl)
  } catch {
    return empty('URL 格式不正确，请检查地址与参数拼写')
  }

  const bodyType = spec.method === 'GET' ? 'none' : spec.bodyType
  if (bodyType === 'json') {
    const jsonError = validateJsonBody(spec.body)
    if (jsonError) return empty(jsonError)
  }
  const headerMap = buildHeaderMap(spec.headers, bodyType)
  const bodyText = bodyType === 'none' || bodyType === 'text' || bodyType === 'json'
    ? (bodyType === 'none' ? undefined : spec.body.trim() === '' ? undefined : spec.body)
    : undefined

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const startedAt = Date.now()

  try {
    const resp = await netFetch(finalUrl, {
      method: spec.method,
      headers: headerMap,
      body: spec.method === 'POST' ? bodyText : undefined,
      signal: controller.signal
    })
    const durationMs = Date.now() - startedAt
    const body = await resp.text().catch(() => '')
    return {
      ok: true,
      status: resp.status,
      statusText: '',
      headers: resp.headers,
      body,
      durationMs,
      sizeBytes: Buffer.byteLength(body, 'utf-8')
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    if (err instanceof Error && err.name === 'AbortError') {
      return empty(`请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒无响应）。请检查目标服务是否可达，或网络/代理设置。`)
    }
    const detail = err instanceof Error ? err.message : String(err)
    return empty(`请求失败：${detail}。请检查目标地址、端口与网络连通性。`)
  } finally {
    clearTimeout(timeout)
  }
}

// ── Handler registration ────────────────────────────────────────────────────

export function registerApiToolIpc(ipc: typeof ipcMain): void {
  ipc.handle(API_TOOL_IPC.SEND, async (_e: IpcMainInvokeEvent, spec: ApiRequestSpec): Promise<ApiResponseResult> => {
    const result = await executeRequest(spec)
    logger.info('apiTool', 'request executed', {
      method: spec.method,
      url: spec.url,
      ok: result.ok,
      status: result.status,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes
    })
    return result
  })

  ipc.handle(API_TOOL_IPC.GET_DATA, (): ApiToolData => loadApiToolData())

  ipc.handle(API_TOOL_IPC.SAVE_DATA, (_e: IpcMainInvokeEvent, data: ApiToolData): boolean => {
    try {
      saveApiToolData(data)
      return true
    } catch (err) {
      logger.error('apiTool:persist', 'failed to save data', {
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  })

  logger.info('apiTool:ipc', 'IPC handlers registered')
}
