import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode, type Dispatch } from 'react'
import type { AppData, AppConfig } from '@shared/types'
import { createDefaultData } from '@shared/types'

// TODO: replace with shared type when backend lands
export type AppId = 'todo' | 'repoNav'

export interface AppState {
  data: AppData
  activeApp: AppId
  settingsOpen: boolean
  aiConfigured: boolean
  loaded: boolean
  loadError: string | null
}

type Action =
  | { type: 'SET_DATA'; payload: AppData }
  | { type: 'UPDATE_CONFIG'; payload: AppConfig }
  | { type: 'SET_ACTIVE_APP'; payload: AppId }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'SET_LOADED'; payload: { loaded: boolean; error?: string | null } }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_DATA':
      return { ...state, data: action.payload }
    case 'UPDATE_CONFIG':
      return { ...state, data: { ...state.data, config: action.payload }, settingsOpen: false }
    case 'SET_ACTIVE_APP':
      return { ...state, activeApp: action.payload }
    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true }
    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false }
    case 'SET_LOADED':
      return { ...state, loaded: action.payload.loaded, loadError: action.payload.error ?? null }
    default:
      return state
  }
}

const initialState: AppState = {
  data: createDefaultData(),
  activeApp: 'todo',
  settingsOpen: false,
  aiConfigured: false,
  loaded: false,
  loadError: null
}

interface AppContextValue {
  state: AppState
  dispatch: Dispatch<Action>
  updateConfig: (config: AppConfig) => void
  setActiveApp: (app: AppId) => void
  openSettings: () => void
  closeSettings: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Load data on mount
  useEffect(() => {
    window.api
      .loadData()
      .then((result) => {
        const nextData: AppData = {
          ...result.data,
          priorities: result.data.priorities ?? [],
          pomodoro: result.data.pomodoro ?? { date: '', count: 0 },
          holidayOverrides: result.data.holidayOverrides ?? {},
          companyLastSaturday: result.data.companyLastSaturday ?? true
        }
        dispatch({ type: 'SET_DATA', payload: nextData })
        if (!result.ok) {
          dispatch({ type: 'SET_LOADED', payload: { loaded: true, error: result.error ?? '数据加载失败' } })
        } else {
          dispatch({ type: 'SET_LOADED', payload: { loaded: true } })
        }
      })
      .catch((e: unknown) => {
        console.error('load failed', e)
        dispatch({ type: 'SET_LOADED', payload: { loaded: true, error: e instanceof Error ? e.message : String(e) } })
      })
  }, [])

  // Save data on change
  useEffect(() => {
    if (!state.loaded) return
    window.api.saveData(state.data).catch((e: unknown) => console.error('save failed', e))
  }, [state.data, state.loaded])

  const updateConfig = useCallback((config: AppConfig): void => {
    dispatch({ type: 'UPDATE_CONFIG', payload: config })
  }, [])

  const setActiveApp = useCallback((app: AppId): void => {
    dispatch({ type: 'SET_ACTIVE_APP', payload: app })
  }, [])

  const openSettings = useCallback((): void => {
    dispatch({ type: 'OPEN_SETTINGS' })
  }, [])

  const closeSettings = useCallback((): void => {
    dispatch({ type: 'CLOSE_SETTINGS' })
  }, [])

  return (
    <AppContext.Provider value={{ state, dispatch, updateConfig, setActiveApp, openSettings, closeSettings }}>
      {children}
    </AppContext.Provider>
  )
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useAppContext must be used within AppProvider')
  return ctx
}
