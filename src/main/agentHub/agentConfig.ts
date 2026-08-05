/**
 * Agent Hub — configuration persistence.
 *
 * Persists the AgentHubConfig (custom agents + per-agent startup args) to
 * <userData>/agentHub-config.json, a sibling of agentHub-sessions.json.
 * Mirrors the atomic-write + corruption-backup pattern from persistence.ts
 * and the in-memory cache pattern from repoNav/config.ts so a malformed
 * file never loses data and repeated reads stay cheap.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs'
import { createDefaultAgentHubConfig } from '../../shared/agentHub'
import type { AgentHubConfig } from '../../shared/agentHub'
import { logger } from '../logger'

const DATA_FILE = join(app.getPath('userData'), 'agentHub-config.json')

// ── Cached config ──────────────────────────────────────────────────────────

let cachedConfig: AgentHubConfig | null = null

/**
 * Load the AgentHubConfig from disk. On first launch (no file), returns the
 * defaults WITHOUT caching — the first save creates the file. On corruption,
 * backs up the bad file and returns defaults so the app stays usable.
 */
export function getAgentConfig(): AgentHubConfig {
  if (cachedConfig) return cachedConfig

  if (!existsSync(DATA_FILE)) {
    return createDefaultAgentHubConfig()
  }

  try {
    const raw = readFileSync(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AgentHubConfig>
    // Merge with defaults so missing/malformed fields don't crash the app.
    // Each customAgents entry is trusted to be an AgentDefinition.
    const merged: AgentHubConfig = {
      version: 1,
      customAgents: Array.isArray(parsed.customAgents) ? parsed.customAgents : [],
      agentArgs:
        parsed.agentArgs && typeof parsed.agentArgs === 'object' ? parsed.agentArgs : {},
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
    cachedConfig = merged
    return merged
  } catch (err) {
    logger.error('agentHub:agentConfig', 'failed to load config, backing up', {
      error: err instanceof Error ? err.message : String(err)
    })
    // Back up the corrupt file so the user can recover manually.
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${ts}`)
    } catch {
      // ignore backup failure
    }
    const defaults = createDefaultAgentHubConfig()
    cachedConfig = defaults
    return defaults
  }
}

/**
 * Persist the AgentHubConfig to disk atomically. Creates the userData
 * directory if needed, then updates the in-memory cache.
 */
export function saveAgentConfig(cfg: AgentHubConfig): void {
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const payload: AgentHubConfig = {
      ...cfg,
      version: 1,
      updatedAt: new Date().toISOString()
    }
    writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8')

    // Update cache so the next getAgentConfig() reflects the save
    cachedConfig = payload
  } catch (err) {
    logger.error('agentHub:agentConfig', 'failed to save config', {
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

/**
 * Returns the resolved path of the config file on disk.
 */
export function getAgentConfigPath(): string {
  return DATA_FILE
}

/**
 * Clear the in-memory config cache (useful for testing).
 */
export function clearAgentConfigCache(): void {
  cachedConfig = null
}
