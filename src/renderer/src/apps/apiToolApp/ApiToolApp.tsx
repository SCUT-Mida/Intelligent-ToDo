import { useState, useEffect, useRef, useCallback } from 'react'
import type {
  ApiRequestSpec,
  ApiResponseResult,
  ApiToolData,
  ApiHistoryEntry,
  ApiToolSettings,
  SavedApiRequest
} from '@shared/apiTool'
import {
  createDefaultApiToolData,
  createDefaultApiRequestSpec,
  normalizeApiToolSettings,
  API_HISTORY_LIMIT
} from '@shared/apiTool'
import ApiSidebar from '../../components/ApiTool/ApiSidebar'
import ApiRequestEditor from '../../components/ApiTool/ApiRequestEditor'
import ApiResponsePanel from '../../components/ApiTool/ApiResponsePanel'
import ApiSettingsDialog from '../../components/ApiTool/ApiSettingsDialog'
import '../../styles/apiTool.css'

/**
 * API 调试 — 免登录的 Postman-lite 子应用（v1.25）。
 *
 * Self-contained container (AgentHub pattern): all data (saved requests +
 * history) is owned here and persisted via window.apiTool IPC; HTTP always
 * executes in the MAIN process (system-proxy aware). No accounts, no cloud.
 */
export default function ApiToolApp(): JSX.Element {
  const [data, setData] = useState<ApiToolData>(() => createDefaultApiToolData())
  const [loaded, setLoaded] = useState(false)
  // Currently edited spec — either a draft or bound to a saved request id.
  const [spec, setSpec] = useState<ApiRequestSpec>(() => createDefaultApiRequestSpec())
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null)
  const [response, setResponse] = useState<ApiResponseResult | null>(null)
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Ref mirrors for the persistence effect + async callbacks.
  const dataRef = useRef(data)
  dataRef.current = data
  const specRef = useRef(spec)
  specRef.current = spec
  // Network settings ref — send() passes these along with every request.
  const settingsRef = useRef<ApiToolSettings>(normalizeApiToolSettings(undefined))
  const setSettingsAndSync = useCallback((next: ApiToolSettings): void => {
    settingsRef.current = next
    setData((prev) => ({ ...prev, settings: next }))
  }, [])
  // Load persisted data on mount.
  useEffect(() => {
    void (async () => {
      try {
        const loaded = await window.apiTool.getData()
        setData(loaded)
      } catch (err) {
        console.error('Failed to load API tool data', err)
      } finally {
        setLoaded(true)
      }
    })()
  }, [])

  // Debounced persist — avoids a write per keystroke; flushes 400ms after
  // the last change once loaded.
  useEffect(() => {
    if (!loaded) return
    const t = window.setTimeout(() => {
      window.apiTool.saveData(dataRef.current).catch((err: unknown) => {
        console.error('Failed to persist API tool data', err)
      })
    }, 400)
    return () => window.clearTimeout(t)
  }, [data, loaded])

  const showFlash = useCallback((msg: string, ms = 3000): void => {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), ms)
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideSettings?: ApiToolSettings): Promise<void> => {
    setSending(true)
    setResponse(null)
    try {
      const result = await window.apiTool.send(specRef.current, overrideSettings ?? settingsRef.current)
      setResponse(result)
      // Record history (spec snapshot + outcome), newest last, capped.
      const entry: ApiHistoryEntry = {
        id: `h-${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        method: specRef.current.method,
        url: specRef.current.url.trim(),
        status: result.ok ? result.status : null,
        durationMs: result.ok ? result.durationMs : null,
        spec: specRef.current
      }
      setData((prev) => ({
        ...prev,
        history: [...prev.history, entry].slice(-API_HISTORY_LIMIT)
      }))
    } catch (err) {
      setResponse({
        ok: false,
        status: 0,
        statusText: '',
        headers: {},
        body: '',
        durationMs: 0,
        sizeBytes: 0,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setSending(false)
    }
  }, [])

  const handleSaveRequest = useCallback((): void => {
    const current = specRef.current
    const name = current.name.trim() || current.url.trim() || '未命名请求'
    const now = new Date().toISOString()
    setData((prev) => {
      if (activeRequestId) {
        return {
          ...prev,
          requests: prev.requests.map((r) =>
            r.id === activeRequestId ? { ...r, ...current, name, updatedAt: now } : r
          )
        }
      }
      const created: SavedApiRequest = {
        ...current,
        name,
        id: `req-${Date.now().toString(36)}`,
        createdAt: now,
        updatedAt: now
      }
      setActiveRequestId(created.id)
      return { ...prev, requests: [created, ...prev.requests] }
    })
    showFlash(`已收藏「${name}」`)
  }, [activeRequestId, showFlash])

  const handleNewRequest = useCallback((): void => {
    setActiveRequestId(null)
    setSpec(createDefaultApiRequestSpec())
    setResponse(null)
  }, [])

  const handleSelectRequest = useCallback((id: string): void => {
    const req = dataRef.current.requests.find((r) => r.id === id)
    if (!req) return
    setActiveRequestId(id)
    // Strip persistence fields into a plain spec.
    setSpec({
      name: req.name,
      method: req.method,
      url: req.url,
      params: req.params,
      headers: req.headers,
      bodyType: req.bodyType,
      body: req.body
    })
    setResponse(null)
  }, [])

  const handleRenameRequest = useCallback((id: string, name: string): void => {
    setData((prev) => ({
      ...prev,
      requests: prev.requests.map((r) =>
        r.id === id ? { ...r, name, updatedAt: new Date().toISOString() } : r
      )
    }))
  }, [])

  const handleDeleteRequest = useCallback((id: string): void => {
    setData((prev) => ({ ...prev, requests: prev.requests.filter((r) => r.id !== id) }))
    if (activeRequestId === id) {
      setActiveRequestId(null)
    }
  }, [activeRequestId])

  const handleRestoreHistory = useCallback((entry: ApiHistoryEntry): void => {
    setActiveRequestId(null)
    setSpec({ ...entry.spec, name: entry.spec.name || shortUrlLabel(entry.url) })
    setResponse(null)
  }, [])

  const handleClearHistory = useCallback((): void => {
    setData((prev) => ({ ...prev, history: [] }))
  }, [])

  // Name editing for the current spec (shown in a small input above editor).
  const handleNameChange = useCallback((name: string): void => {
    setSpec((prev) => ({ ...prev, name }))
  }, [])

  // ── Network settings (v1.25.1) ─────────────────────────────────────────

  const settings = normalizeApiToolSettings(data.settings)

  // Keep the ref in sync whenever persisted settings change (e.g. saved
  // via the settings dialog).
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  const handleSaveSettings = useCallback((next: ApiToolSettings): void => {
    setSettingsAndSync(next)
    setSettingsOpen(false)
    showFlash('网络设置已保存，对下一次发送生效')
  }, [setSettingsAndSync, showFlash])

  /** One-click fix from the error card: flip the setting, persist, re-send. */
  const handleApplyFix = useCallback((fix: 'ignoreCert' | 'direct'): void => {
    const next = normalizeApiToolSettings(dataRef.current.settings)
    if (fix === 'ignoreCert') {
      next.ignoreCert = true
    } else {
      next.proxyMode = 'direct'
    }
    setSettingsAndSync(next)
    showFlash(
      fix === 'ignoreCert'
        ? '已开启「忽略证书校验」，正在重发…'
        : '已切换「直连（不走代理）」，正在重发…'
    )
    // Re-send immediately; settings ride along with the request, so no
    // dependency on the debounced disk persist.
    void handleSend(next)
  }, [handleSend, setSettingsAndSync, showFlash])

  return (
    <div className="api-tool">
      <ApiSidebar
        requests={data.requests}
        history={data.history}
        activeRequestId={activeRequestId}
        onSelectRequest={handleSelectRequest}
        onNewRequest={handleNewRequest}
        onRenameRequest={handleRenameRequest}
        onDeleteRequest={handleDeleteRequest}
        onRestoreHistory={handleRestoreHistory}
        onClearHistory={handleClearHistory}
      />

      <div className="api-tool__main">
        {flash && (
          <div className="api-tool__flash">
            {flash}
            <button className="api-tool__flash-close" onClick={() => setFlash(null)} aria-label="关闭">×</button>
          </div>
        )}

        <div className="api-tool__request-pane">
          <div className="api-tool__name-row">
            <input
              className="input api-tool__name"
              value={spec.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="请求名称（收藏时显示）"
              spellCheck={false}
            />
            <button
              className={`btn btn--ghost api-tool__net-btn ${settings.proxyMode === 'direct' || settings.ignoreCert ? 'api-tool__net-btn--custom' : ''}`}
              onClick={() => setSettingsOpen(true)}
              title={`网络设置（内网选项）\n当前：${settings.proxyMode === 'direct' ? '直连' : '系统代理'} · ${settings.ignoreCert ? '忽略证书校验' : '校验证书'} · 超时 ${Math.round(settings.timeoutMs / 1000)}s`}
            >
              ⚙ 网络
            </button>
          </div>
          <ApiRequestEditor
            spec={spec}
            onChange={setSpec}
            onSend={() => void handleSend()}
            onSave={handleSaveRequest}
            sending={sending}
          />
        </div>

        <div className="api-tool__response-pane">
          <ApiResponsePanel response={response} sending={sending} onApplyFix={handleApplyFix} />
        </div>
      </div>

      {settingsOpen && (
        <ApiSettingsDialog
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}

function shortUrlLabel(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}
