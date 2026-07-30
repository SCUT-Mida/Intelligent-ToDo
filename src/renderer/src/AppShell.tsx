import { Suspense, lazy } from 'react'
import { useAppContext } from './store/AppContext'
import ActivityBar from './components/ActivityBar'
import UnifiedSettingsModal from './settings/UnifiedSettingsModal'

// Lazy-load apps for smaller initial bundle
const TodoApp = lazy(() => import('./apps/todoApp/TodoApp'))
const RepoNavApp = lazy(() => import('./apps/repoNavApp/RepoNavApp'))
const AgentHubApp = lazy(() => import('./apps/agentHubApp/AgentHubApp'))

function LoadingFallback(): JSX.Element {
  return (
    <div className="app-shell__loading">
      <div className="spinner" />
      <div>加载中...</div>
    </div>
  )
}

export default function AppShell(): JSX.Element {
  const { state } = useAppContext()
  const isAgentHub = state.activeApp === 'agentHub'

  return (
    <div className="app-shell">
      <ActivityBar />
      <main className="app-shell__content">
        {/* Non-agentHub apps — unmount when navigating away (normal behavior) */}
        <Suspense fallback={<LoadingFallback />}>
          {!isAgentHub && (
            state.activeApp === 'todo' ? <TodoApp /> :
            state.activeApp === 'repoNav' ? <RepoNavApp /> :
            <TodoApp />
          )}
        </Suspense>

        {/* AgentHubApp is ALWAYS mounted — keeps PTY processes alive across
            app switches and window minimize. display:none when not active,
            so it takes no layout space. */}
        <Suspense fallback={null}>
          <div
            className="app-shell__agenthub"
            style={{
              display: isAgentHub ? 'flex' : 'none',
              flex: 1,
              minHeight: 0,
              overflow: 'hidden'
            }}
          >
            <AgentHubApp />
          </div>
        </Suspense>
      </main>
      {state.settingsOpen && <UnifiedSettingsModal />}
    </div>
  )
}
