import { useState, useEffect } from 'react'
import type { AppConfig } from '@shared/types'
import { BUNDLED_HOLIDAY_YEARS } from '../lib/workday'

interface ConfigModalProps {
  config: AppConfig
  onSave: (config: AppConfig) => void
  onClose: () => void
  /** Trigger Markdown export (moved here from the toolbar — not a frequent action) */
  onExportMarkdown: () => void
  /** Total task count, shown in the export button hint */
  taskCount: number
  /** Years the user has fetched (persisted); takes precedence over bundled. */
  loadedHolidayYears: number[]
  /** Fetch + persist one year's official holiday data. */
  onFetchHolidays: (year: number) => Promise<void>
}

type FetchStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; msg: string } | { kind: 'error'; msg: string }

export default function ConfigModal({
  config,
  onSave,
  onClose,
  onExportMarkdown,
  taskCount,
  loadedHolidayYears,
  onFetchHolidays
}: ConfigModalProps): JSX.Element {
  const [apiUrl, setApiUrl] = useState(config.apiUrl)
  const [apiKey, setApiKey] = useState(config.apiKey)
  const [model, setModel] = useState(config.model)
  const [showKey, setShowKey] = useState(false)
  const [exportHint, setExportHint] = useState<string>('')

  const nextYear = new Date().getFullYear() + 1
  const [yearInput, setYearInput] = useState<string>(String(nextYear))
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({ kind: 'idle' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSave = (): void => {
    onSave({
      apiUrl: apiUrl.trim(),
      apiKey: apiKey.trim(),
      model: model.trim()
    })
  }

  const handleExport = (): void => {
    onExportMarkdown()
    setExportHint('已为你打开保存对话框')
    window.setTimeout(() => setExportHint(''), 2500)
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

  // Display set of available years: bundled + user-fetched (fetched wins the label)
  const fetchedSet = new Set(loadedHolidayYears)
  const allYears = Array.from(new Set([...BUNDLED_HOLIDAY_YEARS, ...loadedHolidayYears])).sort((a, b) => a - b)

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">设置</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal__body">
          <div className="settings-section-title">AI 模型</div>

          <div className="field">
            <label className="field__label">API 地址 (Base URL)</label>
            <input
              className="input"
              placeholder="https://api.openai.com/v1"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              autoFocus
            />
            <div className="field__hint">
              基于 OpenAI 协议的接口地址，通常以 /v1 结尾，无需包含 /chat/completions
            </div>
          </div>

          <div className="field">
            <label className="field__label">API Key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type={showKey ? 'text' : 'password'}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button
                type="button"
                className="btn btn--ghost"
                style={{ flexShrink: 0 }}
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <div className="field__hint">密钥仅保存在本地，不会上传到任何服务器</div>
          </div>

          <div className="field">
            <label className="field__label">模型名称 (Model)</label>
            <input
              className="input"
              placeholder="gpt-4o-mini"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <div className="field__hint">例如：gpt-4o-mini、gpt-4o、deepseek-chat 等</div>
          </div>

          <div className="settings-divider" />

          <div className="settings-section-title">节假日数据</div>

          <div className="field">
            <label className="field__label">按年份更新</label>
            <div className="field__row">
              <input
                className="input"
                type="number"
                min={2000}
                max={2100}
                value={yearInput}
                onChange={(e) => setYearInput(e.target.value)}
                style={{ maxWidth: 120 }}
              />
              <button
                type="button"
                className="btn btn--primary"
                style={{ flexShrink: 0 }}
                onClick={handleFetchHolidays}
                disabled={fetchStatus.kind === 'loading'}
              >
                {fetchStatus.kind === 'loading' ? '更新中…' : '更新节假日'}
              </button>
            </div>
            <div className="field__hint">
              从权威接口拉取该年法定节假日与调休补班，存到本地后离线可用。每年国务院发布次年安排（约 11 月）后更新一次即可，无需更换应用版本。
            </div>
            {fetchStatus.kind === 'success' && (
              <div className="field__hint field__hint--success">{fetchStatus.msg}</div>
            )}
            {fetchStatus.kind === 'error' && (
              <div className="field__hint field__hint--error">{fetchStatus.msg}</div>
            )}
          </div>

          <div className="field">
            <label className="field__label">已加载年份</label>
            <div className="holiday-years">
              {allYears.length === 0 ? (
                <span className="holiday-years__empty">暂无</span>
              ) : (
                allYears.map((y) => (
                  <span key={y} className={`holiday-year ${fetchedSet.has(y) ? 'holiday-year--updated' : ''}`}>
                    {y}
                    <span className="holiday-year__tag">
                      {fetchedSet.has(y) ? '已更新' : '内置'}
                    </span>
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="settings-divider" />

          <div className="settings-section-title">数据</div>

          <div className="field">
            <label className="field__label">导出 Markdown</label>
            <div className="field__row">
              <div className="field__row-text">
                把全部 {taskCount} 个任务按四象限分组导出为 .md 文件，便于归档或分享。
              </div>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ flexShrink: 0 }}
                onClick={handleExport}
                disabled={taskCount === 0}
              >
                导出 .md
              </button>
            </div>
            {exportHint && <div className="field__hint">{exportHint}</div>}
          </div>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSave}
            disabled={!apiUrl.trim() || !model.trim()}
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}
