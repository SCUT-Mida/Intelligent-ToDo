import { useState, useEffect } from 'react'
import { useAppContext } from '../store/AppContext'
import GeneralSettings from './GeneralSettings'
import TodoSettings from './TodoSettings'
import RepoNavSettings from './RepoNavSettings'

type SettingsTab = 'general' | 'todo' | 'repoNav'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '通用' },
  { id: 'todo', label: '智能代办' },
  { id: 'repoNav', label: '仓库导航' }
]

/**
 * Unified settings modal with left sidebar navigation.
 * Width: 720px, height: 560px.
 * Contains GeneralSettings, TodoSettings, RepoNavSettings panels.
 */
export default function UnifiedSettingsModal(): JSX.Element {
  const { state, closeSettings, updateConfig } = useAppContext()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSettings])

  return (
    <div className="overlay" onMouseDown={closeSettings}>
      <div className="unified-settings modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">设置</div>
          <button className="modal__close" onClick={closeSettings} aria-label="关闭">×</button>
        </div>

        <div className="unified-settings__body">
          {/* Left sidebar */}
          <nav className="unified-settings__sidebar">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`unified-settings__tab ${activeTab === tab.id ? 'unified-settings__tab--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="unified-settings__content">
            {activeTab === 'general' && (
              <GeneralSettings
                config={state.data.config}
                onSave={updateConfig}
              />
            )}
            {activeTab === 'todo' && (
              <TodoSettings
                data={state.data}
              />
            )}
            {activeTab === 'repoNav' && (
              <RepoNavSettings />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
