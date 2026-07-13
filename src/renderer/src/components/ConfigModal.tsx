import { useState, useEffect, type ReactNode } from 'react'
import type { AppConfig } from '@shared/types'
import { BUNDLED_HOLIDAY_YEARS } from '@shared/workday'

interface ConfigModalProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
  onClose: () => void
  onExportMarkdown: () => void
  taskCount: number
  loadedHolidayYears: number[]
  onFetchHolidays: (year: number) => Promise<void>
  onInstallUpdate: () => Promise<void>
  /** Company rule: last Saturday of month is a workday. */
  companyLastSaturday: boolean
  onToggleCompanyLastSaturday: (v: boolean) => void
}

type FetchStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; msg: string } | { kind: 'error'; msg: string }

type UpdateState =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'available'; version: string; notes?: string }
  | { stage: 'latest' }
  | { stage: 'downloading'; percent: number }
  | { stage: 'downloaded' }
  | { stage: 'error'; message: string }

/** Collapsible settings section with a clickable header and chevron. */
function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="settings-section">
      <button type="button" className="settings-section__head" onClick={() => setOpen((v) => !v)}>
        <span className={`settings-section__chevron ${open ? 'settings-section__chevron--open' : ''}`}>›</span>
        {title}
      </button>
      {open && <div className="settings-section__body">{children}</div>}
    </div>
  )
}

export default function ConfigModal({
  config,
  onSave,
  onClose,
  onExportMarkdown,
  taskCount,
  loadedHolidayYears,
  onFetchHolidays,
  onInstallUpdate,
  companyLastSaturday,
  onToggleCompanyLastSaturday
}: ConfigModalProps): JSX.Element {
  const [apiUrl, setApiUrl] = useState(config.apiUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [showKey, setShowKey] = useState(false)
  const [exportHint, setExportHint] = useState<string>('')

  const nextYear = new Date().getFullYear() + 1
  const [yearInput, setYearInput] = useState<string>(String(nextYear))
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({ kind: 'idle' })

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = (): void => {
    onSave({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim(), model: model.trim() })
  }

  const handleExport = (): void => {
    onExportMarkdown()
    setExportHint('已为你打开保存对话框')
    window.setTimeout(() => setExportHint(''), 2500)
  }

  const handleCheckUpdate = (): void => {
    setUpdateState({ stage: 'checking' })
    window.api.checkForUpdates().catch(() => setUpdateState({ stage: 'error', message: '检查更新失败' }))
  }
  const handleDownload = (): void => {
    window.api.downloadUpdate().catch(() => setUpdateState({ stage: 'error', message: '下载失败' }))
  }
  const handleInstall = async (): Promise<void> => {
    try { await onInstallUpdate() } catch { setUpdateState({ stage: 'error', message: '安装前保存失败，请重试' }) }
  }

  const handleFetchHolidays = async (): Promise<void> => {
    const year = parseInt(yearInput, 10)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setFetchStatus({ kind: 'error', msg: '请输入有效的年份（2000-2100）' })
      return
    }
    setFetchStatus({ kind: 'loading' })
    try {
      await onFetchHolidays(year)
      setFetchStatus({ kind: 'success', msg: `${year} 年节假日已更新并保存到本地，离线可用` })
    } catch (e) {
      setFetchStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const fetchedSet = new Set(loadedHolidayYears)
  const allYears = Array.from(new Set([...BUNDLED_HOLIDAY_YEARS, ...loadedHolidayYears])).sort((a, b) => a - b)

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">设置</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">

          {/* ── 应用更新 ── */}
          <Section title="应用更新">
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
                  {updateState.notes && (
                    <div className="update-notice__notes">{updateState.notes}</div>
                  )}
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

          {/* ── 工作日与节假日 ── */}
          <Section title="工作日与节假日" defaultOpen={false}>
            <div className="field">
              <label className="field__row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={companyLastSaturday}
                  onChange={(e) => onToggleCompanyLastSaturday(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                />
                <span className="field__row-text">
                  月末最后一个周六计为工作日（贵司规则）
                  <br />
                  <span className="field__hint" style={{ marginTop: 2 }}>
                    勾选后该日按工作日处理（日历橙色标记）；取消勾选则恢复为普通周末，适用于非贵司用户。
                  </span>
                </span>
              </label>
            </div>

            <div className="settings-divider" />

            <div className="field">
              <label className="field__label">按年份更新节假日</label>
              <div className="field__row">
                <input className="input" type="number" min={2000} max={2100} value={yearInput}
                  onChange={(e) => setYearInput(e.target.value)} style={{ maxWidth: 120 }} />
                <button type="button" className="btn btn--primary" style={{ flexShrink: 0 }}
                  onClick={handleFetchHolidays} disabled={fetchStatus.kind === 'loading'}>
                  {fetchStatus.kind === 'loading' ? '更新中…' : '更新节假日'}
                </button>
              </div>
              <div className="field__hint">从权威接口拉取该年法定节假日与调休补班，存到本地后离线可用。每年约 11 月国务院发布后更新一次即可。</div>
              {fetchStatus.kind === 'success' && <div className="field__hint field__hint--success">{fetchStatus.msg}</div>}
              {fetchStatus.kind === 'error' && <div className="field__hint field__hint--error">{fetchStatus.msg}</div>}
            </div>
            <div className="field">
              <label className="field__label">已加载年份</label>
              <div className="holiday-years">
                {allYears.length === 0 ? (
                  <span className="holiday-years__empty">暂无</span>
                ) : (
                  allYears.map((y) => (
                    <span key={y} className={`holiday-year ${fetchedSet.has(y) ? 'holiday-year--updated' : ''}`}>
                      {y}<span className="holiday-year__tag">{fetchedSet.has(y) ? '已更新' : '内置'}</span>
                    </span>
                  ))
                )}
              </div>
            </div>
          </Section>

          {/* ── AI 模型 ── */}
          <Section title="AI 模型" defaultOpen={false}>
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
          </Section>

          {/* ── 数据 ── */}
          <Section title="数据" defaultOpen={false}>
            <div className="field">
              <label className="field__label">导出 Markdown</label>
              <div className="field__row">
                <div className="field__row-text">把全部 {taskCount} 个任务按四象限分组导出为 .md 文件。</div>
                <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }}
                  onClick={handleExport} disabled={taskCount === 0}>导出 .md</button>
              </div>
              {exportHint && <div className="field__hint">{exportHint}</div>}
            </div>
          </Section>

        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>取消</button>
          <button className="btn btn--primary" onClick={handleSave} disabled={!apiUrl.trim() || !model.trim()}>
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}
