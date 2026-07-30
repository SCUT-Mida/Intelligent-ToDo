/**
 * Agent Hub — session persistence.
 *
 * Saves/loads the full AgentHubData (all sessions) to a JSON file in the
 * Electron userData directory. Mirrors the atomic-write + corruption-backup
 * pattern from the main todo-data loader so a malformed file never loses data.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import {
  createDefaultAgentHubData
} from '../../shared/agentHub'
import type { AgentHubData } from '../../shared/agentHub'
import { logger } from '../logger'

const DATA_FILE = join(app.getPath('userData'), 'agentHub-sessions.json')

/**
 * Load sessions from disk. On first launch (no file), returns empty defaults.
 * On corruption, backs up the bad file and returns empty defaults so the app
 * stays usable.
 */
export function loadSessions(): AgentHubData {
  if (!existsSync(DATA_FILE)) {
    return createDefaultAgentHubData()
  }

  try {
    const raw = readFileSync(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AgentHubData>
    return {
      version: 1,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      lastAgentId: typeof parsed.lastAgentId === 'string' ? parsed.lastAgentId : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  } catch (err) {
    logger.error('agentHub:persist', 'failed to load sessions, backing up', {
      error: err instanceof Error ? err.message : String(err)
    })
    // Back up the corrupt file so the user can recover manually.
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${ts}`)
    } catch {
      // ignore backup failure
    }
    return createDefaultAgentHubData()
  }
}

/**
 * Persist sessions to disk atomically. Creates the directory if needed.
 */
export function saveSessions(data: AgentHubData): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const payload: AgentHubData = {
      ...data,
      version: 1,
      updatedAt: new Date().toISOString()
    }
    writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8')
  } catch (err) {
    logger.error('agentHub:persist', 'failed to save sessions', {
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}
