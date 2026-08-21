import { useEffect, useState } from 'react'
import type { ApiToolSettings } from '@shared/apiTool'

interface ApiSettingsDialogProps {
  settings: ApiToolSettings
  onSave: (settings: ApiToolSettings) => void
  onClose: () => void
}

/**
 * API 调试网络设置（v1.25.1）— the intranet survival kit: proxy mode,
 * certificate verification, and request timeout. Opens from the ApiToolApp
 * header gear button.
 */
export default function ApiSettingsDialog({ settings, onSave, onClose }: ApiSettingsDialogProps): JSX.Element {
  const [proxyMode, setProxyMode] = useState<ApiToolSettings['proxyMode']>(settings.proxyMode)
  const [ignoreCert, setIgnoreCert] = useState(settings.ignoreCert)
  const [timeoutSec, setTimeoutSec] = useState(String(Math.round(settings.timeoutMs / 1000)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = (): void => {
    const sec = parseInt(timeoutSec, 10)
    const timeoutMs = Number.isNaN(sec) ? 30000 : Math.min(Math.max(sec, 1), 300) * 1000
    onSave({ proxyMode, ignoreCert, timeoutMs })
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal api-settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">网络设置（内网选项）</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">
          <div className="field">
            <label className="field__label">代理模式</label>
            <div className="radio-group">
              <label className="radio-group__item">
                <input
                  type="radio"
                  name="apiProxyMode"
                  checked={proxyMode === 'system'}
                  onChange={() => setProxyMode('system')}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
                <span className="field__row-text">系统代理（默认，走浏览器同款代理配置）</span>
              </label>
              <label className="radio-group__item">
                <input
                  type="radio"
                  name="apiProxyMode"
                  checked={proxyMode === 'direct'}
                  onChange={() => setProxyMode('direct')}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
                <span className="field__row-text">直连（不走代理，推荐内网地址）</span>
              </label>
            </div>
            <div className="field__hint">
              内网地址被公司代理拦截（如 ERR_TUNNEL_CONNECTION_FAILED / ERR_PROXY_CONNECTION_FAILED）时切换为直连。
            </div>
          </div>

          <div className="settings-divider" />

          <div className="field">
            <label className="field__row" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={ignoreCert}
                onChange={(e) => setIgnoreCert(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
              />
              <span className="field__row-text">
                忽略 TLS 证书校验
                <br />
                <span className="field__hint" style={{ marginTop: 2 }}>
                  内网自签名证书 / 公司代理替换证书（ERR_CERT_AUTHORITY_INVALID 等）时开启。仅对 API 调试的请求生效，有中间人风险，请勿对不可信地址开启。
                </span>
              </span>
            </label>
          </div>

          <div className="settings-divider" />

          <div className="field">
            <label className="field__label">超时（秒）</label>
            <div className="field__row">
              <input
                className="input"
                type="number"
                min={1}
                max={300}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(e.target.value)}
                style={{ width: 100 }}
              />
              <span className="field__hint" style={{ marginBottom: 0 }}>1–300 秒，默认 30</span>
            </div>
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  )
}
