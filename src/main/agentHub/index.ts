/**
 * Agent Hub IPC handler registration.
 *
 * Registers all agent-hub IPC handlers. The key handler is LAUNCH which
 * opens a system terminal (Windows Terminal / PowerShell) at the given
 * workDir with the agent command running. Reuses repoNav's launcher.
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { AGENT_IPC } from '../../shared/agentHub'
import type { AgentHubData, AgentProbeResult, LaunchPayload, LaunchResult } from '../../shared/agentHub'
import { detectAgents } from './detect'
import { loadSessions, saveSessions } from './persistence'
import { openRepoInTerminal } from '../repoNav/launcher'
import { getConfig as getRepoNavConfig } from '../repoNav/config'
import { logger } from '../logger'

export function registerAgentHubIpc(ipc: typeof ipcMain): void {
  ipc.handle(AGENT_IPC.LIST_AGENTS, async () => {
    try { return await detectAgents() } catch (err) {
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

  logger.info('agentHub:ipc', 'IPC handlers registered')
}
