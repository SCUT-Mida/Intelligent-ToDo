/**
 * Agent Hub IPC handler registration.
 *
 * Registers all agent-hub IPC handlers. The key handler is LAUNCH which
 * opens a system terminal (Windows Terminal / PowerShell) at the given
 * workDir with the agent command running. Reuses repoNav's launcher.
 */

import { ipcMain, dialog, BrowserWindow, app, clipboard } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { AGENT_IPC } from '../../shared/agentHub'
import type { AgentHubData, AgentHubConfig, AgentProbeResult, LaunchPayload, LaunchResult } from '../../shared/agentHub'
import { detectAgents } from './detect'
import { loadSessions, saveSessions } from './persistence'
import { getAgentConfig, saveAgentConfig } from './agentConfig'
import { createPty, sendInput, resizePty, killPty, killAllPtys } from './pty'
import { openRepoInTerminal } from '../repoNav/launcher'
import { getConfig as getRepoNavConfig } from '../repoNav/config'
import { logger } from '../logger'

// Re-export for main/index.ts cleanup
export { killAllPtys }

export function registerAgentHubIpc(ipc: typeof ipcMain): void {
  ipc.handle(AGENT_IPC.LIST_AGENTS, async () => {
    try {
      // Read config so detection includes custom agents + applies args overrides.
      const config = getAgentConfig()
      return await detectAgents(config.customAgents, config.agentArgs)
    } catch (err) {
      logger.error('agentHub:ipc', 'LIST_AGENTS failed', { error: err instanceof Error ? err.message : String(err) })
      return []
    }
  })

  ipc.handle(AGENT_IPC.GET_SESSIONS, (): AgentHubData => loadSessions())

  ipc.handle(AGENT_IPC.SAVE_SESSIONS, (_e, data: AgentHubData): boolean => {
    try { saveSessions(data); return true } catch (err) {
      logger.error('agentHub:ipc', 'SAVE_SESSIONS failed', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  })

  // GET_AGENT_CONFIG: load custom agents + per-agent args from disk.
  ipc.handle(AGENT_IPC.GET_AGENT_CONFIG, (): AgentHubConfig => getAgentConfig())

  // SAVE_AGENT_CONFIG: persist custom agents + per-agent args. Updates the
  // in-memory cache so the next LIST_AGENTS reflects the change immediately.
  ipc.handle(AGENT_IPC.SAVE_AGENT_CONFIG, (_e, cfg: AgentHubConfig): boolean => {
    try { saveAgentConfig(cfg); return true } catch (err) {
      logger.error('agentHub:ipc', 'SAVE_AGENT_CONFIG failed', { error: err instanceof Error ? err.message : String(err) })
      return false
    }
  })

  // LAUNCH: open system terminal with agent running.
  // Reuses repoNav's launcher which handles wt.exe/powershell fallback,
  // cmd.exe /c start for new windows, and -NoExit to keep terminal open.
  ipc.handle(AGENT_IPC.LAUNCH, async (_e, payload: LaunchPayload): Promise<LaunchResult> => {
    logger.info('agentHub:ipc', 'LAUNCH', { command: payload.command, workDir: payload.workDir })
    try {
      const config = getRepoNavConfig()
      return await openRepoInTerminal(payload.workDir, payload.command, 'new-tab', config)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('agentHub:ipc', 'LAUNCH failed', { error: msg })
      return { success: false, method: 'failed', error: msg }
    }
  })

  ipc.handle(AGENT_IPC.PICK_DIRECTORY, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { title: '选择工作目录', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: '选择工作目录', properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipc.handle(AGENT_IPC.PROBE_AGENT, async (_e, command: string): Promise<AgentProbeResult> => {
    const trimmed = command.trim()
    if (!trimmed) return { ok: false, output: 'empty command' }
    let resolvedPath: string | undefined
    try {
      const whereOut = execFileSync('where', [trimmed], { encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      resolvedPath = whereOut.split(/\r?\n/)[0]?.trim() || undefined
    } catch { /* not on PATH */ }
    try {
      const stdout = execFileSync(trimmed, ['--version'], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      return { ok: true, output: stdout.trim() || undefined, resolvedPath }
    } catch {
      try {
        const stdout = execFileSync(trimmed, ['--help'], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
        return { ok: true, output: stdout.slice(0, 200).trim() || undefined, resolvedPath }
      } catch (err) { return { ok: false, output: err instanceof Error ? err.message : String(err), resolvedPath } }
    }
  })

  // GET_REPO_INDEX: load cached repoNav index for workDir dropdown
  ipc.handle(AGENT_IPC.GET_REPO_INDEX, () => {
    try {
      const indexPath = join(app.getPath('userData'), 'repoNav', 'index.json')
      if (!existsSync(indexPath)) return null
      const raw = readFileSync(indexPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.repos)) return parsed
      return null
    } catch { return null }
  })

  // ── Embedded PTY handlers ────────────────────────────────────────────────
  // PTY_CREATE: spawn a CLI agent in a ConPTY. `args` is an optional last
  // param (space-separated string) appended to the resolved spawn command.
  ipc.handle(
    AGENT_IPC.PTY_CREATE,
    (e, sessionId: string, command: string, workDir: string, cols: number, rows: number, args?: string) => {
      return createPty(e.sender, sessionId, command, workDir, cols, rows, args)
    }
  )

  ipc.handle(AGENT_IPC.PTY_INPUT, (_e, sessionId: string, data: string) => {
    sendInput(sessionId, data)
  })

  ipc.handle(AGENT_IPC.PTY_RESIZE, (_e, sessionId: string, cols: number, rows: number) => {
    resizePty(sessionId, cols, rows)
  })

  ipc.handle(AGENT_IPC.PTY_KILL, (_e, sessionId: string) => {
    killPty(sessionId)
  })

  // CLIPBOARD_READ: read clipboard text in the MAIN process. This bypasses a
  // known Electron/Chromium quirk where clipboards written via the async
  // navigator.clipboard.writeText() API surface as EMPTY event.clipboardData
  // on a subsequent paste event in the renderer — which made xterm.js silently
  // drop pasted text. electron.clipboard.readText() always reads the OS clipboard.
  ipc.handle(AGENT_IPC.CLIPBOARD_READ, (): string => clipboard.readText())

  // CLIPBOARD_WRITE: write to the OS clipboard from the MAIN process.
  // Synchronous and always reliable in Electron — used by the Markdown editor's
  // copy button so the clipboard is guaranteed to contain the text (the renderer's
  // async navigator.clipboard.writeText() can silently fail on Windows).
  ipc.handle(AGENT_IPC.CLIPBOARD_WRITE, (_e, text: string): void => {
    clipboard.writeText(typeof text === 'string' ? text : '')
  })

  logger.info('agentHub:ipc', 'IPC handlers registered')
}
