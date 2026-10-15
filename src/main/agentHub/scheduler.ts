/**
 * AgentHub scheduled tasks (v1.28) — run an agent task every day at a
 * fixed local time (e.g. nightly llm-wiki knowledge-base refresh, health
 * checks, auto-fixes).
 *
 * Design:
 *  - Persistence: <userData>/agentHub-schedules.json (atomic + corrupt
 *    backup, same as other stores).
 *  - Trigger: a 30s tick checks each enabled task via isScheduleDue()
 *    (time passed today && not already run today) — so an app launched
 *    later in the day catches up the same-day run, at most once per day.
 *  - Execution: reuses taskRunner.runTask with a synthetic session id
 *    (`sched-<taskId>`, its event log is viewable via getSessionEvents)
 *    and background: true, so completion arrives through the notify bus.
 *  - Concurrency: one inflight run per task; ticks while running are
 *    skipped. The scheduler subscribes to notifyBus (notifications now
 *    carry runId/sessionId) to record lastStatus.
 *  - Agent resolution: agentId → detectAgents at run time so per-agent
 *    args/custom agents stay current.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, copyFileSync } from 'fs'
import type {
  ScheduledTask,
  AgentScheduleData,
  AgentDescriptor
} from '../../shared/agentHub'
import { createDefaultScheduleData, scheduleSessionId, isScheduleDue } from '../../shared/agentHub'
import { writeJsonAtomic } from '../atomic'
import { runTask } from './taskRunner'
import { detectAgents } from './detect'
import { getAgentConfig } from './agentConfig'
import { notifyBus } from '../notify'
import { logger } from '../logger'

const DATA_FILE = join(app.getPath('userData'), 'agentHub-schedules.json')

let cached: AgentScheduleData | null = null
let timer: NodeJS.Timeout | null = null
/** taskId → runId currently in flight. */
const inflight = new Map<string, string>()

function loadData(): AgentScheduleData {
  if (cached) return cached
  try {
    if (!existsSync(DATA_FILE)) {
      cached = createDefaultScheduleData()
      return cached
    }
    const { readFileSync } = require('fs') as typeof import('fs')
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf-8')) as Partial<AgentScheduleData>
    cached = {
      version: 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    }
  } catch (err) {
    logger.warn('agentHub:schedule', 'data unreadable, backing up and resetting', {
      error: err instanceof Error ? err.message : String(err)
    })
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      copyFileSync(DATA_FILE, `${DATA_FILE}.corrupt-${ts}`)
    } catch {
      // ignore backup failure
    }
    cached = createDefaultScheduleData()
  }
  return cached
}

function persist(): void {
  if (!cached) return
  try {
    writeJsonAtomic(DATA_FILE, cached)
  } catch (err) {
    logger.error('agentHub:schedule', 'failed to persist', {
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

// ── Public management API (IPC handlers) ────────────────────────────────────

export function listSchedules(): AgentScheduleData {
  return loadData()
}

export function saveSchedule(task: ScheduledTask): boolean {
  const data = loadData()
  const idx = data.tasks.findIndex((t) => t.id === task.id)
  const stamped: ScheduledTask = { ...task, updatedAt: new Date().toISOString() }
  if (idx >= 0) {
    // Preserve run bookkeeping on edit.
    stamped.lastRunAt = data.tasks[idx].lastRunAt ?? null
    stamped.lastStatus = data.tasks[idx].lastStatus ?? null
    data.tasks[idx] = stamped
  } else {
    data.tasks.push(stamped)
  }
  persist()
  logger.info('agentHub:schedule', 'task saved', { id: task.id, name: task.name })
  return true
}

export function deleteSchedule(id: string): boolean {
  const data = loadData()
  data.tasks = data.tasks.filter((t) => t.id !== id)
  persist()
  return true
}

// ── Scheduler core ──────────────────────────────────────────────────────────

async function resolveAgent(agentId: string): Promise<AgentDescriptor | null> {
  try {
    const config = getAgentConfig()
    const agents = await detectAgents(config.customAgents, config.agentArgs)
    return agents.find((a) => a.id === agentId) ?? null
  } catch {
    return null
  }
}

/** Start one due task. Never throws. */
async function startTask(task: ScheduledTask, now: Date): Promise<void> {
  const agent = await resolveAgent(task.agentId)
  if (!agent) {
    task.lastRunAt = now.toISOString()
    task.lastStatus = 'error'
    persist()
    notifyBus.fire({
      kind: 'task-error',
      title: '定时任务无法启动',
      body: `「${task.name}」：未检测到 agent（${task.agentId}），请确认已安装或在设置中检查。`,
      sessionId: scheduleSessionId(task.id)
    })
    return
  }

  const result = runTask(null, {
    sessionId: scheduleSessionId(task.id),
    command: agent.command,
    outputMode: agent.outputMode,
    args: agent.args,
    workDir: task.workDir,
    prompt: task.prompt,
    background: true
  })
  if (!result.ok || !result.runId) {
    task.lastRunAt = now.toISOString()
    task.lastStatus = 'error'
    persist()
    logger.error('agentHub:schedule', 'run failed to start', { id: task.id, error: result.error })
    return
  }
  task.lastRunAt = now.toISOString()
  task.lastStatus = 'running'
  inflight.set(task.id, result.runId)
  persist()
  logger.info('agentHub:schedule', 'scheduled run started', {
    id: task.id,
    name: task.name,
    runId: result.runId,
    workDir: task.workDir
  })
}

async function tick(): Promise<void> {
  const data = loadData()
  const now = new Date()
  for (const task of data.tasks) {
    if (inflight.has(task.id)) continue
    if (!isScheduleDue(task, now)) continue
    // Fire and forget — completion recorded via notifyBus.
    void startTask(task, now)
  }
}

/** Outcome bookkeeping from the notify bus (background runs notify on settle). */
function onNotification(payload: import('../notify').AppNotification): void {
  if (!payload.sessionId?.startsWith('sched-')) return
  const taskId = payload.sessionId.slice('sched-'.length)
  const data = loadData()
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task) return
  if (payload.runId && inflight.get(taskId) !== payload.runId) return
  inflight.delete(taskId)
  task.lastStatus = payload.kind === 'task-done' ? 'ok' : payload.kind === 'task-error' ? 'error' : 'cancelled'
  persist()
  logger.info('agentHub:schedule', 'scheduled run settled', { id: taskId, status: task.lastStatus })
}

/** Start the scheduler (once per app lifetime). */
export function initScheduler(): void {
  if (timer) return
  notifyBus.on('notify', onNotification)
  timer = setInterval(() => {
    void tick()
  }, 30_000)
  timer.unref?.()
  // Catch up immediately on startup (same-day missed runs).
  void tick()
  logger.info('agentHub:schedule', 'scheduler started', {
    tasks: loadData().tasks.length
  })
}
