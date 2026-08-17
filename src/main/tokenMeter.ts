/**
 * Token usage metering (borrowed from dsh's token-meter pattern).
 *
 * Records LLM token consumption per day and per call site ("source"), so the
 * Settings UI can show what the AI features actually cost. Persisted at
 * <userData>/token-usage.json with atomic tmp+rename writes; writes are
 * debounced so bursts of calls don't hammer the disk.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'
import { logger } from './logger'

/** Where a token spend came from. Extensible — new call sites just add a label. */
export type TokenUsageSource = 'todo-recommend' | 'repo-memory' | 'agent-title' | 'agent-task'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface DailyTokenUsage {
  /** Sum of totalTokens for the day. */
  total: number
  /** totalTokens per source label. */
  bySource: Record<string, number>
}

export interface TokenUsageData {
  version: 1
  /** Keyed by yyyy-mm-dd (local time). */
  days: Record<string, DailyTokenUsage>
  updatedAt: string
}

/** One day's aggregated usage, as returned to the renderer. */
export interface TokenUsageDay {
  date: string
  total: number
  bySource: Record<string, number>
}

function usageFilePath(): string {
  return join(app.getPath('userData'), 'token-usage.json')
}

let cached: TokenUsageData | null = null
let saveTimer: NodeJS.Timeout | null = null

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyData(): TokenUsageData {
  return { version: 1, days: {}, updatedAt: new Date().toISOString() }
}

function loadData(): TokenUsageData {
  if (cached) return cached
  try {
    const path = usageFilePath()
    if (!existsSync(path)) {
      cached = emptyData()
      return cached
    }
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<TokenUsageData>
    if (parsed.version !== 1 || typeof parsed.days !== 'object' || parsed.days === null) {
      throw new Error('unexpected shape')
    }
    cached = { version: 1, days: parsed.days, updatedAt: parsed.updatedAt ?? new Date().toISOString() }
  } catch (err) {
    // Corrupted or unreadable — start over rather than crash; token history
    // is diagnostics, not user data worth backing up.
    logger.warn('tokenMeter', 'usage file unreadable, resetting', {
      error: err instanceof Error ? err.message : String(err)
    })
    cached = emptyData()
  }
  return cached
}

function persistNow(): void {
  if (!cached) return
  try {
    const path = usageFilePath()
    const dir = join(path, '..')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${path}.tmp.${Date.now()}`
    writeFileSync(tmp, JSON.stringify(cached, null, 2), 'utf-8')
    try {
      renameSync(tmp, path)
    } catch {
      if (existsSync(tmp)) renameSync(tmp, path)
    }
  } catch (err) {
    logger.warn('tokenMeter', 'failed to persist usage', {
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

function schedulePersist(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistNow()
  }, 2000)
  // Don't keep the app alive just to flush usage stats.
  saveTimer.unref?.()
}

/**
 * Record one completed LLM call's usage. No-op when usage is missing (some
 * OpenAI-compatible endpoints don't return it in streaming mode).
 */
export function recordTokenUsage(source: TokenUsageSource, model: string, usage: TokenUsage | undefined): void {
  if (!usage || !Number.isFinite(usage.totalTokens) || usage.totalTokens <= 0) return
  const data = loadData()
  const key = todayKey()
  const day = (data.days[key] ??= { total: 0, bySource: {} })
  day.total += usage.totalTokens
  day.bySource[source] = (day.bySource[source] ?? 0) + usage.totalTokens
  data.updatedAt = new Date().toISOString()
  logger.info('tokenMeter', 'usage recorded', { source, model, totalTokens: usage.totalTokens })
  schedulePersist()
}

/** Flush pending writes immediately (e.g. on app quit). */
export function flushTokenUsage(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persistNow()
}

/** Aggregated usage for the last `daysCount` days (oldest first). */
export function getRecentTokenUsage(daysCount = 7): TokenUsageDay[] {
  const data = loadData()
  const out: TokenUsageDay[] = []
  const now = new Date()
  for (let i = daysCount - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const day = data.days[key]
    out.push({ date: key, total: day?.total ?? 0, bySource: day?.bySource ?? {} })
  }
  return out
}
