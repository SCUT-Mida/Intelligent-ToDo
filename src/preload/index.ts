import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, Task, AppConfig, LoadResult, AiPriorityResult, YearHolidayData } from '../shared/types'
import { IPC } from '../shared/repoNav'
import type { RepoNavConfig, OpenRepoResult, ScanResult, RepoEntry, RepoIndex, RepoUserData, ToolProbeResult } from '../shared/repoNav'
import { AI_IPC } from '../shared/aiConfig'
import type { AiConfigScanResult } from '../shared/aiConfig'
import { AGENT_IPC } from '../shared/agentHub'
import type {
  AgentDescriptor,
  AgentHubData,
  LaunchPayload,
  LaunchResult,
  AgentProbeResult
} from '../shared/agentHub'

// V2 IPC channels for AI memory features (will be moved to shared IPC_V2 when backend lands)
const IPC_V2_LOCAL = {
  REPO_GET_MEMORY: 'repoNav:getMemory',
  REPO_REGENERATE_MEMORY: 'repoNav:regenerateMemory',
  REPO_DESCRIBE_BATCH: 'repoNav:describeBatch'
} as const

/** Update lifecycle events forwarded from main's electron-updater. */
export type UpdateEvent =
  | { stage: 'checking' }
  | { stage: 'available'; version: string; notes?: string }
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
    holidayOverrides?: Record<number, YearHolidayData>,
    opts?: { companyLastSaturday?: boolean; taskCount?: number }
  ): Promise<AiPriorityResult> =>
    ipcRenderer.invoke('ai:recommend', tasks, config, holidayOverrides, opts),
  cancelAiRecommend: (): Promise<boolean> => ipcRenderer.invoke('ai:cancel'),
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
  },
  // ---- AI config discovery (scan external tool configs) ----
  scanAiConfigs: (): Promise<AiConfigScanResult> => ipcRenderer.invoke(AI_IPC.SCAN_CONFIGS),
  // ---- Application log path (for error messages / "open log folder") ----
  getLogPath: (): Promise<string> => ipcRenderer.invoke('app:getLogPath'),
  openLogFile: (): Promise<{ ok: boolean; error?: string; path: string }> => ipcRenderer.invoke('app:openLogFile')
}

try {
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}

// ── Repo Navigator API ─────────────────────────────────────────────────────

const repoNav = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke(IPC.SCAN),
  onScanProgress: (cb: (p: { current: number; total: number; name: string }) => void): (() => void) => {
    const handler = (_e: unknown, p: { current: number; total: number; name: string }): void => cb(p)
    ipcRenderer.on('repoNav:scanProgress', handler)
    return () => ipcRenderer.removeListener('repoNav:scanProgress', handler as never)
  },
  loadCachedIndex: (): Promise<RepoIndex | null> => ipcRenderer.invoke(IPC.LOAD_CACHED_INDEX),
  openRepo: (repoPath: string, command: string, mode: 'new-tab' | 'new-window'): Promise<OpenRepoResult> =>
    ipcRenderer.invoke(IPC.OPEN_REPO, repoPath, command, mode),
  getConfig: (): Promise<RepoNavConfig> => ipcRenderer.invoke(IPC.GET_CONFIG),
  saveConfig: (cfg: RepoNavConfig): Promise<boolean> => ipcRenderer.invoke(IPC.SAVE_CONFIG, cfg),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_DIRECTORY),
  pickExecutable: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_EXECUTABLE),
  getConfigPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.GET_CONFIG_PATH),
  probeTool: (kindOrBinary: string): Promise<ToolProbeResult> => ipcRenderer.invoke(IPC.PROBE_TOOL, kindOrBinary),
  getUserData: (): Promise<RepoUserData> => ipcRenderer.invoke(IPC.GET_USER_DATA),
  saveUserData: (data: RepoUserData): Promise<RepoUserData> => ipcRenderer.invoke(IPC.SAVE_USER_DATA, data),
  // V2 AI memory features
  getMemory: (): Promise<{ version: number; generatedAt: string; entries: Array<{ name: string; path: string; description: string | null; tags: string[]; generatedAt: string }> } | null> =>
    ipcRenderer.invoke(IPC_V2_LOCAL.REPO_GET_MEMORY),
  regenerateMemory: (): Promise<{ success: boolean; memory?: { version: number; generatedAt: string; entries: Array<{ name: string; path: string; description: string | null; tags: string[]; generatedAt: string }> }; error?: string }> =>
    ipcRenderer.invoke(IPC_V2_LOCAL.REPO_REGENERATE_MEMORY),
  describeBatch: (repos: RepoEntry[]): Promise<Array<{ name: string; path: string; description: string | null; tags: string[] }>> =>
    ipcRenderer.invoke(IPC_V2_LOCAL.REPO_DESCRIBE_BATCH, repos)
}

try {
  contextBridge.exposeInMainWorld('repoNav', repoNav)
} catch (error) {
  console.error(error)
}

export type Api = typeof api
export type RepoNavApi = typeof repoNav

// ── Agent Hub API ───────────────────────────────────────────────────────────

const agentHub = {
  /** Detect installed CLI agents. Returns descriptors with `detected` flags. */
  listAgents: (): Promise<AgentDescriptor[]> => ipcRenderer.invoke(AGENT_IPC.LIST_AGENTS),
  /** Load all saved sessions from disk. */
  getSessions: (): Promise<AgentHubData> => ipcRenderer.invoke(AGENT_IPC.GET_SESSIONS),
  /** Persist all sessions to disk. */
  saveSessions: (data: AgentHubData): Promise<boolean> => ipcRenderer.invoke(AGENT_IPC.SAVE_SESSIONS, data),
  /** Launch an agent in a system terminal window at the given workDir. */
  launch: (payload: LaunchPayload): Promise<LaunchResult> => ipcRenderer.invoke(AGENT_IPC.LAUNCH, payload),
  /** Show OS folder picker; returns selected path or null. */
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(AGENT_IPC.PICK_DIRECTORY),
  /** Probe a custom agent command (version check). */
  probeAgent: (command: string): Promise<AgentProbeResult> => ipcRenderer.invoke(AGENT_IPC.PROBE_AGENT, command),
  /** Load cached repo index from repoNav (for workDir dropdown). */
  getRepoIndex: (): Promise<unknown> => ipcRenderer.invoke(AGENT_IPC.GET_REPO_INDEX)
}

try {
  contextBridge.exposeInMainWorld('agentHub', agentHub)
} catch (error) {
  console.error(error)
}

export type AgentHubApi = typeof agentHub
