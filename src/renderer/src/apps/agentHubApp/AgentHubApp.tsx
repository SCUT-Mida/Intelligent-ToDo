import { useState, useEffect, useCallback, useRef } from 'react'
import SessionSidebar from '../../components/AgentHub/SessionSidebar'
import AgentPicker from '../../components/AgentHub/AgentPicker'
import WorkDirPicker from '../../components/AgentHub/WorkDirPicker'
import ChatView from '../../components/AgentHub/ChatView'
import type {
  AgentSession,
  AgentDescriptor,
  AgentHubData,
  ChatMessage,
  SendMessageResult
} from '@shared/agentHub'
import { createDefaultAgentHubData } from '@shared/agentHub'
import '../../styles/agentHub.css'

/**
 * Root component for the Agent Hub sub-app.
 *
 * Responsibilities:
 * - Load agents + sessions on mount.
 * - Subscribe to all stream events (chunk, tool, status, exit, error).
 * - Manage sessions, active session, agent selection, logs.
 * - Persist sessions on important changes (exit, new, delete, rename, send).
 *
 * Layout: left sidebar (SessionSidebar) + main area
 *   (toolbar with AgentPicker + WorkDirPicker + log toggle + ChatView).
 */
export default function AgentHubApp(): JSX.Element {
  // ── State ──────────────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('claude')
  const [logs, setLogs] = useState<string[]>([])
  const [logPanelOpen, setLogPanelOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  // Refs to always have access to latest values in stream event callbacks
  const selectedAgentIdRef = useRef(selectedAgentId)
  selectedAgentIdRef.current = selectedAgentId

  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  // Ref for latest sessions — needed in handleSendMessage to avoid stale
  // closures (the callback has [] deps but needs current session data for
  // agentId/workDir/nativeSessionId, which change after the first render).
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  // Ref for latest agents — same stale-closure fix for agent override lookup.
  const agentsRef = useRef(agents)
  agentsRef.current = agents

  // Counter-based persistence flag: increment when save is needed,
  // the useEffect below will persist on the next sessions change.
  const pendingSaveRef = useRef(0)

  // Persist sessions when flagged after a state change
  useEffect(() => {
    if (pendingSaveRef.current > 0) {
      pendingSaveRef.current = 0
      const data: AgentHubData = {
        version: 1,
        sessions,
        lastAgentId: selectedAgentIdRef.current,
        updatedAt: new Date().toISOString()
      }
      window.agentHub.saveSessions(data).catch((err: unknown) => {
        console.error('Failed to persist sessions', err)
      })
    }
  }, [sessions])

  // ── Initialisation (mount) ────────────────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const [agentList, hubData] = await Promise.all([
          window.agentHub.listAgents(),
          window.agentHub.getSessions()
        ])
        setAgents(agentList)
        const data = hubData ?? createDefaultAgentHubData()
        setSessions(data.sessions)
        if (data.lastAgentId) {
          setSelectedAgentId(data.lastAgentId)
        }
        // Auto-select first session if available
        if (data.sessions.length > 0) {
          setActiveSessionId(data.sessions[0].id)
        }
      } catch (err: unknown) {
        console.error('Failed to load agent hub data', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── Stream event subscriptions ────────────────────────────────────────

  useEffect(() => {
    const unsubs: (() => void)[] = []

    // Text chunk: append to the streaming assistant message
    unsubs.push(
      window.agentHub.onStreamChunk((p) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === p.sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === p.messageId ? { ...m, content: m.content + p.text } : m
                  )
                }
              : s
          )
        )
      })
    )

    // Tool call: add tool to the assistant message
    unsubs.push(
      window.agentHub.onStreamTool((p) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === p.sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === p.messageId
                      ? { ...m, toolCalls: [...(m.toolCalls ?? []), p.tool] }
                      : m
                  )
                }
              : s
          )
        )
      })
    )

    // Status change: update session status
    unsubs.push(
      window.agentHub.onStreamStatus((p) => {
        setSessions((prev) =>
          prev.map((s) => (s.id === p.sessionId ? { ...s, status: p.status } : s))
        )
      })
    )

    // Process exit: mark message as done, set session idle, persist
    unsubs.push(
      window.agentHub.onStreamExit((p) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === p.sessionId
              ? {
                  ...s,
                  status: 'idle' as const,
                  nativeSessionId: p.nativeSessionId ?? s.nativeSessionId,
                  messages: s.messages.map((m) =>
                    m.id === p.messageId ? { ...m, streaming: false } : m
                  )
                }
              : s
          )
        )
        pendingSaveRef.current++
      })
    )

    // Error on stderr: add to log panel
    unsubs.push(
      window.agentHub.onStreamError((p) => {
        const line = `[stderr] ${p.text}`
        setLogs((prev) => [...prev, line])
        setSessions((prev) =>
          prev.map((s) =>
            s.id === p.sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === p.messageId ? { ...m, error: p.text } : m
                  )
                }
              : s
          )
        )
      })
    )

    return () => {
      for (const fn of unsubs) {
        fn()
      }
    }
  }, [])

  // FIX #6: Stop all running sessions when this component unmounts (user
  // switches to another sub-app). Without this, agent processes keep running
  // in the background, consuming CPU/memory, with their output going nowhere.
  useEffect(() => {
    return () => {
      for (const s of sessionsRef.current) {
        if (s.status === 'running') {
          window.agentHub.stopSession(s.id).catch(() => {})
        }
      }
    }
  }, [])

  // ── Derived values ────────────────────────────────────────────────────

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const activeWorkDir = activeSession?.workDir ?? ''

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleNewSession = useCallback((): void => {
    const newSession: AgentSession = {
      id: `sess-${Date.now()}`,
      title: '新会话',
      agentId: selectedAgentIdRef.current,
      workDir: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      status: 'idle'
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    pendingSaveRef.current++
  }, [])

  const handleDeleteSession = useCallback((id: string): void => {
    // FIX #7: Confirm before deleting sessions with messages (irreversible).
    const session = sessionsRef.current.find((s) => s.id === id)
    if (session && session.messages.length > 0) {
      const confirmed = window.confirm(
        `确定要删除「${session.title}」吗？\n此操作无法撤销，会话中的 ${session.messages.length} 条消息将被永久删除。`
      )
      if (!confirmed) return
    }
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next
    })
    setActiveSessionId((prev) => (prev === id ? null : prev))
    pendingSaveRef.current++
  }, [])

  const handleRenameSession = useCallback((id: string, title: string): void => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s))
    )
    pendingSaveRef.current++
  }, [])

  const handleSelectSession = useCallback((id: string): void => {
    setActiveSessionId(id)
    const session = sessions.find((s) => s.id === id)
    if (session) {
      setSelectedAgentId(session.agentId)
    }
  }, [sessions])

  const handleAgentChange = useCallback((id: string): void => {
    setSelectedAgentId(id)
    // FIX #1: Also update the active session's agentId so subsequent messages
    // use the newly selected agent. Without this, changing the picker had no
    // effect on the session (send path reads session.agentId, not selectedAgentId).
    const sessionId = activeSessionIdRef.current
    if (sessionId) {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, agentId: id, updatedAt: new Date().toISOString() } : s
        )
      )
      pendingSaveRef.current++
    }
  }, [])

  const handleWorkDirChange = useCallback(
    (path: string): void => {
      const id = activeSessionIdRef.current
      if (!id) return
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, workDir: path, updatedAt: new Date().toISOString() } : s))
      )
      pendingSaveRef.current++
    },
    []
  )

  const handlePickWorkDir = useCallback(async (): Promise<void> => {
    try {
      const result = await window.agentHub.pickDirectory()
      if (result) {
        handleWorkDirChange(result)
      }
    } catch (err: unknown) {
      console.error('Failed to pick directory', err)
    }
  }, [handleWorkDirChange])

  const handleSendMessage = useCallback(
    (text: string): void => {
      const rawSessionId = activeSessionIdRef.current
      if (!rawSessionId) return
      const sessionId: string = rawSessionId

      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        role: 'user',
        content: text,
        timestamp: new Date().toISOString()
      }

      // Optimistically add user message and set status to running
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                status: 'running' as const,
                messages: [...s.messages, userMessage]
              }
            : s
        )
      )

      // Send to main process (sendMessage expects the full session object).
      // Use sessionsRef to get the LATEST session data (avoids stale closure —
      // the callback has [] deps so `sessions` from the closure would be from
      // the first render, missing nativeSessionId set after the first message).
      const sessionToSend = sessionsRef.current.find((s) => s.id === sessionId)
      if (!sessionToSend) return

      // For custom agents (not in built-in registry), pass the full descriptor
      // so the main process knows how to invoke them.
      const agentOverride = agentsRef.current.find((a) => a.id === sessionToSend.agentId)

      window.agentHub
        .sendMessage(sessionToSend, text, agentOverride)
        .then((result: SendMessageResult) => {
          const assistantMsg: ChatMessage = {
            id: result.messageId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            streaming: true
          }

          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    nativeSessionId: result.nativeSessionId ?? s.nativeSessionId,
                    messages: [...s.messages, assistantMsg]
                  }
                : s
            )
          )

          pendingSaveRef.current++
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err)
          const errorSystemMsg: ChatMessage = {
            id: `err-${Date.now()}`,
            role: 'system',
            content: `发送失败: ${errMsg}`,
            timestamp: new Date().toISOString(),
            error: errMsg
          }
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId
                ? {
                    ...s,
                    status: 'error' as const,
                    messages: [...s.messages, errorSystemMsg]
                  }
                : s
            )
          )
          pendingSaveRef.current++
        })
    },
    []
  )

  const handleStopSession = useCallback((): void => {
    const sessionId = activeSessionIdRef.current
    if (!sessionId) return
    window.agentHub.stopSession(sessionId).catch((err: unknown) => {
      console.error('Failed to stop session', err)
    })
  }, [])

  const handleClearLogs = useCallback((): void => {
    setLogs([])
  }, [])

  const handleToggleLog = useCallback((): void => {
    setLogPanelOpen((v) => !v)
  }, [])

  // FIX #2: Rescan installed agents (referenced by ENOENT error message).
  const [rescanning, setRescanning] = useState(false)
  const handleRescan = useCallback(async (): Promise<void> => {
    setRescanning(true)
    try {
      const fresh = await window.agentHub.listAgents()
      // Preserve custom agents (not returned by the built-in scan).
      setAgents((prev) => {
        const customs = prev.filter((a) => a.id.startsWith('custom-'))
        return [...fresh, ...customs]
      })
    } catch (err: unknown) {
      console.error('Failed to rescan agents', err)
    } finally {
      setRescanning(false)
    }
  }, [])

  // FIX #5: Custom agent support — lets users add agents not in the built-in list.
  const handleAddCustomAgent = useCallback(async (command: string): Promise<boolean> => {
    const trimmed = command.trim()
    if (!trimmed) return false
    try {
      const result = await window.agentHub.probeAgent(trimmed)
      if (!result.ok) return false
      // Create a synthetic descriptor and add it to the agents list.
      const customDescriptor: AgentDescriptor = {
        id: `custom-${trimmed}`,
        name: trimmed,
        icon: '⚡',
        command: trimmed,
        description: `自定义 Agent (${result.resolvedPath ?? trimmed})`,
        outputMode: 'generic',
        printArgs: ['{PROMPT}'],
        resumeCapable: false,
        detected: true,
        resolvedPath: result.resolvedPath
      }
      setAgents((prev) => [...prev.filter((a) => a.id !== customDescriptor.id), customDescriptor])
      setSelectedAgentId(customDescriptor.id)
      return true
    } catch {
      return false
    }
  }, [])

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12
        }}
      >
        <div className="spinner" />
        <span style={{ color: 'var(--text-muted)' }}>加载中...</span>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="agent-hub">
      <SessionSidebar
        sessions={sessions}
        agents={agents}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNew={handleNewSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
      />

      <div className="agent-hub__main">
        <div className="agent-hub__toolbar">
          <AgentPicker
            agents={agents}
            value={selectedAgentId}
            onChange={handleAgentChange}
            onAddCustomAgent={handleAddCustomAgent}
          />
          <button
            className="btn btn--ghost agent-hub__rescan-btn"
            onClick={handleRescan}
            disabled={rescanning}
            title="重新扫描已安装的 Agent"
            style={{ fontSize: 14, padding: '6px 10px' }}
          >
            {rescanning ? '⟳...' : '⟳'}
          </button>
          <WorkDirPicker
            value={activeWorkDir}
            onChange={handleWorkDirChange}
            disabled={!activeSessionId}
          />
          <div className="agent-hub__toolbar-spacer" />
          <button
            className={`btn btn--icon ${logPanelOpen ? 'btn--icon--active' : ''}`}
            onClick={handleToggleLog}
            title={logPanelOpen ? '隐藏日志' : '显示日志'}
            style={{
              fontSize: 16,
              color: logPanelOpen ? 'var(--primary)' : undefined
            }}
          >
            ⎚
          </button>
        </div>

        <ChatView
          session={activeSession}
          agents={agents}
          logs={logs}
          logPanelOpen={logPanelOpen}
          onToggleLog={handleToggleLog}
          onClearLogs={handleClearLogs}
          onSend={handleSendMessage}
          onStop={handleStopSession}
          onPickWorkDir={handlePickWorkDir}
        />
      </div>
    </div>
  )
}
