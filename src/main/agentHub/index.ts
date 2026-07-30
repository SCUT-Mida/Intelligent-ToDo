/**
 * Agent Hub IPC handler registration.
 *
 * Registers all agent-hub IPC handlers on the given ipcMain instance.
 * Called once from src/main/index.ts during app.whenReady().
 *
 * Mirrors the registration pattern from ../repoNav/index.ts.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { execFileSync } from 'child_process'
import { AGENT_IPC } from '../../shared/agentHub'
import type { AgentHubData, AgentProbeResult, AgentDescriptor } from '../../shared/agentHub'
import { detectAgents } from './detect'
import { loadSessions, saveSessions } from './persistence'
import { sendMessage, stopSession } from './manager'
import { logger } from '../logger'

/**
 * Register all agent-hub IPC handlers.
 *
 * @param ipc - The Electron ipcMain singleton.
 */
export function registerAgentHubIpc(ipc: typeof ipcMain): void {
  // ── LIST_AGENTS: detect installed CLI agents ───────────────────────────
  ipc.handle(AGENT_IPC.LIST_AGENTS, async (): Promise<ReturnType<typeof detectAgents>> => {
    try {
      return await detectAgents()
    } catch (err) {
      logger.error('agentHub:ipc', 'LIST_AGENTS failed', {
        error: err instanceof Error ? err.message : String(err)
      })
      // Return empty list rather than throwing — the UI shows "no agents found".
      return []
    }
  })

  // ── GET_SESSIONS: load persisted sessions from disk ────────────────────
  ipc.handle(AGENT_IPC.GET_SESSIONS, (): AgentHubData => {
    return loadSessions()
  })

  // ── SAVE_SESSIONS: persist all sessions to disk ────────────────────────
  ipc.handle(AGENT_IPC.SAVE_SESSIONS, (_e: IpcMainInvokeEvent, data: AgentHubData): boolean => {
    try {
      saveSessions(data)
      return true
    } catch (err) {
      logger.error('agentHub:ipc', 'SAVE_SESSIONS failed', {
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  })

  // ── SEND_MESSAGE: spawn agent + stream output ──────────────────────────
  // The renderer passes the full session object (agentId, workDir, nativeSessionId)
  // and the text. We spawn the agent, stream chunks back via AGENT_STREAM events,
  // and return the new assistant message id immediately.
  ipc.handle(
    AGENT_IPC.SEND_MESSAGE,
    (
      e: IpcMainInvokeEvent,
      session: { id: string; agentId: string; workDir: string; nativeSessionId?: string },
      text: string,
      agentOverride?: AgentDescriptor
    ) => {
      try {
        return sendMessage(e.sender, session, text, agentOverride)
      } catch (err) {
        logger.error('agentHub:ipc', 'SEND_MESSAGE failed', {
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err)
        })
        throw err
      }
    }
  )

  // ── STOP_SESSION: kill the running agent process for a session ─────────
  ipc.handle(AGENT_IPC.STOP_SESSION, (_e: IpcMainInvokeEvent, sessionId: string): boolean => {
    return stopSession(sessionId)
  })

  // ── PICK_DIRECTORY: show OS folder picker ──────────────────────────────
  ipc.handle(AGENT_IPC.PICK_DIRECTORY, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: '选择工作目录',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '选择工作目录',
          properties: ['openDirectory']
        })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── PROBE_AGENT: verify a custom agent command runs ────────────────────
  ipc.handle(
    AGENT_IPC.PROBE_AGENT,
    async (_e: IpcMainInvokeEvent, command: string): Promise<AgentProbeResult> => {
      const trimmed = command.trim()
      if (!trimmed) return { ok: false, output: 'empty command' }

      // Resolve path via where.exe (informational).
      let resolvedPath: string | undefined
      try {
        const whereOut = execFileSync('where', [trimmed], {
          encoding: 'utf-8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
        resolvedPath = whereOut.split(/\r?\n/)[0]?.trim() || undefined
      } catch {
        // not on PATH
      }

      // Try running `<command> --version` (or `--help` as fallback).
      try {
        const stdout = execFileSync(trimmed, ['--version'], {
          encoding: 'utf-8',
          timeout: 10000,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true
        })
        return { ok: true, output: stdout.trim() || undefined, resolvedPath }
      } catch {
        // --version failed; try --help
        try {
          const stdout = execFileSync(trimmed, ['--help'], {
            encoding: 'utf-8',
            timeout: 10000,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
          })
          return { ok: true, output: stdout.slice(0, 200).trim() || undefined, resolvedPath }
        } catch (err) {
          return {
            ok: false,
            output: err instanceof Error ? err.message : String(err),
            resolvedPath
          }
        }
      }
    }
  )

  logger.info('agentHub:ipc', 'IPC handlers registered')
}
