/**
 * Repo Navigator IPC handler registration.
 *
 * Registers all repo-navigator IPC handlers on the given ipcMain instance.
 * This is the single entry point called from src/main/index.ts.
 */

import { ipcMain, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { IPC, IPC_V2 } from '../../shared/repoNav'
import type { RepoEntry, RepoMemory } from '../../shared/repoNav'
import { getConfig, saveConfig } from './config'
import { scanRepos } from './scanner'
import { openRepoInTerminal } from './launcher'
import { generateMemoryEntries, searchRepos, loadMemory, saveMemory } from './aiMemory'
import { decryptApiKey } from '../crypto'

// ── AI config helper ───────────────────────────────────────────────────────

/**
 * Read the AI configuration (apiUrl, apiKey, model) from the main Todo app's
 * data file (todo-data.json in userData). Decrypts the apiKey on read.
 *
 * Returns null if the file doesn't exist or any field is empty.
 */
function getAIConfig(): { apiUrl: string; apiKey: string; model: string } | null {
  try {
    const dataPath = join(app.getPath('userData'), 'todo-data.json')
    if (!existsSync(dataPath)) return null

    const raw = readFileSync(dataPath, 'utf-8')
    const parsed = JSON.parse(raw) as {
      config?: { apiUrl?: string; apiKey?: string; model?: string }
    }
    if (!parsed.config) return null

    const { apiUrl, apiKey, model } = parsed.config
    if (!apiUrl || !apiKey || !model) return null

    return { apiUrl, apiKey: decryptApiKey(apiKey), model }
  } catch {
    return null
  }
}

// ── Handler registration ───────────────────────────────────────────────────

/**
 * Register all repo-navigator IPC handlers.
 *
 * Call this once during app initialization, after app.whenReady() fires.
 *
 * @param ipc - The Electron ipcMain singleton (pass the imported instance).
 */
export function registerRepoNavIpc(ipc: typeof ipcMain): void {
  // ── SCAN: rebuild the repo index ──────────────────────────────────────
  ipc.handle(IPC.SCAN, async () => {
    const config = getConfig()
    const index = await scanRepos(config)
    return {
      index,
      durationMs: 0 // duration is calculated inside scanRepos, can refine later
    }
  })

  // ── OPEN_REPO: launch terminal for a given repo path ──────────────────
  ipc.handle(IPC.OPEN_REPO, async (_e: IpcMainInvokeEvent, repoPath: string, command: string, mode: 'new-tab' | 'new-window') => {
    return await openRepoInTerminal(repoPath, command, mode)
  })

  // ── GET_CONFIG: return the current config ─────────────────────────────
  ipc.handle(IPC.GET_CONFIG, () => {
    return getConfig()
  })

  // ── SAVE_CONFIG: persist a new config ──────────────────────────────────
  ipc.handle(IPC.SAVE_CONFIG, (_e: IpcMainInvokeEvent, cfg: Parameters<typeof saveConfig>[0]) => {
    saveConfig(cfg)
    return true
  })

  // ═════════════════════════════════════════════════════════════════════
  // AI Memory IPC handlers (IPC_V2)
  // ═════════════════════════════════════════════════════════════════════

  // ── GET_MEMORY: return cached AI repo memory ──────────────────────────
  ipc.handle(IPC_V2.REPO_GET_MEMORY, () => {
    return loadMemory()
  })

  // ── REGENERATE_MEMORY: full AI description regeneration ───────────────
  ipc.handle(IPC_V2.REPO_REGENERATE_MEMORY, async () => {
    try {
      const config = getConfig()
      const index = await scanRepos(config)
      const aiConfig = getAIConfig()
      if (!aiConfig) {
        return { success: false, error: '未配置 AI 模型，请先在设置中配置' }
      }
      const entries = await generateMemoryEntries(index.repos, config, aiConfig)
      const memory: RepoMemory = {
        version: 1,
        generatedAt: new Date().toISOString(),
        entries
      }
      saveMemory(memory)
      return { success: true, memory }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // ── DESCRIBE_BATCH: generate descriptions for a pre-filtered repo list ─
  ipc.handle(IPC_V2.REPO_DESCRIBE_BATCH, async (_e: IpcMainInvokeEvent, repos: RepoEntry[]) => {
    try {
      const config = getConfig()
      const aiConfig = getAIConfig()
      if (!aiConfig) throw new Error('未配置 AI 模型')
      return await generateMemoryEntries(repos, config, aiConfig)
    } catch (err) {
      throw err // Let the caller handle errors for this streaming-like operation
    }
  })

  // ── SEARCH: semantic repo search ──────────────────────────────────────
  ipc.handle(IPC_V2.REPO_SEARCH, async (_e: IpcMainInvokeEvent, query: string) => {
    try {
      const memory = loadMemory()
      if (!memory || memory.entries.length === 0) return []
      const aiConfig = getAIConfig()
      if (!aiConfig) return []
      return await searchRepos(query, memory, aiConfig)
    } catch {
      return []
    }
  })
}
