import { useMemo, useState } from 'react'
import type { ApiResponseResult } from '@shared/apiTool'
import { prettyJsonBody } from '@shared/apiTool'

interface ApiResponsePanelProps {
  response: ApiResponseResult | null
  sending: boolean
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'api-response__status--ok'
  if (status >= 300 && status < 400) return 'api-response__status--warn'
  return 'api-response__status--err'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Copy helper — prefer the main-process clipboard (Windows reliability). */
async function copyText(text: string): Promise<void> {
  try {
    await window.agentHub.writeClipboard(text)
  } catch {
    void navigator.clipboard?.writeText(text)
  }
}

/**
 * Response viewer — status/time/size strip, pretty/raw body toggle (JSON
 * pretty-printed with 2-space indent), collapsible response headers, and a
 * copy button. Network errors render as an actionable error card.
 */
export default function ApiResponsePanel({ response, sending }: ApiResponsePanelProps): JSX.Element {
  const [view, setView] = useState<'pretty' | 'raw'>('pretty')
  const [headersOpen, setHeadersOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const displayBody = useMemo(
    () => (response && response.ok ? (view === 'pretty' ? prettyJsonBody(response.body) : response.body) : ''),
    [response, view]
  )

  const handleCopy = async (): Promise<void> => {
    if (!response) return
    await copyText(displayBody || response.body)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  if (sending) {
    return (
      <div className="api-response api-response--loading">
        <span className="spinner spinner--sm" />
        <span>请求发送中…</span>
      </div>
    )
  }

  if (!response) {
    return (
      <div className="api-response api-response--empty">
        <div className="api-response__empty-icon">🌐</div>
        <div>配置请求并点击「发送」，响应将显示在这里</div>
        <div className="api-response__empty-hint">
          支持内网地址与系统代理；请求在主进程执行，目标服务不会看到你的本机浏览器指纹
        </div>
      </div>
    )
  }

  if (!response.ok) {
    return (
      <div className="api-response api-response--error">
        <div className="api-response__error-head">❌ 请求未成功</div>
        <div className="api-response__error-msg">{response.error ?? '未知错误'}</div>
        <div className="api-response__error-hint">
          常见原因：目标服务未启动 / 端口不对 / 内网不通 / 代理拦截。请检查 URL 与网络后重试。
        </div>
      </div>
    )
  }

  return (
    <div className="api-response">
      <div className="api-response__meta">
        <span className={`api-response__status ${statusClass(response.status)}`}>{response.status}</span>
        <span className="api-response__meta-item">{response.durationMs} ms</span>
        <span className="api-response__meta-item">{formatSize(response.sizeBytes)}</span>
        <div className="api-response__meta-actions">
          <button
            className={`api-response__view ${view === 'pretty' ? 'api-response__view--active' : ''}`}
            onClick={() => setView('pretty')}
          >
            美化
          </button>
          <button
            className={`api-response__view ${view === 'raw' ? 'api-response__view--active' : ''}`}
            onClick={() => setView('raw')}
          >
            原文
          </button>
          <button className="api-response__copy" onClick={() => void handleCopy()}>
            {copied ? '✓ 已复制' : '复制'}
          </button>
        </div>
      </div>

      <button className="api-response__headers-toggle" onClick={() => setHeadersOpen((v) => !v)}>
        <span className={`api-response__headers-chevron ${headersOpen ? 'api-response__headers-chevron--open' : ''}`}>
          {headersOpen ? '▾' : '▸'}
        </span>
        响应头（{Object.keys(response.headers).length}）
      </button>
      {headersOpen && (
        <div className="api-response__headers">
          {Object.entries(response.headers).map(([k, v]) => (
            <div key={k} className="api-response__header-row">
              <span className="api-response__header-key">{k}</span>
              <span className="api-response__header-value" title={v}>{v}</span>
            </div>
          ))}
        </div>
      )}

      <pre className="api-response__body">{displayBody || '（空响应体）'}</pre>
    </div>
  )
}
