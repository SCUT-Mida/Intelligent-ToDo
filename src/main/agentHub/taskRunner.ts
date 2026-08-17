/**
 * AgentHub task runner — structured one-shot agent runs (v1.23).
 *
 * Unlike the embedded PTY (interactive, opaque byte stream), a task run
 * spawns the agent WITHOUT a terminal, captures stdout/stderr, parses it
 * into structured TaskEvents (stream-json for claude, plain text for
 * others), appends every event to the session's JSONL log, and pushes
 * them live to the renderer. Runs are registry-tracked and cancellable.
 *
 * Command resolution reuses pty.ts's buildSpawnTarget/buildPtyEnv so
 * packaged-Electron PATH sanitization is handled identically.
 */

import type { WebContents } from 'electron'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import {
  TASK_STREAM
} from '../../shared/agentHub'
import type {
  TaskEvent,
  TaskRunRequest,
  TaskRunStartResult,
  TaskRunInfo
} from '../../shared/agentHub'
import { logger } from '../logger'
import { tokenizeArgs } from './args'
import { buildSpawnTarget, buildPtyEnv } from './pty'
import { parseStreamJsonLine, buildTaskArgv } from './streamJson'
import { appendSessionEvent, loadSessionEvents, nextSeqFor } from './eventLog'
import { recordTokenUsage } from '../tokenMeter'
import { notifyBus } from '../notify'

interface ActiveRun {
  runId: string
  sessionId: string
  command: string
  workDir: string
  startedAt: string
  child: ChildProcess
  status: TaskRunInfo['status']
  exitCode?: number
  endedAt?: string
  /** Background runs fire an OS notification on completion (v1.24). */
  background: boolean
  /** Final result text (for the notification body / Todo write-back). */
  resultText?: string
}

/** Active + recently finished runs, keyed by runId. */
const runs = new Map<string, ActiveRun>()
const MAX_FINISHED_RUNS = 50

function safeSend(sender: WebContents | null, channel: string, ...args: unknown[]): void {
  if (!sender) return
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, ...args)
    }
  } catch {
    // window closed mid-run — events still go to the JSONL log
  }
}

/** Emit one event: persist (append) + push live. */
function emit(
  sender: WebContents | null,
  run: ActiveRun,
  type: TaskEvent['type'],
  fields: Omit<TaskEvent, 'seq' | 'at' | 'type' | 'runId'> = {}
): TaskEvent {
  const event: TaskEvent = {
    seq: nextSeqFor(run.sessionId),
    at: new Date().toISOString(),
    type,
    runId: run.runId,
    ...fields
  }
  appendSessionEvent(run.sessionId, event)
  safeSend(sender, TASK_STREAM.EVENT, run.sessionId, event)
  return event
}

/**
 * Start a structured task run. Resolves as soon as the process spawned
 * (ok + runId); subsequent progress arrives via TASK_STREAM.EVENT pushes
 * and TASK_STREAM.DONE when the run reaches a terminal state.
 */
export function runTask(sender: WebContents | null, req: TaskRunRequest): TaskRunStartResult {
  if (!req.prompt?.trim()) {
    return { ok: false, error: '任务提示词不能为空' }
  }
  try {
    const { file, args: resolvedArgs } = buildSpawnTarget(req.command)
    const userArgs = req.args ? tokenizeArgs(req.args) : []
    const finalArgs = [...resolvedArgs, ...buildTaskArgv(req.outputMode, req.prompt.trim(), userArgs)]

    const runId = `run-${Date.now().toString(36)}`
    const child = spawn(file, finalArgs, {
      cwd: req.workDir || undefined,
      env: { ...buildPtyEnv(), TERM: undefined }, // not a TTY; drop TERM forcing
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const run: ActiveRun = {
      runId,
      sessionId: req.sessionId,
      command: req.command,
      workDir: req.workDir,
      startedAt: new Date().toISOString(),
      child,
      status: 'running',
      background: req.background === true
    }
    runs.set(runId, run)
    pruneFinishedRuns()

    logger.info('agentHub:task', 'run started', {
      runId,
      sessionId: req.sessionId,
      command: req.command,
      outputMode: req.outputMode,
      target: file,
      argCount: finalArgs.length,
      workDir: req.workDir
    })

    emit(sender, run, 'run_started', { command: `${req.command} ${finalArgs.slice(0, -1).join(' ')}`.trim() })
    emit(sender, run, 'user_message', { prompt: req.prompt.trim() })

    let stdoutBuffer = ''
    let plainText = ''
    // The final claude 'result' line — held so run_finished can carry the
    // exit code; set from the stdout handler, consumed by settle().
    let pendingResult: ReturnType<typeof parseStreamJsonLine> = null
    let settled = false

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      if (req.outputMode === 'stream-json') {
        stdoutBuffer += text
        let nl: number
        while ((nl = stdoutBuffer.indexOf('\n')) !== -1) {
          const line = stdoutBuffer.slice(0, nl)
          stdoutBuffer = stdoutBuffer.slice(nl + 1)
          const parsed = parseStreamJsonLine(line)
          if (!parsed) continue
          if (parsed.type === 'run_finished' || parsed.type === 'run_error') {
            pendingResult = parsed
            continue
          }
          emitParsed(sender, run, parsed)
        }
      } else {
        plainText += text
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (!text) return
      logger.warn('agentHub:task', 'stderr', { runId, line: text.slice(0, 300) })
    })

    const settle = (exitCode: number): void => {
      if (settled) return
      settled = true
      run.status = run.status === 'cancelled' ? 'cancelled' : exitCode === 0 ? 'finished' : 'error'
      run.exitCode = exitCode
      run.endedAt = new Date().toISOString()

      if (run.status === 'cancelled') {
        emit(sender, run, 'run_cancelled', { exitCode })
      } else if (req.outputMode === 'stream-json') {
        // Flush any unparsed tail line, then the held result event.
        if (stdoutBuffer.trim()) {
          const parsed = parseStreamJsonLine(stdoutBuffer)
          if (parsed && parsed.type !== 'run_finished' && parsed.type !== 'run_error') {
            emitParsed(sender, run, parsed)
          } else if (parsed) {
            pendingResult = parsed
          }
        }
        if (pendingResult) {
          if (pendingResult.usage) {
            recordTokenUsage('agent-task', req.command, {
              promptTokens: pendingResult.usage.inputTokens ?? 0,
              completionTokens: pendingResult.usage.outputTokens ?? 0,
              totalTokens:
                (pendingResult.usage.inputTokens ?? 0) + (pendingResult.usage.outputTokens ?? 0)
            })
          }
          run.resultText = pendingResult.result ?? pendingResult.text
          emitParsed(sender, run, pendingResult)
        }
        if (run.status === 'error') {
          emit(sender, run, 'run_error', { exitCode, error: `agent 进程退出码 ${exitCode}` })
        }
      } else {
        // print / generic: whole stdout becomes one assistant message.
        const text = plainText.trim()
        if (text) {
          emit(sender, run, 'assistant_message', { text: text.slice(0, 50000) })
        }
        run.resultText = text
        if (run.status === 'error') {
          emit(sender, run, 'run_error', { exitCode, error: `agent 进程退出码 ${exitCode}` })
        } else {
          emit(sender, run, 'run_finished', { exitCode, result: text.slice(0, 20000) })
        }
      }

      safeSend(sender, TASK_STREAM.DONE, run.sessionId, taskRunInfo(run))
      // Background runs notify via the OS (v1.24) — foreground runs are
      // watched live in the timeline, no notification needed.
      if (run.background) {
        notifyBus.fire({
          kind: run.status === 'finished' ? 'task-done' : run.status === 'cancelled' ? 'info' : 'task-error',
          title: run.status === 'finished' ? 'Agent 任务完成' : run.status === 'cancelled' ? 'Agent 任务已取消' : 'Agent 任务失败',
          body: `${req.command} · ${(run.resultText ?? '').slice(0, 120).replace(/\s+/g, ' ') || `退出码 ${exitCode}`}`
        })
      }
      logger.info('agentHub:task', 'run ended', { runId, status: run.status, exitCode })
    }

    child.on('error', (err) => {
      logger.error('agentHub:task', 'spawn error', { runId, error: err.message })
      run.status = 'error'
      emit(sender, run, 'run_error', { error: `启动失败: ${err.message}` })
      run.endedAt = new Date().toISOString()
      safeSend(sender, TASK_STREAM.DONE, run.sessionId, taskRunInfo(run))
    })
    child.on('close', (code) => settle(code ?? -1))

    return { ok: true, runId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('agentHub:task', 'failed to start', { command: req.command, error: msg })
    return { ok: false, error: msg }
  }
}

function emitParsed(
  sender: WebContents | null,
  run: ActiveRun,
  parsed: NonNullable<ReturnType<typeof parseStreamJsonLine>>
): void {
  emit(sender, run, parsed.type, {
    text: parsed.text,
    toolName: parsed.toolName,
    toolInput: parsed.toolInput,
    toolResult: parsed.toolResult,
    result: parsed.result,
    usage: parsed.usage,
    error: parsed.error
  })
}

function taskRunInfo(run: ActiveRun): TaskRunInfo {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    command: run.command,
    workDir: run.workDir,
    startedAt: run.startedAt,
    status: run.status,
    exitCode: run.exitCode,
    endedAt: run.endedAt
  }
}

/** Cancel a running task (SIGKILL tree on Windows via taskkill). */
export function cancelTask(runId: string): boolean {
  const run = runs.get(runId)
  if (!run || run.status !== 'running') return false
  run.status = 'cancelled'
  try {
    run.child.kill()
  } catch {
    /* already dead */
  }
  logger.info('agentHub:task', 'run cancelled', { runId })
  return true
}

/** All tracked runs (running first, then most-recent finished). */
export function listTasks(): TaskRunInfo[] {
  const all = [...runs.values()].map(taskRunInfo)
  all.sort((a, b) => {
    const rank = (s: TaskRunInfo['status']): number => (s === 'running' ? 0 : 1)
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status)
    return b.startedAt.localeCompare(a.startedAt)
  })
  return all
}

/** A session's events (persisted log). */
export function getSessionEvents(sessionId: string): TaskEvent[] {
  return loadSessionEvents(sessionId)
}

function pruneFinishedRuns(): void {
  const finished = [...runs.values()].filter((r) => r.status !== 'running')
  if (finished.length > MAX_FINISHED_RUNS) {
    finished
      .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt))
      .slice(0, finished.length - MAX_FINISHED_RUNS)
      .forEach((r) => runs.delete(r.runId))
  }
}

/** Kill all running tasks (app quit). */
export function cancelAllTasks(): void {
  for (const run of runs.values()) {
    if (run.status === 'running') {
      run.status = 'cancelled'
      try { run.child.kill() } catch { /* dead */ }
    }
  }
}
