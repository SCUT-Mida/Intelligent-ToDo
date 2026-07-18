import { useState } from 'react'
import type { AppData } from '@shared/types'
import { BUNDLED_HOLIDAY_YEARS } from '@shared/workday'
import { generateMarkdown, defaultMdFileName } from '../lib/markdown'
import Section from '../components/Section'
import { useAppContext } from '../store/AppContext'

interface TodoSettingsProps {
  data: AppData
}

type FetchStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; msg: string } | { kind: 'error'; msg: string }

/**
 * Todo-specific settings: work days, holidays, company rules, and todo data export.
 */
export default function TodoSettings({ data }: TodoSettingsProps): JSX.Element {
  const { dispatch } = useAppContext()

  const nextYear = new Date().getFullYear() + 1
  const [yearInput, setYearInput] = useState<string>(String(nextYear))
  const [fetchStatus, setFetchStatus] = useState<FetchStatus>({ kind: 'idle' })
  const [exportHint, setExportHint] = useState('')

  const handleFetchHolidays = async (): Promise<void> => {
    const year = parseInt(yearInput, 10)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      setFetchStatus({ kind: 'error', msg: '请输入有效的年份（2000-2100）' })
      return
    }
    setFetchStatus({ kind: 'loading' })
    try {
      const result = await window.api.fetchHolidays(year)
      dispatch({ type: 'SET_DATA', payload: { ...data, holidayOverrides: { ...(data.holidayOverrides ?? {}), [year]: result } } })
      setFetchStatus({ kind: 'success', msg: `${year} 年节假日已更新并保存到本地，离线可用` })
    } catch (e) {
      setFetchStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }

  const handleToggleCompanyLastSaturday = (v: boolean): void => {
    dispatch({ type: 'SET_DATA', payload: { ...data, companyLastSaturday: v } })
  }

  const handleExport = async (): Promise<void> => {
    const md = generateMarkdown(data.tasks)
    try {
      await window.api.exportMarkdown(md, defaultMdFileName())
      setExportHint('已为你打开保存对话框')
      window.setTimeout(() => setExportHint(''), 2500)
    } catch (e) {
      console.error('export failed', e)
      setExportHint('导出失败：' + (e instanceof Error ? e.message : String(e)))
      window.setTimeout(() => setExportHint(''), 3500)
    }
  }

  const loadedHolidayYears = Object.keys(data.holidayOverrides ?? {}).map(Number).sort((a, b) => a - b)
  const fetchedSet = new Set(loadedHolidayYears)
  const allYears = Array.from(new Set([...BUNDLED_HOLIDAY_YEARS, ...loadedHolidayYears])).sort((a, b) => a - b)
  const totalTasks = data.tasks.length

  return (
    <div className="todo-settings">
      {/* 工作日与节假日 */}
      <Section title="工作日与节假日">
        <div className="field">
          <label className="field__row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={data.companyLastSaturday ?? true}
              onChange={(e) => handleToggleCompanyLastSaturday(e.target.checked)}
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

      {/* 代办任务数据 */}
      <Section title="代办任务数据" defaultOpen={false}>
        <div className="field">
          <label className="field__label">导出代办任务</label>
          <div className="field__row">
            <div className="field__row-text">把全部 {totalTasks} 个代办任务按四象限分组导出为 .md 文件，便于备份或分享。</div>
            <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }}
              onClick={handleExport} disabled={totalTasks === 0}>导出任务</button>
          </div>
          {exportHint && <div className="field__hint">{exportHint}</div>}
        </div>
      </Section>
    </div>
  )
}
