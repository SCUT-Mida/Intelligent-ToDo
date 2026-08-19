import { Suspense, lazy } from 'react'
import { useAppContext } from './store/AppContext'
import ActivityBar from './components/ActivityBar'
import UnifiedSettingsModal from './settings/UnifiedSettingsModal'

// Lazy-load apps for smaller initial bundle
const TodoApp = lazy(() => import('./apps/todoApp/TodoApp'))
const RepoNavApp = lazy(() => import('./apps/repoNavApp/RepoNavApp'))
const AgentHubApp = lazy(() => import('./apps/agentHubApp/AgentHubApp'))
const ApiToolApp = lazy(() => import('./apps/apiToolApp/ApiToolApp'))

function LoadingFallback(): JSX.Element {
  return (
    <div className="app-shell__loading">
      <div className="spinner" />
      <div>加载中...</div>
    </div>
  )
}

/**
 * All sub-apps are always mounted — only the active one is visible.
 * This ensures AgentHubApp's PTY processes survive across app switches
 * and window minimize. Hidden apps use position:absolute + display:none
 * so they don't affect layout.
 */
export default function AppShell(): JSX.Element {
  const { state } = useAppContext()

  return (
    <div className="app-shell">
      <ActivityBar />
      <main className="app-shell__content">
        <Suspense fallback={<LoadingFallback />}>
          <div className="app-shell__app-stack">
            {(['todo', 'repoNav', 'agentHub', 'apiTool'] as const).map((name) => (
              <div
                key={name}
                className="app-shell__app-layer"
                style={{ display: state.activeApp === name ? 'flex' : 'none' }}
              >
                {name === 'todo' && <TodoApp />}
                {name === 'repoNav' && <RepoNavApp />}
                {name === 'agentHub' && <AgentHubApp />}
                {name === 'apiTool' && <ApiToolApp />}
              </div>
            ))}
          </div>
        </Suspense>
      </main>
      {state.settingsOpen && <UnifiedSettingsModal />}
    </div>
  )
}
