import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, Task, AppConfig, LoadResult, AiPriorityResult, YearHolidayData } from '../shared/types'

/** Update lifecycle events forwarded from main's electron-updater. */
export type UpdateEvent =
  | { stage: 'checking' }
  | { stage: 'available'; version: string }
  | { stage: 'latest' }
  | { stage: 'downloading'; percent: number }
  | { stage: 'downloaded' }
  | { stage: 'error'; message: string }

const api = {
  loadData: (): Promise<LoadResult> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  aiRecommend: (
    tasks: Task[],
    config: AppConfig,
    holidayOverrides?: Record<number, YearHolidayData>
  ): Promise<AiPriorityResult> => ipcRenderer.invoke('ai:recommend', tasks, config, holidayOverrides),
  fetchHolidays: (year: number): Promise<YearHolidayData> =>
    ipcRenderer.invoke('holidays:fetch', year),
  exportMarkdown: (content: string, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke('md:export', content, defaultName),
  // ---- auto-update ----
  getAppStatus: (): { version: string; isPackaged: boolean } =>
    ipcRenderer.sendSync('app:status'),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:install'),
  onUpdateEvent: (cb: (e: UpdateEvent) => void): (() => void) => {
    const handler = (_e: unknown, payload: UpdateEvent): void => cb(payload)
    ipcRenderer.on('update:event', handler)
    return () => ipcRenderer.removeListener('update:event', handler as never)
  }
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
