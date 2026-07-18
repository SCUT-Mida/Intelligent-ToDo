import { useAppContext } from '../store/AppContext'
import type { AppId } from '../store/AppContext'

// TODO: replace with shared APP_LIST when backend lands
interface AppItem {
  id: AppId
  name: string
  icon: string
  description: string
}
const APP_LIST: AppItem[] = [
  { id: 'todo', name: '智能代办', icon: '📋', description: '任务管理看板' },
  { id: 'repoNav', name: '仓库导航', icon: '🗂', description: 'Git 仓库快速导航' }
]

export default function ActivityBar(): JSX.Element {
  const { state, setActiveApp, openSettings } = useAppContext()

  return (
    <div className="activity-bar">
      <div className="activity-bar__apps">
        {APP_LIST.map((app) => (
          <button
            key={app.id}
            className={`activity-bar__item ${state.activeApp === app.id ? 'activity-bar__item--active' : ''}`}
            onClick={() => setActiveApp(app.id)}
            title={app.description}
          >
            <span className="activity-bar__icon">{app.icon}</span>
            <span className="activity-bar__label">{app.name}</span>
          </button>
        ))}
      </div>
      <div className="activity-bar__spacer" />
      <button
        className="activity-bar__item activity-bar__settings"
        onClick={openSettings}
        title="设置"
      >
        <span className="activity-bar__icon">⚙</span>
      </button>
    </div>
  )
}
