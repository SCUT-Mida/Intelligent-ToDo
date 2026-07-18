import { Suspense, lazy } from 'react'
import { useAppContext } from './store/AppContext'
import ActivityBar from './components/ActivityBar'
import UnifiedSettingsModal from './settings/UnifiedSettingsModal'

// Lazy-load apps for smaller initial bundle
const TodoApp = lazy(() => import('./apps/todoApp/TodoApp'))
const RepoNavApp = lazy(() => import('./apps/repoNavApp/RepoNavApp'))

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

  const renderActiveApp = (): JSX.Element => {
    switch (state.activeApp) {
      case 'todo':
        return <TodoApp />
      case 'repoNav':
        return <RepoNavApp />
      default:
        return <TodoApp />
    }
  }

  return (
    <div className="app-shell">
      <ActivityBar />
      <main className="app-shell__content">
        <Suspense fallback={<LoadingFallback />}>
          {renderActiveApp()}
        </Suspense>
      </main>
      {state.settingsOpen && <UnifiedSettingsModal />}
    </div>
  )
}
