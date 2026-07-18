import { useState, useEffect, useCallback } from 'react'
import type { AppConfig } from '@shared/types'
import type { AiConfigScanResult, AiProviderConfig, AiProviderModel } from '@shared/aiConfig'
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
 * The AI section now offers one-click import from the user's existing
 * opencode.json config (~/.config/opencode/opencode.json) so they don't have
 * to re-type provider URL / API key / model name.
 */
export default function GeneralSettings({ config, onSave }: GeneralSettingsProps): JSX.Element {
  const { state } = useAppContext()
  const [apiUrl, setApiUrl] = useState(config.apiUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [showKey, setShowKey] = useState(false)

  // AI config scan state
  const [aiScan, setAiScan] = useState<AiConfigScanResult | null>(null)
  const [aiScanLoading, setAiScanLoading] = useState(false)
  const [aiScanError, setAiScanError] = useState<string | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [importHint, setImportHint] = useState<string | null>(null)

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

  // Auto-scan AI configs on mount (best-effort, don't block UI)
  useEffect(() => {
    void (async () => {
      setAiScanLoading(true)
      try {
        const result = await window.api.scanAiConfigs()
        setAiScan(result)
      } catch (e) {
        setAiScanError(e instanceof Error ? e.message : String(e))
      } finally {
        setAiScanLoading(false)
      }
    })()
  }, [])

  const handleSave = (): void => {
    onSave({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })
  }

  const handleImport = useCallback((provider: AiProviderConfig, modelEntry: AiProviderModel): void => {
    if (!provider.baseURL) {
      setImportHint(`⚠️ ${provider.displayName} 未提供 baseURL，请手动填写 API 地址`)
      window.setTimeout(() => setImportHint(null), 4000)
      return
    }
    setApiUrl(provider.baseURL)
    setApiKey(provider.apiKey)
    setModel(modelEntry.modelId)
    setImportHint(`✓ 已从 ${provider.displayName} 导入：${modelEntry.displayName ?? modelEntry.modelId}`)
    window.setTimeout(() => setImportHint(null), 4000)
  }, [])

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

  const hasAiProviders = (aiScan?.providers?.length ?? 0) > 0

  return (
    <div className="general-settings">
      {/* AI 模型 */}
      <Section title="AI 模型" icon="🤖" label="AI 配置">
        {/* Import panel — shown when there are providers to import from */}
        {(hasAiProviders || aiScanLoading || aiScanError) && (
          <div className="ai-import-panel">
            <div className="ai-import-panel__head">
              <span className="ai-import-panel__title">从已有配置导入</span>
              <span className="ai-import-panel__source">📦 opencode.json</span>
            </div>
            <div className="ai-import-panel__body">
              {aiScanLoading && <div className="field__hint">正在扫描…</div>}
              {!aiScanLoading && aiScanError && (
                <div className="field__hint field__hint--error">扫描失败：{aiScanError}</div>
              )}
              {!aiScanLoading && !aiScanError && hasAiProviders && (
                <div className="ai-import-list">
                  {aiScan!.providers.map((provider) => {
                    const isExpanded = expandedProvider === provider.providerId
                    const hasModels = provider.models.length > 0
                    return (
                      <div key={provider.providerId} className="ai-import-provider">
                        <button
                          type="button"
                          className="ai-import-provider__head"
                          onClick={() => hasModels && setExpandedProvider(isExpanded ? null : provider.providerId)}
                          disabled={!hasModels}
                        >
                          <span className={`ai-import-provider__chevron ${isExpanded ? 'ai-import-provider__chevron--open' : ''}`}>
                            {hasModels ? '›' : '·'}
                          </span>
                          <span className="ai-import-provider__name">{provider.displayName}</span>
                          {!provider.baseURL && (
                            <span className="ai-import-provider__badge ai-import-provider__badge--warn">无 URL</span>
                          )}
                          {provider.baseURLInferred && (
                            <span className="ai-import-provider__badge">URL 推断</span>
                          )}
                          <span className="ai-import-provider__count">
                            {hasModels ? `${provider.models.length} 个模型` : '无模型'}
                          </span>
                        </button>
                        {isExpanded && hasModels && (
                          <div className="ai-import-models">
                            {provider.models.map((m) => (
                              <button
                                key={m.modelId}
                                type="button"
                                className="ai-import-model"
                                onClick={() => handleImport(provider, m)}
                                title={provider.baseURL ? `导入 ${m.modelId}` : '该 provider 未提供 baseURL'}
                              >
                                <span className="ai-import-model__id">{m.displayName ?? m.modelId}</span>
                                {m.displayName && m.displayName !== m.modelId && (
                                  <span className="ai-import-model__raw">{m.modelId}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {!aiScanLoading && !aiScanError && !hasAiProviders && aiScan && (
                <div className="field__hint">
                  未发现可导入的 provider。配置文件路径：{aiScan.scannedPaths.join('；') || '（未找到）'}
                </div>
              )}
              {aiScan && aiScan.errors.length > 0 && (
                <div className="field__hint" style={{ marginTop: 6 }}>
                  {aiScan.errors[0]}
                </div>
              )}
            </div>
            {importHint && (
              <div className={`field__hint ${importHint.startsWith('✓') ? 'field__hint--success' : 'field__hint--error'}`} style={{ marginTop: 6 }}>
                {importHint}
              </div>
            )}
          </div>
        )}

        <div className="settings-divider" />

        {/* Manual entry fields (unchanged) */}
        <div className="field">
          <label className="field__label">API 地址 (Base URL)</label>
          <input className="input" placeholder="https://api.openai.com/v1" value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)} />
          <div className="field__hint">基于 OpenAI 协议的接口地址，通常以 /v1 结尾</div>
        </div>
        <div className="field">
          <label className="field__label">API Key</label>
          <div className="field__row">
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
      <Section title="应用更新" icon="🔄" label="应用" defaultOpen={false}>
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
