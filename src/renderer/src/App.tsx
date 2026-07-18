import { AppProvider, useAppContext } from './store/AppContext'
import AppShell from './AppShell'

function AppInner(): JSX.Element {
  const { state } = useAppContext()

  if (!state.loaded) {
    return (
      <div className="app">
        <div className="ai-panel__loading" style={{ margin: 'auto' }}>
          <div className="spinner" />
          <div>加载中...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {state.loadError && (
        <div className="load-banner">
          <span>⚠ {state.loadError}</span>
          <button className="load-banner__close" onClick={() => {/* handled by context */}}>
            知道了
          </button>
        </div>
      )}
      <AppShell />
    </div>
  )
}

export default function App(): JSX.Element {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}
