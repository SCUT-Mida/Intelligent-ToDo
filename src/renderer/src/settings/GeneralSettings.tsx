import { useState, useEffect, useCallback, useMemo } from 'react'
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
 * General settings: AI model selection + app updates.
 *
 * The AI section auto-discovers providers/models from the user's opencode.json
 * and presents them as a clickable tree. Clicking a model selects it
 * immediately (no separate "save" step) — this is the ONLY way to configure
 * AI in this app, by design. If a user lacks opencode.json, they're guided
 * to set one up (rather than forcing them to type URL/Key/Model by hand).
 */
export default function GeneralSettings({ config, onSave }: GeneralSettingsProps): JSX.Element {
  const { state } = useAppContext()
  const [aiScan, setAiScan] = useState<AiConfigScanResult | null>(null)
  const [aiScanLoading, setAiScanLoading] = useState(false)
  const [aiScanError, setAiScanError] = useState<string | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [selectHint, setSelectHint] = useState<string | null>(null)

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
        // Auto-expand the provider that matches the current config (if any),
        // so the user sees which one is active at a glance.
        const currentProvider = result.providers.find((p) =>
          p.apiKey === config.apiKey && (p.baseURL === config.apiUrl || !config.apiUrl)
        )
        if (currentProvider) {
          setExpandedProvider(currentProvider.providerId)
        } else if (result.providers.length === 1) {
          // Only one provider — auto-expand for quick selection
          setExpandedProvider(result.providers[0].providerId)
        }
      } catch (e) {
        setAiScanError(e instanceof Error ? e.message : String(e))
      } finally {
        setAiScanLoading(false)
      }
    })()
  }, [config.apiKey, config.apiUrl])

  /**
   * Check if a given provider+model combo matches the currently active config.
   * Used to show a "当前使用" highlight in the list.
   */
  const isCurrentModel = useCallback((provider: AiProviderConfig, modelEntry: AiProviderModel): boolean => {
    return (
      config.model === modelEntry.modelId &&
      config.apiKey === provider.apiKey &&
      (!!provider.baseURL && config.apiUrl === provider.baseURL)
    )
  }, [config.apiKey, config.apiUrl, config.model])

  const handleSelectModel = useCallback((provider: AiProviderConfig, modelEntry: AiProviderModel): void => {
    if (!provider.baseURL) {
      setSelectHint(`⚠️ ${provider.displayName} 未提供 baseURL，无法使用。请检查 opencode.json 配置`)
      window.setTimeout(() => setSelectHint(null), 5000)
      return
    }
    if (isCurrentModel(provider, modelEntry)) return // already selected

    onSave({
      apiUrl: provider.baseURL,
      apiKey: provider.apiKey,
      model: modelEntry.modelId
    })
    setSelectHint(`✓ 已切换到 ${provider.displayName} / ${modelEntry.displayName ?? modelEntry.modelId}`)
    window.setTimeout(() => setSelectHint(null), 3000)
  }, [isCurrentModel, onSave])

  // Determine if the active config matches any discovered provider (for "当前使用" label)
  const activeProviderInfo = useMemo(() => {
    if (!aiScan) return null
    for (const p of aiScan.providers) {
      if (p.apiKey === config.apiKey && p.baseURL === config.apiUrl) {
        const activeModel = p.models.find((m) => m.modelId === config.model)
        return activeModel
          ? { provider: p.displayName, model: activeModel.displayName ?? activeModel.modelId }
          : { provider: p.displayName, model: config.model }
      }
    }
    return null
  }, [aiScan, config.apiKey, config.apiUrl, config.model])

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
  void state

  const hasAiProviders = (aiScan?.providers?.length ?? 0) > 0

  return (
    <div className="general-settings">
      {/* AI 模型 */}
      <Section title="AI 模型" icon="🤖" label="AI 配置">
        {/* Current effective config — compact, informative */}
        {activeProviderInfo && (
          <div className="ai-current-summary">
            <span className="ai-current-summary__label">当前使用</span>
            <span className="ai-current-summary__value">
              {activeProviderInfo.provider} · {activeProviderInfo.model}
            </span>
          </div>
        )}

        {/* Provider/model selector — replaces manual URL/Key/Model entry */}
        <div className="ai-import-panel">
          <div className="ai-import-panel__head">
            <span className="ai-import-panel__title">从 opencode.json 选择</span>
            <span className="ai-import-panel__source">📦 ~/.config/opencode/opencode.json</span>
          </div>
          <div className="ai-import-panel__body">
            {aiScanLoading && <div className="field__hint">正在扫描…</div>}
            {!aiScanLoading && aiScanError && (
              <div className="field__hint field__hint--error">扫描失败：{aiScanError}</div>
            )}
            {!aiScanLoading && !aiScanError && !hasAiProviders && aiScan && (
              <div className="ai-import-empty">
                <div className="field__hint">
                  未发现可用的 AI 配置。请在 <code className="inline-code">~/.config/opencode/opencode.json</code> 中配置 provider，
                  例如：
                </div>
                <pre className="ai-import-empty__example">{`{
  "provider": {
    "deepseek": {
      "options": { "apiKey": "sk-..." }
    }
  }
}`}</pre>
                <div className="field__hint">
                  配置好后回到本页面会自动发现。也可参考
                  <a className="inline-link" href="https://opencode.ai/docs/config" target="_blank" rel="noreferrer">
                    opencode 配置文档
                  </a>。
                </div>
              </div>
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
                        className={`ai-import-provider__head ${isExpanded ? 'ai-import-provider__head--active' : ''}`}
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
                          {provider.models.map((m) => {
                            const isCurrent = isCurrentModel(provider, m)
                            return (
                              <button
                                key={m.modelId}
                                type="button"
                                className={`ai-import-model ${isCurrent ? 'ai-import-model--current' : ''}`}
                                onClick={() => handleSelectModel(provider, m)}
                                title={isCurrent ? '当前使用' : provider.baseURL ? `切换到 ${m.modelId}` : '该 provider 未提供 baseURL'}
                              >
                                <span className="ai-import-model__id">{m.displayName ?? m.modelId}</span>
                                {m.displayName && m.displayName !== m.modelId && (
                                  <span className="ai-import-model__raw">{m.modelId}</span>
                                )}
                                {isCurrent && (
                                  <span className="ai-import-model__current">✓ 当前</span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            {aiScan && aiScan.errors.length > 0 && (
              <div className="field__hint" style={{ marginTop: 6 }}>
                {aiScan.errors[0]}
              </div>
            )}
          </div>
          {selectHint && (
            <div className={`field__hint ${selectHint.startsWith('✓') ? 'field__hint--success' : 'field__hint--error'}`} style={{ marginTop: 6, padding: '0 14px 8px' }}>
              {selectHint}
            </div>
          )}
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
