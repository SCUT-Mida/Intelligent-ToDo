/**
 * Repo Navigator IPC handler registration.
 *
 * Registers all repo-navigator IPC handlers on the given ipcMain instance.
 * This is the single entry point called from src/main/index.ts.
 */

import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { readFileSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { IPC, IPC_V2 } from '../../shared/repoNav'
import type { RepoEntry, RepoMemory, RepoIndex, ToolProbeResult } from '../../shared/repoNav'
import { DEFAULT_TOOL_BINARIES, classifyLlmError } from '../../shared/repoNav'
import type { ToolKind } from '../../shared/repoNav'
import { getConfig, saveConfig, getConfigPath } from './config'
import { scanRepos } from './scanner'
import { openRepoInTerminal } from './launcher'
import { generateMemoryEntries, loadMemory, saveMemory } from './aiMemory'
import { getUserData, saveUserData, incrementOpenCount } from './userData'
import { dataFilePath } from './paths'
import { decryptApiKey } from '../crypto'
import { logger } from '../logger'
import type { RepoUserData } from '../../shared/repoNav'

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
  // Async + batched: the scanner yields between batches so the main process
  // stays responsive (Todo app IPC works during scan). Progress is pushed
  // to the renderer via webContents.send for the progress bar.
  ipc.handle(IPC.SCAN, async (event) => {
    const config = getConfig()
    const sender = event.sender
    const index = await scanRepos(config, (current, total, name) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('repoNav:scanProgress', { current, total, name })
        }
      } catch { /* ignore send errors */ }
    })
    return { index, durationMs: 0 }
  })

  // ── LOAD_CACHED_INDEX: read persisted index.json without re-scanning ──
  // Returns the cached RepoIndex (with generatedAt timestamp) or null if no
  // cache exists yet. Used by the renderer to display repos instantly on
  // mount instead of triggering a full re-scan every time the user switches
  // to the repo nav tab.
  ipc.handle(IPC.LOAD_CACHED_INDEX, (): RepoIndex | null => {
    try {
      const indexPath = dataFilePath('index.json')
      if (!existsSync(indexPath)) return null
      const raw = readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw) as RepoIndex
      if (parsed.version !== 1 || !Array.isArray(parsed.repos)) return null
      return parsed
    } catch {
      return null
    }
  })

  // ── OPEN_REPO: launch terminal for a given repo path ──────────────────
  ipc.handle(IPC.OPEN_REPO, async (_e: IpcMainInvokeEvent, repoPath: string, command: string, mode: 'new-tab' | 'new-window') => {
    logger.info('ipc', 'OPEN_REPO', { repoPath, command, mode })
    const config = getConfig()
    const result = await openRepoInTerminal(repoPath, command, mode, config)
    // On success, bump the open counter (non-fatal if it fails — the user
    // got their terminal either way).
    if (result.success) {
      incrementOpenCount(repoPath)
    }
    return result
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

  // ── PICK_DIRECTORY: show OS folder picker, return selected path or null ─
  ipc.handle(IPC.PICK_DIRECTORY, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择扫描根目录',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择扫描根目录',
          properties: ['openDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── GET_CONFIG_PATH: return resolved config file path (for display) ────
  ipc.handle(IPC.GET_CONFIG_PATH, (): string | null => {
    return getConfigPath()
  })

  // ── GET_USER_DATA: favorites, user tags, open counts ──────────────────
  ipc.handle(IPC.GET_USER_DATA, (): RepoUserData => {
    return getUserData()
  })

  // ── SAVE_USER_DATA: persist full user-data (renderer is source of truth)
  ipc.handle(IPC.SAVE_USER_DATA, (_e: IpcMainInvokeEvent, data: RepoUserData): RepoUserData => {
    saveUserData(data)
    return getUserData()
  })

  // ── PROBE_TOOL: verify a tool exists and runs ─────────────────────────
  // Accepts either a ToolKind ('git' / 'terminal' / 'terminalFallback') or a
  // raw binary name/path. Returns ok + version output + resolvedPath.
  ipc.handle(IPC.PROBE_TOOL, async (_e: IpcMainInvokeEvent, kindOrBinary: string): Promise<ToolProbeResult> => {
    return probeTool(kindOrBinary)
  })

  // ── PICK_EXECUTABLE: native file picker for selecting a tool binary ────
  ipc.handle(IPC.PICK_EXECUTABLE, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: '选择可执行文件',
      properties: ['openFile'],
      filters: [{ name: '可执行文件', extensions: ['exe', 'bat', 'cmd'] }]
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
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
        return {
          success: false,
          error: '未配置 AI 模型',
          errorKind: 'config' as const,
          hint: '请到「设置 → 通用 → AI 模型」从 opencode.json 中选择一个 provider/model 组合。'
        }
      }
      if (index.repos.length === 0) {
        return {
          success: false,
          error: '未扫描到任何仓库',
          errorKind: 'config' as const,
          hint: '请先在「设置 → 仓库导航 → 扫描配置」添加扫描根目录，然后点「刷新」.'
        }
      }
      const entries = await generateMemoryEntries(index.repos, config, aiConfig)
      const memory: RepoMemory = {
        version: 1,
        generatedAt: new Date().toISOString(),
        entries
      }
      saveMemory(memory)
      logger.info('ipc', 'REGENERATE_MEMORY success', { entries: entries.length })
      return { success: true, memory }
    } catch (err) {
      const classified = classifyLlmError(err)
      logger.error('ipc', 'REGENERATE_MEMORY failed', {
        error: classified.message,
        kind: classified.kind
      })
      return {
        success: false,
        error: classified.message,
        errorKind: classified.kind,
        hint: classified.hint
      }
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
}

// ═══════════════════════════════════════════════════════════════════════════
// Tool probe / autodetect helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-kind probe arguments. The probe runs `<binary> <args...>` and treats
 * exit code 0 as success.
 */
const PROBE_ARGS: Record<ToolKind, string[]> = {
  git: ['--version'],
  terminal: ['--version'],        // wt.exe doesn't really support this; we tolerate failure
  terminalFallback: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']
}

/**
 * Resolve the binary to probe. If `kindOrBinary` is a known ToolKind, return
 * the user's configured override (if any) or the default. Otherwise treat it
 * as a raw binary name/path.
 */
function resolveProbeBinary(kindOrBinary: string): { binary: string; kind: ToolKind | null } {
  const config = getConfig()
  if (kindOrBinary === 'git') {
    return { binary: (config.gitBinary ?? '').trim() || DEFAULT_TOOL_BINARIES.git, kind: 'git' }
  }
  if (kindOrBinary === 'terminal') {
    return { binary: (config.terminalBinary ?? '').trim() || DEFAULT_TOOL_BINARIES.terminal, kind: 'terminal' }
  }
  if (kindOrBinary === 'terminalFallback') {
    return {
      binary: (config.terminalFallback ?? '').trim() || DEFAULT_TOOL_BINARIES.terminalFallback,
      kind: 'terminalFallback'
    }
  }
  // Raw binary name/path passed in (no config mapping)
  return { binary: kindOrBinary, kind: null }
}

/**
 * Run a `--version`-style probe on the given tool. Returns the probe result.
 * Never throws — all errors become `{ ok: false, output: <message> }`.
 */
function probeTool(kindOrBinary: string): ToolProbeResult {
  const { binary, kind } = resolveProbeBinary(kindOrBinary)
  const args = kind ? PROBE_ARGS[kind] : ['--version']

  // First, resolve the absolute path via `where.exe` (informational)
  let resolvedPath: string | undefined
  try {
    const whereOut = execFileSync('where', [binary], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    resolvedPath = whereOut.split(/\r?\n/)[0]?.trim() || undefined
  } catch {
    // 'where' failed — binary not on PATH. Still try direct execution in case
    // the user provided an absolute path.
  }

  try {
    const stdout = execFileSync(binary, args, {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    return {
      ok: true,
      output: stdout.trim() || undefined,
      resolvedPath
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      output: message,
      resolvedPath
    }
  }
}
