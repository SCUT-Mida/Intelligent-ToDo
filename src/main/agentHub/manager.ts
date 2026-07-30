/**
 * Agent Hub — session process manager.
 *
 * Spawns CLI agents in non-interactive (print) mode, streams their stdout
 * back to the renderer as text chunks, and supports killing a running
 * process. This is the bridge between "user clicks Send" and "agent output
 * appears in the chat UI".
 *
 * Design: one-shot per message.
 *   Each user message spawns a fresh agent process (`<command> <printArgs>`),
 *   pipes stdout/stderr, and streams chunks. For resume-capable agents
 *   (claude), `--resume <session_id>` maintains conversation context across
 *   invocations — giving persistent-session UX without parsing TUI escape
 *   codes (which is fragile and agent-specific).
 *
 * Two output modes:
 *   - stream-json (claude): newline-delimited JSON events. We parse each line,
 *     extract text/tool-use/session-id, and forward structured events.
 *   - print/generic (others): raw stdout text. Forwarded verbatim as chunks.
 */

import { spawn, execSync } from 'child_process'
import type { ChildProcess } from 'child_process'
import type { WebContents } from 'electron'
import { AGENT_STREAM } from '../../shared/agentHub'
import type {
  AgentDescriptor,
  StreamChunkPayload,
  StreamToolPayload,
  StreamExitPayload,
  StreamErrorPayload,
  StreamStatusPayload,
  ToolCall,
  SendMessageResult
} from '../../shared/agentHub'
import { buildSpawnArgs, BUILTIN_AGENTS } from './agents'
import { logger } from '../logger'

// ── Per-session runtime state ───────────────────────────────────────────────

interface RunningSession {
  /** The spawned agent child process. */
  process: ChildProcess
  /** The assistant message id chunks are streaming into. */
  messageId: string
  /** Partial stdout line buffer (for newline-delimited JSON parsing). */
  lineBuffer: string
  /** Native session id extracted from agent output (for resume). */
  nativeSessionId?: string
  /** The agent's output mode — determines parsing strategy. */
  outputMode: AgentDescriptor['outputMode']
  /** True if the 'error' event fired before 'close' — prevents close from
   *  overwriting the error status with 'idle'. */
  hasError?: boolean
}

/** Active sessions keyed by AgentSession.id. */
const running = new Map<string, RunningSession>()

// ── ID generation ───────────────────────────────────────────────────────────

/** Generate a unique message id. */
function makeMessageId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Safe sender helper ──────────────────────────────────────────────────────

/**
 * Send a streaming event to the renderer, guarding against a destroyed
 * webContents (window closed mid-stream).
 */
function safeSend(
  sender: WebContents,
  channel: string,
  payload:
    | StreamChunkPayload
    | StreamToolPayload
    | StreamExitPayload
    | StreamErrorPayload
    | StreamStatusPayload
): void {
  try {
    if (!sender.isDestroyed()) {
      sender.send(channel, payload)
    }
  } catch {
    // Window closed — nothing we can do; the process will be cleaned up on exit.
  }
}

// ── stream-json line parser (claude code) ───────────────────────────────────

/**
 * Parse a single line of claude-code stream-json output and forward
 * structured events to the renderer.
 *
 * Format: one JSON object per line with a `type` discriminator:
 *   system   → { type, subtype, session_id, ... }
 *   assistant→ { type, message: { content: [{ type: 'text'|'tool_use', ... }] } }
 *   user     → { type, message: { content: [{ type: 'tool_result', ... }] } }
 *   result   → { type, result: string, session_id: string, ... }
 */
function parseStreamJsonLine(
  sender: WebContents,
  sessionId: string,
  messageId: string,
  line: string,
  state: RunningSession
): void {
  const trimmed = line.trim()
  if (!trimmed) return

  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    // Not valid JSON — could be a partial or non-JSON line. Forward as plain
    // text so the user at least sees something rather than a silent drop.
    safeSend(sender, AGENT_STREAM.CHUNK, { sessionId, messageId, text: line + '\n' })
    return
  }

  const type = obj['type'] as string | undefined

  // Extract native session id early (appears in system + result events).
  const sid = obj['session_id']
  if (typeof sid === 'string' && sid) {
    state.nativeSessionId = sid
  }

  if (type === 'assistant' || type === 'user') {
    const message = obj['message'] as Record<string, unknown> | undefined
    const content = message?.['content']
    if (Array.isArray(content)) {
      for (const block of content) {
        const b = block as Record<string, unknown>
        const blockType = b['type'] as string | undefined

        if (blockType === 'text') {
          const text = b['text']
          if (typeof text === 'string' && text) {
            safeSend(sender, AGENT_STREAM.CHUNK, { sessionId, messageId, text })
          }
        } else if (blockType === 'tool_use') {
          const toolName = b['name'] as string | undefined
          const input = b['input'] as Record<string, unknown> | undefined
          const tool: ToolCall = {
            name: toolName ?? 'tool',
            input: input ? truncate(JSON.stringify(input), 500) : undefined,
            status: 'running'
          }
          safeSend(sender, AGENT_STREAM.TOOL, { sessionId, messageId, tool })
        } else if (blockType === 'tool_result') {
          // Tool results come as "user" messages. Surface the output.
          const resultContent = b['content']
          const toolUseId = b['tool_use_id'] as string | undefined
          const outputText =
            typeof resultContent === 'string'
              ? resultContent
              : Array.isArray(resultContent)
                ? (resultContent as Array<Record<string, unknown>>)
                    .map((c) => (typeof c['text'] === 'string' ? c['text'] : ''))
                    .join('')
                : undefined
          const tool: ToolCall = {
            name: 'result',
            input: toolUseId,
            output: outputText ? truncate(outputText, 500) : undefined,
            status: 'success'
          }
          safeSend(sender, AGENT_STREAM.TOOL, { sessionId, messageId, tool })
        }
      }
    }
  } else if (type === 'result') {
    // Final result line — may carry a summary text.
    const resultText = obj['result']
    if (typeof resultText === 'string' && resultText) {
      safeSend(sender, AGENT_STREAM.CHUNK, { sessionId, messageId, text: resultText })
    }
  }
  // 'system' events (init, etc.) are informational only — session_id already
  // extracted above. We don't forward them as chat text.
}

/** Truncate a string to maxLen chars, appending an ellipsis if cut. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen) + '…'
}

// ── Core: send message (spawn agent) ────────────────────────────────────────

/**
 * Spawn the agent for a user message and stream output back.
 *
 * @returns the new assistant message id (renderer creates a placeholder
 *          message with this id, then receives chunks referencing it).
 */
export function sendMessage(
  sender: WebContents,
  session: { id: string; agentId: string; workDir: string; nativeSessionId?: string },
  text: string,
  agentOverride?: AgentDescriptor
): SendMessageResult {
  // Resolve the agent definition: use override (for custom agents) or look up
  // from the built-in registry by agentId.
  const def = agentOverride ?? BUILTIN_AGENTS.find((a) => a.id === session.agentId)
  if (!def) {
    throw new Error(`未找到 Agent: ${session.agentId}`)
  }

  const messageId = makeMessageId()

  // FIX #8: Require a working directory. Without one, spawn() defaults to the
  // Electron app's resources directory (read-only, no project files), causing
  // confusing errors. Force the user to pick a directory first.
  if (!session.workDir) {
    logger.warn('agentHub:manager', 'no workDir set, refusing to spawn', { sessionId: session.id })
    safeSend(sender, AGENT_STREAM.ERROR, {
      sessionId: session.id,
      messageId,
      text: '请先在顶部工具栏选择一个工作目录。AI 助手需要一个工作目录来执行命令。'
    })
    safeSend(sender, AGENT_STREAM.STATUS, { sessionId: session.id, status: 'error' })
    // Send EXIT so the renderer clears the streaming cursor on the placeholder message.
    safeSend(sender, AGENT_STREAM.EXIT, { sessionId: session.id, code: 1, messageId })
    return { messageId }
  }

  // Build the final spawn arguments.
  const args = buildSpawnArgs(def, text, session.nativeSessionId)

  const cwd = session.workDir

  logger.info('agentHub:manager', 'spawning agent', {
    agent: def.command,
    agentId: def.id,
    sessionId: session.id,
    messageId,
    cwd,
    outputMode: def.outputMode,
    hasResume: !!session.nativeSessionId,
    argCount: args.length
  })

  // Notify renderer: session is now running.
  safeSend(sender, AGENT_STREAM.STATUS, { sessionId: session.id, status: 'running' })

  let child: ChildProcess
  try {
    child = spawn(def.command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error('agentHub:manager', 'spawn failed', { agent: def.command, error: msg })
    safeSend(sender, AGENT_STREAM.ERROR, { sessionId: session.id, messageId, text: `启动失败：${msg}` })
    safeSend(sender, AGENT_STREAM.STATUS, { sessionId: session.id, status: 'error' })
    // Send EXIT so the renderer clears the streaming cursor.
    safeSend(sender, AGENT_STREAM.EXIT, { sessionId: session.id, code: 1, messageId })
    return { messageId }
  }

  const state: RunningSession = {
    process: child,
    messageId,
    lineBuffer: '',
    outputMode: def.outputMode
  }
  running.set(session.id, state)

  // ── stdout handler ──
  child.stdout?.on('data', (chunk: Buffer) => {
    const raw = chunk.toString('utf-8')

    if (def.outputMode === 'stream-json') {
      // Buffer partial lines, parse complete ones.
      state.lineBuffer += raw
      const lines = state.lineBuffer.split('\n')
      // Keep the last (possibly incomplete) segment in the buffer.
      state.lineBuffer = lines.pop() ?? ''
      for (const line of lines) {
        parseStreamJsonLine(sender, session.id, messageId, line, state)
      }
    } else {
      // print / generic — forward verbatim.
      safeSend(sender, AGENT_STREAM.CHUNK, { sessionId: session.id, messageId, text: raw })
    }
  })

  // ── stderr handler ──
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8')
    safeSend(sender, AGENT_STREAM.ERROR, { sessionId: session.id, messageId, text })
  })

  // ── exit handler ──
  child.on('close', (code: number | null, signal: string | null) => {
    // Flush any remaining buffered line (stream-json mode).
    if (def.outputMode === 'stream-json' && state.lineBuffer.trim()) {
      parseStreamJsonLine(sender, session.id, messageId, state.lineBuffer, state)
      state.lineBuffer = ''
    }

    running.delete(session.id)

    const wasKilled = signal === 'SIGTERM' || signal === 'SIGKILL' || (process.platform === 'win32' && signal === null && code === 1)
    const hasNonZeroExit = !wasKilled && code !== null && code !== 0

    logger.info('agentHub:manager', 'agent exited', {
      sessionId: session.id,
      messageId,
      code,
      signal,
      nativeSessionId: state.nativeSessionId,
      wasKilled,
      hasError: state.hasError
    })

    safeSend(sender, AGENT_STREAM.EXIT, {
      sessionId: session.id,
      code,
      messageId,
      nativeSessionId: state.nativeSessionId
    })

    // FIX #3: Don't overwrite 'error' status set by the 'error' event handler.
    // Also set 'error' for non-zero exit codes (agent crashed).
    if (!state.hasError) {
      const finalStatus = wasKilled ? 'stopped' : hasNonZeroExit ? 'error' : 'idle'
      safeSend(sender, AGENT_STREAM.STATUS, {
        sessionId: session.id,
        status: finalStatus
      })
    }
  })

  // ── error handler (spawn-level: ENOENT etc.) ──
  child.on('error', (err: Error) => {
    logger.error('agentHub:manager', 'agent process error', {
      sessionId: session.id,
      messageId,
      error: err.message,
      code: (err as NodeJS.ErrnoException).code
    })

    const errnoCode = (err as NodeJS.ErrnoException).code
    let userMsg: string
    if (errnoCode === 'ENOENT') {
      userMsg = `找不到命令「${def.command}」。请确认该 Agent 已安装并在系统 PATH 中。可在顶部工具栏点击 ⟳ 重新扫描。`
    } else {
      userMsg = `Agent 进程错误：${err.message}`
    }

    safeSend(sender, AGENT_STREAM.ERROR, { sessionId: session.id, messageId, text: userMsg })
    safeSend(sender, AGENT_STREAM.STATUS, { sessionId: session.id, status: 'error' })
    state.hasError = true
    running.delete(session.id)
  })

  return { messageId, nativeSessionId: state.nativeSessionId }
}

// ── Stop a running session ──────────────────────────────────────────────────

/**
 * Kill the agent process for a session. On Windows, uses taskkill /T to
 * kill the entire process tree (agent may have spawned children like git,
 * node, etc.). Returns true if a process was killed.
 */
export function stopSession(sessionId: string): boolean {
  const state = running.get(sessionId)
  if (!state) return false

  const pid = state.process.pid
  logger.info('agentHub:manager', 'stopping session', { sessionId, pid })

  try {
    if (process.platform === 'win32' && pid) {
      // taskkill /T /F kills the process AND its children. `child.kill()` on
      // Windows only kills the immediate child, leaving grandchildren orphaned.
      execSync(`taskkill /PID ${pid} /T /F`, {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 5000
      })
    } else {
      state.process.kill('SIGTERM')
    }
  } catch (err) {
    // Fallback to SIGKILL if taskkill fails.
    logger.warn('agentHub:manager', 'stop failed, trying SIGKILL', {
      sessionId,
      error: err instanceof Error ? err.message : String(err)
    })
    try {
      state.process.kill('SIGKILL')
    } catch {
      // Process may already be dead — the close handler will fire.
    }
  }

  return true
}

/**
 * Kill ALL running sessions. Called on app quit so no agent processes
 * are orphaned.
 */
export function stopAllSessions(): void {
  for (const sessionId of running.keys()) {
    stopSession(sessionId)
  }
}

/**
 * Check if a session currently has a running agent process.
 */
export function isRunning(sessionId: string): boolean {
  return running.has(sessionId)
}
