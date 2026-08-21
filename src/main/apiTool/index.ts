/**
 * API 调试工具 — IPC handler registration + persistence + network session.
 *
 * A login-free Postman-lite for internal networks. The renderer builds an
 * ApiRequestSpec; this module executes it in the MAIN process and returns a
 * structured ApiResponseResult.
 *
 * v1.25.1 — intranet survival kit: requests run on a DEDICATED Electron
 * session (partition 'api-tool') so the user can, per ApiToolSettings:
 *   - bypass the system proxy ('direct') — proxies often refuse to route
 *     private IP ranges, which failed EVERY request with tunnel errors
 *   - accept self-signed / corporate-MITM certificates — corporate proxies
 *     re-sign HTTPS with a private CA, so the server really did handle the
 *     request while Chromium rejected the response certificate
 *   - tune the timeout
 * The default (and all other app traffic, e.g. LLM calls) stays on the
 * default session with system proxy + full certificate verification.
 *
 * Persisted at <userData>/api-tool.json using the shared atomic-write +
 * corrupt-backup pattern.
 */

import { ipcMain, app, session } from 'electron'
import type { IpcMainInvokeEvent, Session } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync } from 'fs'
import { API_TOOL_IPC } from '../../shared/apiTool'
import type {
  ApiRequestSpec,
  ApiResponseResult,
  ApiToolData,
  ApiToolSettings
} from '../../shared/apiTool'
import {
  buildFinalUrl,
  buildHeaderMap,
  validateJsonBody,
  createDefaultApiToolData,
  normalizeApiToolSettings,
  API_HISTORY_LIMIT
} from '../../shared/apiTool'
import { writeJsonAtomic } from '../atomic'
import { netFetch } from '../netFetch'
import { logger } from '../logger'

const DATA_FILE = join(app.getPath('userData'), 'api-tool.json')

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
      settings: normalizeApiToolSettings(parsed.settings),
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
    settings: normalizeApiToolSettings(data.settings),
    updatedAt: new Date().toISOString()
  }
  writeJsonAtomic(DATA_FILE, payload)
}

// ── Dedicated network session (proxy / certificate policy) ─────────────────

let cachedSession: Session | null = null
let cachedSettingsKey = ''

/**
 * Return a session for the CURRENT settings. Whenever settings change we
 * build a session on a FRESH partition (generation counter) instead of
 * mutating the old one — Chromium pools keep-alive connections per session,
 * so a connection accepted under `ignoreCert` would otherwise stay usable
 * after the user turns the option back off. A new partition guarantees the
 * new policy applies immediately; stale partitions are cache-less,
 * in-memory only, and die with the app.
 */
function getApiToolSession(settings: ApiToolSettings): Session {
  const key = JSON.stringify(settings)
  if (cachedSettingsKey !== key || !cachedSession) {
    const gen = key === '' ? 0 : simpleHash(key)
    cachedSession = session.fromPartition(`api-tool-${gen}`, { cache: false })
    // Proxy: 'direct' bypasses the OS proxy entirely (intranet routes);
    // 'system' restores Chromium's default behavior.
    void cachedSession
      .setProxy(settings.proxyMode === 'direct' ? { mode: 'direct' } : { mode: 'system' })
      .catch((err) => logger.warn('apiTool:session', 'setProxy failed', { error: String(err) }))
    // Certificate verification: accept everything when the user opted in.
    if (settings.ignoreCert) {
      cachedSession.setCertificateVerifyProc((_request, callback) => callback(0))
    }
    cachedSettingsKey = key
    logger.info('apiTool:session', 'session (re)created for settings', { ...settings })
  }
  return cachedSession
}

/** Tiny stable string hash → partition generation id. */
function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return String(Math.abs(h))
}

// ── Request execution ───────────────────────────────────────────────────────

/**
 * Execute one request. Never throws — network/timeout/URL problems become
 * `ApiResponseResult { ok: false, error, errorCode }` with actionable
 * Chinese messages (mirrors classifyLlmError's tone).
 */
async function executeRequest(spec: ApiRequestSpec, settings: ApiToolSettings): Promise<ApiResponseResult> {
  const empty = (error: string, errorCode?: string): ApiResponseResult => ({
    ok: false,
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    durationMs: 0,
    sizeBytes: 0,
    error,
    errorCode
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
  const bodyText =
    bodyType === 'none' || spec.body.trim() === '' ? undefined : spec.body

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs)
  const startedAt = Date.now()

  try {
    const resp = await netFetch(finalUrl, {
      method: spec.method,
      headers: headerMap,
      body: spec.method === 'POST' ? bodyText : undefined,
      signal: controller.signal,
      session: getApiToolSession(settings)
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
      return empty(
        `请求超时（${Math.round(settings.timeoutMs / 1000)} 秒无响应）。请检查目标服务是否可达，或在 API 调试设置中调大超时。`
      )
    }
    const detail = err instanceof Error ? err.message : String(err)
    const code = (detail.match(/net::(ERR_[A-Z_]+)/) ?? [])[1] ?? ''
    return empty(`请求失败：${detail}`, code ? `net::${code}` : undefined)
  } finally {
    clearTimeout(timeout)
  }
}

// ── Handler registration ────────────────────────────────────────────────────

export function registerApiToolIpc(ipc: typeof ipcMain): void {
  ipc.handle(
    API_TOOL_IPC.SEND,
    async (_e: IpcMainInvokeEvent, spec: ApiRequestSpec, settings?: Partial<ApiToolSettings>): Promise<ApiResponseResult> => {
      // Settings arrive WITH the request (race-free for the one-click-fix
      // re-send, which hasn't hit disk yet via the debounced save); fall
      // back to persisted settings when omitted.
      const effective = normalizeApiToolSettings(settings ?? loadApiToolData().settings)
      const result = await executeRequest(spec, effective)
      logger.info('apiTool', 'request executed', {
        method: spec.method,
        url: spec.url,
        ok: result.ok,
        status: result.status,
        durationMs: result.durationMs,
        sizeBytes: result.sizeBytes,
        errorCode: result.errorCode,
        proxyMode: effective.proxyMode,
        ignoreCert: effective.ignoreCert
      })
      return result
    }
  )

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
