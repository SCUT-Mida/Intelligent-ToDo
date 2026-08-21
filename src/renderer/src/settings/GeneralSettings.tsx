import { useState, useEffect, useCallback, useMemo } from 'react'
import type { AppConfig, SavedAiConfig, ToolPaths } from '@shared/types'
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
  const { state, dispatch } = useAppContext()
  const [aiScan, setAiScan] = useState<AiConfigScanResult | null>(null)
  const [aiScanLoading, setAiScanLoading] = useState(false)
  const [aiScanError, setAiScanError] = useState<string | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [selectHint, setSelectHint] = useState<string | null>(null)

  // Manual config fields (fallback when opencode.json isn't available)
  // Config modal state (for add/edit saved configs)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null)
  const [modalName, setModalName] = useState('')
  const [modalUrl, setModalUrl] = useState('')
  const [modalKey, setModalKey] = useState('')
  const [modalModel, setModalModel] = useState('')
  const [showModalKey, setShowModalKey] = useState(false)
  const [configHint, setConfigHint] = useState<string | null>(null)

  const [appStatus, setAppStatus] = useState<{ version: string; isPackaged: boolean } | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>({ stage: 'idle' })

  // Log file path + open-log button state
  const [logPathHint, setLogPathHint] = useState('加载中…')
  const [openLogState, setOpenLogState] = useState<
    { stage: 'idle' } | { stage: 'opening' } | { stage: 'success' } | { stage: 'error'; message: string }
  >({ stage: 'idle' })

  // Token usage (v1.22): last 7 days, per day + per source.
  const [tokenUsage, setTokenUsage] = useState<Array<{ date: string; total: number; bySource: Record<string, number> }> | null>(null)

  useEffect(() => {
    setAppStatus(window.api.getAppStatus())
    // Fetch the log file path for display.
    window.api.getLogPath().then(setLogPathHint).catch(() => setLogPathHint('(未知)'))
    // Fetch token usage summary (best-effort).
    window.api.getTokenUsage().then((r) => setTokenUsage(r.days)).catch(() => setTokenUsage(null))
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
    // Clear the modal form (if it was open) since user picked from opencode
    setConfigModalOpen(false)

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

  const savedConfigs: SavedAiConfig[] = state.data.savedAiConfigs ?? []

  const isConfigActive = useCallback((saved: SavedAiConfig): boolean => {
    return config.apiUrl === saved.apiUrl &&
      config.apiKey === saved.apiKey &&
      config.model === saved.model
  }, [config])

  // Open modal for creating a new config
  const openNewConfig = useCallback((): void => {
    setEditingConfigId(null)
    setModalName('')
    setModalUrl('')
    setModalKey('')
    setModalModel('')
    setShowModalKey(false)
    setConfigModalOpen(true)
  }, [])

  // Open modal for editing an existing config
  const openEditConfig = useCallback((saved: SavedAiConfig): void => {
    setEditingConfigId(saved.id)
    setModalName(saved.name)
    setModalUrl(saved.apiUrl)
    setModalKey(saved.apiKey)
    setModalModel(saved.model)
    setShowModalKey(false)
    setConfigModalOpen(true)
  }, [])

  // Save from modal (handles both create and update)
  const handleSaveFromModal = useCallback((): void => {
    const name = modalName.trim()
    const url = modalUrl.trim()
    const model = modalModel.trim()
    if (!url || !model) {
      setConfigHint('⚠️ API 地址和模型名称不能为空')
      window.setTimeout(() => setConfigHint(null), 4000)
      return
    }

    if (editingConfigId) {
      // Update existing
      const updated = savedConfigs.map((c) =>
        c.id === editingConfigId
          ? { ...c, name: name || model, apiUrl: url, apiKey: modalKey.trim(), model }
          : c
      )
      dispatch({ type: 'SET_DATA', payload: { ...state.data, savedAiConfigs: updated } })
      // If the edited config was active, update the active config too
      const wasActive = isConfigActive(savedConfigs.find((c) => c.id === editingConfigId)!)
      if (wasActive) {
        onSave({ apiUrl: url, apiKey: modalKey.trim(), model })
      }
      setConfigHint(`✓ 已更新「${name || model}」`)
    } else {
      // Create new
      const newConfig: SavedAiConfig = {
        id: `ai-${Date.now()}`,
        name: name || model,
        apiUrl: url,
        apiKey: modalKey.trim(),
        model
      }
      dispatch({ type: 'SET_DATA', payload: { ...state.data, savedAiConfigs: [...savedConfigs, newConfig] } })
      onSave({ apiUrl: url, apiKey: modalKey.trim(), model })
      setConfigHint(`✓ 已保存并切换到「${newConfig.name}」`)
    }
    window.setTimeout(() => setConfigHint(null), 3000)
    setConfigModalOpen(false)
  }, [editingConfigId, modalName, modalUrl, modalKey, modalModel, savedConfigs, state.data, dispatch, onSave, isConfigActive])

  const handleSelectConfig = useCallback((saved: SavedAiConfig): void => {
    if (isConfigActive(saved)) return
    onSave({ apiUrl: saved.apiUrl, apiKey: saved.apiKey, model: saved.model })
    setConfigHint(`✓ 已切换到「${saved.name}」`)
    window.setTimeout(() => setConfigHint(null), 3000)
  }, [isConfigActive, onSave])

  const handleDeleteConfig = useCallback((id: string): void => {
    dispatch({ type: 'SET_DATA', payload: { ...state.data, savedAiConfigs: savedConfigs.filter((c) => c.id !== id) } })
  }, [savedConfigs, state.data, dispatch])

  const handleOpenLogFile = async (): Promise<void> => {    setOpenLogState({ stage: 'opening' })
    try {
      const result = await window.api.openLogFile()
      if (result.ok) {
        setOpenLogState({ stage: 'success' })
        window.setTimeout(() => setOpenLogState({ stage: 'idle' }), 2500)
      } else {
        setOpenLogState({ stage: 'error', message: result.error ?? '未知错误' })
      }
    } catch (e) {
      setOpenLogState({ stage: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }
  void state

  const hasAiProviders = (aiScan?.providers?.length ?? 0) > 0

  return (
    <div className="general-settings">
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

      {/* AI 模型 */}
      <Section title="AI 模型" icon="🤖" label="AI 配置" defaultOpen={false}>
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

        {/* 手工配置 — saved profiles list + 新增 button */}
        <div className="settings-divider" />
        <div className="field">
          <div className="field__row" style={{ marginBottom: 8 }}>
            <label className="field__label" style={{ marginBottom: 0 }}>手工配置</label>
            <button type="button" className="btn btn--ghost" style={{ flexShrink: 0, fontSize: 12 }} onClick={openNewConfig}>
              + 新增
            </button>
          </div>

          {savedConfigs.length > 0 ? (
            <div className="saved-config-list">
              {savedConfigs.map((saved) => {
                const active = isConfigActive(saved)
                return (
                  <div key={saved.id} className={`saved-config ${active ? 'saved-config--active' : ''}`}>
                    <button
                      type="button"
                      className="saved-config__main"
                      onClick={() => handleSelectConfig(saved)}
                      title={active ? '当前使用' : `切换到 ${saved.name}`}
                    >
                      <span className="saved-config__name">{saved.name}</span>
                      <span className="saved-config__model">{saved.model}</span>
                      {active && <span className="saved-config__badge">✓ 当前</span>}
                    </button>
                    <button
                      type="button"
                      className="saved-config__edit"
                      onClick={() => openEditConfig(saved)}
                      title="编辑"
                    >✎</button>
                    <button
                      type="button"
                      className="saved-config__del"
                      onClick={() => handleDeleteConfig(saved.id)}
                      title="删除"
                    >×</button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="field__hint">
              暂无手工配置。点击「+ 新增」添加一个。
            </div>
          )}

          {configHint && (
            <div className={`field__hint ${configHint.startsWith('✓') ? 'field__hint--success' : 'field__hint--error'}`} style={{ marginTop: 6 }}>
              {configHint}
            </div>
          )}
        </div>
      </Section>

      {/* 用量统计 */}
      <Section title="AI 用量统计" icon="📊" label="用量" defaultOpen={false}>
        <TokenUsageCard days={tokenUsage} />
      </Section>

      {/* 通用工具路径（v1.25.5） */}
      <Section title="工具路径" icon="🛠️" label="工具" defaultOpen={false}>
        <CommonToolPathsSettings />
      </Section>

      {/* Config add/edit modal */}
      {configModalOpen && (
        <div className="overlay" onMouseDown={() => setConfigModalOpen(false)}>
          <div className="modal" style={{ width: 420 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal__header">
              <div className="modal__title">{editingConfigId ? '编辑配置' : '新增配置'}</div>
              <button className="modal__close" onClick={() => setConfigModalOpen(false)} aria-label="关闭">×</button>
            </div>
            <div className="modal__body">
              <div className="field">
                <label className="field__label">名称</label>
                <input className="input" placeholder="如：DeepSeek" value={modalName}
                  onChange={(e) => setModalName(e.target.value)} autoFocus />
              </div>
              <div className="field">
                <label className="field__label">API 地址 (Base URL)</label>
                <input className="input" placeholder="https://api.openai.com/v1" value={modalUrl}
                  onChange={(e) => setModalUrl(e.target.value)} />
              </div>
              <div className="field">
                <label className="field__label">API Key</label>
                <div className="field__row">
                  <input className="input" type={showModalKey ? 'text' : 'password'} placeholder="sk-..."
                    value={modalKey} onChange={(e) => setModalKey(e.target.value)} />
                  <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }}
                    onClick={() => setShowModalKey((v) => !v)}>{showModalKey ? '隐藏' : '显示'}</button>
                </div>
              </div>
              <div className="field">
                <label className="field__label">模型名称 (Model)</label>
                <input className="input" placeholder="gpt-4o-mini" value={modalModel}
                  onChange={(e) => setModalModel(e.target.value)} />
              </div>
            </div>
            <div className="modal__footer">
              <button className="btn btn--ghost" onClick={() => setConfigModalOpen(false)}>取消</button>
              <button className="btn btn--primary" onClick={handleSaveFromModal}
                disabled={!modalUrl.trim() || !modalModel.trim()}>
                {editingConfigId ? '保存修改' : '保存并使用'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 诊断 / 日志 */}
      <Section title="诊断日志" icon="📋" label="诊断" defaultOpen={false}>
        <div className="field">
          <div className="field__row">
            <div className="field__row-text">
              应用运行日志记录所有关键操作和错误，便于排查问题。
              <br />
              <span className="field__hint" style={{ marginTop: 4 }}>
                位置：<code className="inline-code">{logPathHint}</code>
              </span>
            </div>
            <button
              type="button"
              className="btn btn--primary"
              style={{ flexShrink: 0 }}
              onClick={handleOpenLogFile}
              disabled={openLogState.stage === 'opening'}
            >
              {openLogState.stage === 'opening' ? '打开中…' : '打开日志文件'}
            </button>
          </div>
          {openLogState.stage === 'error' && (
            <div className="field__hint field__hint--error" style={{ marginTop: 8 }}>
              {openLogState.message}
            </div>
          )}
          {openLogState.stage === 'success' && (
            <div className="field__hint field__hint--success" style={{ marginTop: 8 }}>
              ✓ 已在默认编辑器中打开
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

// ── Common tool paths (v1.25.5) ─────────────────────────────────────────────

interface ToolRowProps {
  label: string
  hint: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}

function ToolRow({ label, hint, placeholder, value, onChange }: ToolRowProps): JSX.Element {
  const [probe, setProbe] = useState<{ stage: 'idle' } | { stage: 'busy' } | { stage: 'ok' } | { stage: 'fail'; msg: string }>({ stage: 'idle' })
  const handleProbe = async (): Promise<void> => {
    const v = value.trim()
    if (!v) {
      setProbe({ stage: 'idle' })
      return
    }
    setProbe({ stage: 'busy' })
    try {
      const r = await window.repoNav.probeTool(v)
      setProbe(r.ok ? { stage: 'ok' } : { stage: 'fail', msg: r.output?.slice(0, 120) ?? '不可用' })
    } catch (e) {
      setProbe({ stage: 'fail', msg: e instanceof Error ? e.message : String(e) })
    }
  }
  const handleBrowse = async (): Promise<void> => {
    const picked = await window.repoNav.pickExecutable()
    if (picked) onChange(picked)
  }
  return (
    <div className="field">
      <label className="field__label">{label}</label>
      <div className="field__row">
        <input
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setProbe({ stage: 'idle' })
          }}
          spellCheck={false}
        />
        <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }} onClick={() => void handleBrowse()}>
          浏览
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ flexShrink: 0 }}
          onClick={() => void handleProbe()}
          disabled={!value.trim() || probe.stage === 'busy'}
        >
          {probe.stage === 'busy' ? '验证中…' : '验证'}
        </button>
      </div>
      {probe.stage === 'ok' && <div className="field__hint field__hint--success">✓ 可正常执行</div>}
      {probe.stage === 'fail' && <div className="field__hint field__hint--error">不可用：{probe.msg}</div>}
      <div className="field__hint">{hint}</div>
    </div>
  )
}

/**
 * App-wide git/node tool paths (v1.25.5) — one configuration shared by
 * RepoNav scanning, the AgentHub PTY environment (agents' git/node
 * subprocesses), task runs and diagnosis. Edits apply immediately via
 * AppContext (no separate save button).
 */
function CommonToolPathsSettings(): JSX.Element {
  const { state, dispatch } = useAppContext()
  const toolPaths: ToolPaths = state.data.toolPaths ?? {}

  const update = (patch: Partial<ToolPaths>): void => {
    dispatch({
      type: 'SET_DATA',
      payload: { ...state.data, toolPaths: { ...toolPaths, ...patch } }
    })
  }

  return (
    <div>
      <div className="field__hint" style={{ marginBottom: 12 }}>
        配置一次，全局生效（仓库导航扫描、Agent 终端环境与其内部 git/node 调用、任务模式）。
        留空则自动从系统 PATH 解析（含注册表重建）。建议在 Agent 内嵌工具报
        「git/node 不是内部或外部命令」或安装位置自定义时填写。
      </div>
      <ToolRow
        label="Git 可执行文件"
        hint="例如 D:\Tool\Git\cmd\git.exe。仓库导航中单独配置的 git 优先级更高。"
        placeholder="留空自动解析"
        value={toolPaths.git ?? ''}
        onChange={(v) => update({ git: v })}
      />
      <ToolRow
        label="Node.js 可执行文件"
        hint="例如 C:\Program Files\nodejs\node.exe。用于 Agent 的启动钩子 / MCP 服务等内部 node 调用。"
        placeholder="留空自动解析"
        value={toolPaths.node ?? ''}
        onChange={(v) => update({ node: v })}
      />
    </div>
  )
}

// ── Token usage card ────────────────────────────────────────────────────────

/** Friendly labels for the token meter's source keys. */
const USAGE_SOURCE_LABELS: Record<string, string> = {
  'todo-recommend': '今日优先分析',
  'repo-memory': '仓库 AI 记忆',
  'agent-title': '会话自动标题',
  'agent-task': 'Agent 任务'
}

function formatDayShort(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`
}

/**
 * Last-7-days token consumption, per day and per AI feature. Purely
 * informational — helps users understand what the AI features cost.
 */
function TokenUsageCard({ days }: { days: Array<{ date: string; total: number; bySource: Record<string, number> }> | null }): JSX.Element {
  if (days === null) {
    return <div className="field__hint">用量数据加载失败。</div>
  }
  const grandTotal = days.reduce((acc, d) => acc + d.total, 0)
  if (grandTotal === 0) {
    return <div className="field__hint">近 7 天暂无 AI 调用记录。</div>
  }
  const maxDay = Math.max(...days.map((d) => d.total), 1)
  return (
    <div className="token-usage">
      <div className="token-usage__total">
        近 7 天累计 <b>{grandTotal.toLocaleString()}</b> tokens
      </div>
      <div className="token-usage__bars">
        {days.map((d) => (
          <div key={d.date} className="token-usage__bar-row" title={`${d.date}：${d.total.toLocaleString()} tokens`}>
            <span className="token-usage__bar-date">{formatDayShort(d.date)}</span>
            <div className="token-usage__bar-track">
              <div className="token-usage__bar-fill" style={{ width: `${Math.round((d.total / maxDay) * 100)}%` }} />
            </div>
            <span className="token-usage__bar-value">{d.total > 0 ? d.total.toLocaleString() : ''}</span>
          </div>
        ))}
      </div>
      <div className="token-usage__sources">
        {Object.entries(
          days.reduce<Record<string, number>>((acc, d) => {
            for (const [src, n] of Object.entries(d.bySource)) {
              acc[src] = (acc[src] ?? 0) + n
            }
            return acc
          }, {})
        )
          .sort((a, b) => b[1] - a[1])
          .map(([src, n]) => (
            <span key={src} className="token-usage__chip">
              {USAGE_SOURCE_LABELS[src] ?? src} {n.toLocaleString()}
            </span>
          ))}
      </div>
    </div>
  )
}
