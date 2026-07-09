import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, Task, AppConfig, LoadResult, AiPriorityResult, YearHolidayData } from '../shared/types'

const api = {
  loadData: (): Promise<LoadResult> => ipcRenderer.invoke('data:load'),
  saveData: (data: AppData): Promise<boolean> => ipcRenderer.invoke('data:save', data),
  aiRecommend: (tasks: Task[], config: AppConfig): Promise<AiPriorityResult> =>
    ipcRenderer.invoke('ai:recommend', tasks, config),
  fetchHolidays: (year: number): Promise<YearHolidayData> =>
    ipcRenderer.invoke('holidays:fetch', year),
  exportMarkdown: (content: string, defaultName: string): Promise<boolean> =>
    ipcRenderer.invoke('md:export', content, defaultName)
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
