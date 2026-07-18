import { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/types'
import Section from '../components/Section'
import { useAppContext } from '../store/AppContext'

interface GeneralSettingsProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
}

type UpdateState =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'available'; version: string; notes?: string }
  | { stage: 'latest' }
  | { stage: 'downloading'; percent: number }
  | { stage: 'downloaded' }
  | { stage: 'error'; message: string }

/**
 * General settings: AI model config + app updates.
 *
 * Note: Per-app settings (todo data export, repo-nav templates) live under
 * their respective tabs in UnifiedSettingsModal, NOT here.
 */
export default function GeneralSettings({ config, onSave }: GeneralSettingsProps): JSX.Element {
  const { state } = useAppContext()
  const [apiUrl, setApiUrl] = useState(config.apiUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [showKey, setShowKey] = useState(false)

  const [appStatus, setAppStatus] = useState<{ version: string; isPackaged: boolean } | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ stage: 'idle' })

  useEffect(() => {
    setAppStatus(window.api.getAppStatus())
    const unsub = window.api.onUpdateEvent((e) => {
      if (e.stage === 'checking') setUpdateState({ stage: 'checking' })
      else if (e.stage === 'available') setUpdateState({ stage: 'available', version: e.version, notes: e.notes })
      else if (e.stage === 'latest') setUpdateState({ stage: 'latest' })
      else if (e.stage === 'downloading') setUpdateState({ stage: 'downloading', percent: e.percent })
      else if (e.stage === 'downloaded') setUpdateState({ stage: 'downloaded' })
      else if (e.stage === 'error') setUpdateState({ stage: 'error', message: e.message })
    })
    return unsub
  }, [])

  const handleSave = (): void => {
    onSave({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })
  }

  const handleCheckUpdate = (): void => {
    setUpdateState({ stage: 'checking' })
    window.api.checkForUpdates().catch(() => setUpdateState({ stage: 'error', message: '检查更新失败' }))
  }
  const handleDownload = (): void => {
    window.api.downloadUpdate().catch(() => setUpdateState({ stage: 'error', message: '下载失败' }))
  }
  const handleInstall = async (): Promise<void> => {
    try {
      await window.api.saveData(state.data)
      window.api.installUpdate()
    } catch {
      setUpdateState({ stage: 'error', message: '安装前保存失败，请重试' })
    }
  }

  // Suppress unused-warning for state (read inside handleInstall via state.data above)
  void state

  return (
    <div className="general-settings">
      {/* AI 模型 */}
      <Section title="AI 模型">
        <div className="field">
          <label className="field__label">API 地址 (Base URL)</label>
          <input className="input" placeholder="https://api.openai.com/v1" value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)} />
          <div className="field__hint">基于 OpenAI 协议的接口地址，通常以 /v1 结尾</div>
        </div>
        <div className="field">
          <label className="field__label">API Key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" type={showKey ? 'text' : 'password'} placeholder="sk-..." value={apiKey}
              onChange={(e) => setApiKey(e.target.value)} />
            <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }}
              onClick={() => setShowKey((v) => !v)}>{showKey ? '隐藏' : '显示'}</button>
          </div>
          <div className="field__hint">密钥仅保存在本地，不会上传到任何服务器</div>
        </div>
        <div className="field">
          <label className="field__label">模型名称 (Model)</label>
          <input className="input" placeholder="gpt-4o-mini" value={model}
            onChange={(e) => setModel(e.target.value)} />
          <div className="field__hint">例如：gpt-4o-mini、gpt-4o、deepseek-chat 等</div>
        </div>
        <div className="field">
          <button type="button" className="btn btn--primary" onClick={handleSave}
            disabled={!apiUrl.trim() || !model.trim()}>
            保存 AI 配置
          </button>
        </div>
      </Section>

      {/* 应用更新 */}
      <Section title="应用更新" defaultOpen={false}>
        <div className="field">
          <div className="field__row">
            <div className="field__row-text">当前版本 <b>v{appStatus?.version ?? '…'}</b></div>
            <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }}
              onClick={handleCheckUpdate}
              disabled={updateState.stage === 'checking' || updateState.stage === 'downloading' || updateState.stage === 'downloaded'}>
              {updateState.stage === 'checking' ? '检查中…' : '检查更新'}
            </button>
          </div>

          {updateState.stage === 'available' && (
            <div className="update-notice">
              <div className="update-notice__head">发现新版本 <b>v{updateState.version}</b></div>
              {updateState.notes && <div className="update-notice__notes">{updateState.notes}</div>}
              <button type="button" className="btn btn--primary" onClick={handleDownload} style={{ marginTop: 8 }}>
                下载并安装
              </button>
            </div>
          )}

          {updateState.stage === 'downloading' && (
            <div className="update-progress">
              <div className="update-progress__bar">
                <div className="update-progress__fill" style={{ width: `${updateState.percent}%` }} />
              </div>
              <div className="field__hint">正在下载更新… {updateState.percent}%</div>
            </div>
          )}

          {updateState.stage === 'downloaded' && (
            <div className="field__row update-action" style={{ marginTop: 8 }}>
              <div className="field__hint field__hint--success">更新已下载完成，点击安装将退出应用并自动替换为新版本。</div>
              <button type="button" className="btn btn--primary" onClick={handleInstall}>退出并安装</button>
            </div>
          )}

          {updateState.stage === 'latest' && <div className="field__hint field__hint--success">✓ 已是最新版本</div>}
          {updateState.stage === 'error' && <div className="field__hint field__hint--error">{updateState.message}</div>}

          <div className="field__hint">
            {appStatus?.isPackaged
              ? '仅「安装版」支持自动更新。下载完成后点击安装将自动替换并重启。'
              : '当前为开发/未打包模式，自动更新不可用。'}
          </div>
        </div>
      </Section>
    </div>
  )
}
