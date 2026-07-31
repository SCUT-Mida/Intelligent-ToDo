import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppContext } from '../../store/AppContext'
import SessionSidebar from '../../components/AgentHub/SessionSidebar'
import NewSessionDialog from '../../components/AgentHub/NewSessionDialog'
import SessionHistoryDialog from '../../components/AgentHub/SessionHistoryDialog'
import MarkdownEditor from '../../components/AgentHub/MarkdownEditor'
import type { MarkdownHandle } from '../../components/AgentHub/MarkdownEditor'
import TerminalView from '../../components/AgentHub/TerminalView'
import type { TerminalHandle } from '../../components/AgentHub/TerminalView'
import type { AgentSession, AgentDescriptor, AgentHubData, SessionHistoryEntry } from '@shared/agentHub'
import { createDefaultAgentHubData } from '@shared/agentHub'
import '../../styles/agentHub.css'

interface RepoEntry {
  name: string
  path: string
}

/**
 * Shared column-resize helper. Attaches mousemove/mouseup listeners on window
 * for the duration of the drag and reports the new width through onWidth.
 * Used for both the session sidebar and the markdown editor columns.
 */
function startResizeDrag(
  e: React.MouseEvent,
  startWidth: number,
  min: number,
  max: number,
  onWidth: (w: number) => void
): void {
  e.preventDefault()
  const startX = e.clientX
  const onMove = (ev: MouseEvent): void => {
    const next = Math.min(max, Math.max(min, startWidth + (ev.clientX - startX)))
    onWidth(next)
  }
  const onUp = (): void => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

/**
 * Root component for the Agent Hub sub-app.
 *
 * A session manager + terminal launcher. Users create sessions via a dialog
 * (pick agent + workDir + title), then the embedded xterm.js terminal opens.
 * Sessions are saved metadata (agent + workDir pair) for quick relaunch.
 *
 * Supports cross-app jump from RepoNav via pendingAgentHubWorkDir.
 */
export default function AgentHubApp(): JSX.Element {
  const { state, clearPendingWorkDir } = useAppContext()

  // ── State ──────────────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('claude')
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Left-right column layout: sidebar width + collapse, shared markdown-editor width.
  const [sidebarWidth, setSidebarWidth] = useState(220)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mdWidth, setMdWidth] = useState(300)

  // Per-session question history (keyed by session id, newest last)
  const [histories, setHistories] = useState<Record<string, SessionHistoryEntry[]>>({})
  // Session whose history dialog is currently open (null = closed)
  const [historySessionId, setHistorySessionId] = useState<string | null>(null)

  // Dialog state
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false)
  const [pendingWorkDir, setPendingWorkDir] = useState<string | null>(null)
  const [defaultAgentId, setDefaultAgentId] = useState<string | undefined>(undefined)

  // Refs to always have access to latest values in callbacks
  const selectedAgentIdRef = useRef(selectedAgentId)
  selectedAgentIdRef.current = selectedAgentId

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const historiesRef = useRef(histories)
  historiesRef.current = histories

  const agentsRef = useRef(agents)
  agentsRef.current = agents

  const defaultAgentIdRef = useRef(defaultAgentId)
  defaultAgentIdRef.current = defaultAgentId

  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  // Embedded terminal handles, keyed by session id (for send-to-terminal).
  // The terminal stays mounted per session (v1.14.x PTY-persistence pattern).
  const terminalRefs = useRef(new Map<string, TerminalHandle>())

  // Markdown editor handles, keyed by session id (for history re-edit).
  const markdownRefs = useRef(new Map<string, MarkdownHandle>())

  // Counter-based persistence flag
  const pendingSaveRef = useRef(0)

  // Persist sessions + histories when flagged after a state change
  useEffect(() => {
    if (pendingSaveRef.current > 0) {
      pendingSaveRef.current = 0
      const data: AgentHubData = {
        version: 1,
        sessions,
        histories: historiesRef.current,
        lastAgentId: selectedAgentIdRef.current,
        defaultAgentId: defaultAgentIdRef.current,
        updatedAt: new Date().toISOString()
      }
      window.agentHub.saveSessions(data).catch((err: unknown) => {
        console.error('Failed to persist sessions', err)
      })
    }
  }, [sessions, histories])

  // ── Initialisation (mount) ────────────────────────────────────────────

  useEffect(() => {
    void (async () => {
      try {
        const [agentList, hubData, repoIndex] = await Promise.all([
          window.agentHub.listAgents(),
          window.agentHub.getSessions(),
          window.agentHub.getRepoIndex()
        ])
        setAgents(agentList)
        const data = hubData ?? createDefaultAgentHubData()
        setSessions(data.sessions)
        setHistories(data.histories ?? {})
        if (data.lastAgentId) {
          setSelectedAgentId(data.lastAgentId)
        }
        if (data.defaultAgentId) {
          setDefaultAgentId(data.defaultAgentId)
        }
        // Load repo index
        const idx = repoIndex as { repos: RepoEntry[] } | null
        if (idx?.repos) {
          setRepos(idx.repos)
        }
        // Auto-select first session if available
        if (data.sessions.length > 0) {
          setActiveSessionId(data.sessions[0].id)
          setSelectedAgentId(data.sessions[0].agentId)
        }
      } catch (err: unknown) {
        console.error('Failed to load agent hub data', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // Check for pendingAgentHubWorkDir (cross-app jump from RepoNav)
  useEffect(() => {
    if (loading) return
    const pending = state.pendingAgentHubWorkDir
    if (!pending) return
    clearPendingWorkDir()

    // If a default agent is configured AND detected, skip dialog — create directly.
    const defId = defaultAgentIdRef.current
    if (defId) {
      const agent = agentsRef.current.find((a) => a.id === defId && a.detected)
      if (agent) {
        const dirBasename = pending.split(/[\\/]/).pop() || pending
        const newSession: AgentSession = {
          id: `sess-${Date.now().toString(36)}`,
          title: `${agent.name} · ${dirBasename}`,
          agentId: agent.id,
          workDir: pending,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          launchCount: 0,
          lastLaunchedAt: null
        }
        setSessions((prev) => [newSession, ...prev])
        setActiveSessionId(newSession.id)
        setSelectedAgentId(agent.id)
        pendingSaveRef.current++
        return
      }
    }

    // No default agent — show dialog with workDir pre-filled
    setPendingWorkDir(pending)
    setShowNewSessionDialog(true)
  }, [loading, state.pendingAgentHubWorkDir, clearPendingWorkDir])

  // ── Derived values ────────────────────────────────────────────────────

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  // Session whose history dialog is open (derived non-null for the dialog props)
  const historySession = historySessionId
    ? (sessions.find((s) => s.id === historySessionId) ?? null)
    : null

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleOpenNewSession = useCallback((): void => {
    setPendingWorkDir(null)
    setShowNewSessionDialog(true)
  }, [])

  const handleDialogCreate = useCallback(
    (agentId: string, workDir: string, title: string, setAsDefault?: boolean): void => {
      const newSession: AgentSession = {
        id: `sess-${Date.now().toString(36)}`,
        title,
        agentId,
        workDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        launchCount: 0,
        lastLaunchedAt: null
      }
      setSessions((prev) => [newSession, ...prev])
      setActiveSessionId(newSession.id)
      setSelectedAgentId(agentId)
      if (setAsDefault) {
        setDefaultAgentId(agentId)
      }
      setShowNewSessionDialog(false)
      setPendingWorkDir(null)
      pendingSaveRef.current++
    },
    []
  )

  const handleDialogClose = useCallback((): void => {
    setShowNewSessionDialog(false)
    setPendingWorkDir(null)
  }, [])

  const handleDeleteSession = useCallback((id: string): void => {
    const session = sessionsRef.current.find((s) => s.id === id)
    if (session && session.launchCount > 0) {
      const confirmed = window.confirm(
        `确定要删除「${session.title}」吗？\n此会话已启动 ${session.launchCount} 次，删除后无法恢复。`
      )
      if (!confirmed) return
    }
    setSessions((prev) => prev.filter((s) => s.id !== id))
    setActiveSessionId((prev) => (prev === id ? null : prev))
    // Drop the session's markdown editor handle
    markdownRefs.current.delete(id)
    // Drop the session's question history too
    setHistories((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    // Close the history dialog if it was showing the deleted session
    setHistorySessionId((prev) => (prev === id ? null : prev))
    pendingSaveRef.current++
  }, [])

  // ── Question history ────────────────────────────────────────────────────

  // Record one entry per injection (markdown send or manual terminal paste).
  // Capped at 100 entries per session (newest last).
  const recordHistory = useCallback(
    (sessionId: string, content: string, source: 'markdown' | 'paste'): void => {
      const entry: SessionHistoryEntry = {
        id: `hist-${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        content,
        source
      }
      setHistories((prev) => ({
        ...prev,
        [sessionId]: [...(prev[sessionId] ?? []), entry].slice(-100)
      }))
    },
    []
  )

  // Send Markdown content into a specific session's terminal (as a paste).
  // Each session panel owns its own Markdown editor, so the target session id
  // is passed in explicitly instead of reading the active session.
  const handleSendToSession = useCallback(
    (sessionId: string, content: string): boolean => {
      const handle = terminalRefs.current.get(sessionId)
      if (!handle) return false
      const ok = handle.paste(content)
      if (ok) recordHistory(sessionId, content, 'markdown')
      return ok
    },
    [recordHistory]
  )

  const handleOpenHistory = useCallback((id: string): void => {
    setHistorySessionId(id)
  }, [])

  const handleCloseHistory = useCallback((): void => {
    setHistorySessionId(null)
  }, [])

  // Load a history entry back into that session's markdown editor for editing,
  // then close the dialog. The editor handle expands the panel if it was collapsed.
  const handleReEdit = useCallback((sessionId: string, content: string): void => {
    markdownRefs.current.get(sessionId)?.setContent(content)
    setHistorySessionId(null)
  }, [])

  const handleRenameSession = useCallback((id: string, title: string): void => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s))
    )
    pendingSaveRef.current++
  }, [])

  const handleSelectSession = useCallback((id: string): void => {
    setActiveSessionId(id)
    const session = sessionsRef.current.find((s) => s.id === id)
    if (session) {
      setSelectedAgentId(session.agentId)
    }
  }, [])

  const handleRescan = useCallback(async (): Promise<void> => {
    try {
      const fresh = await window.agentHub.listAgents()
      setAgents((prev) => {
        const customs = prev.filter((a) => a.id.startsWith('custom-'))
        return [...fresh, ...customs]
      })
    } catch (err: unknown) {
      console.error('Failed to rescan agents', err)
    }
  }, [])

  const handleAddCustomAgent = useCallback(async (command: string): Promise<boolean> => {
    const trimmed = command.trim()
    if (!trimmed) return false
    try {
      const result = await window.agentHub.probeAgent(trimmed)
      if (!result.ok) return false
      const customDescriptor: AgentDescriptor = {
        id: `custom-${trimmed}`,
        name: trimmed,
        icon: '⚡',
        command: trimmed,
        description: '自定义',
        outputMode: 'generic',
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

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)

  return (
    <div className="agent-hub">
      <SessionSidebar
        sessions={sessions}
        agents={agents}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onNew={handleOpenNewSession}
        onDelete={handleDeleteSession}
        onRename={handleRenameSession}
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onResize={(w) => setSidebarWidth(w)}
      />

      <div className="agent-hub__main">
        <div className="agent-hub__content">
          {sessions.length === 0 ? (
            <div className="agent-hub__empty">
              <div className="agent-hub__empty-icon">💬</div>
              <div className="agent-hub__empty-text">
                选择一个会话或新建一个会话开始对话
              </div>
              <div className="agent-hub__empty-hint">
                Agent Hub 在应用内嵌入终端，支持 CLI 助手的全部原生交互
              </div>
              <button className="btn btn--primary" onClick={handleOpenNewSession}>
                ＋ 新建会话
              </button>
            </div>
          ) : (
            <div className="agent-hub__terminal-wrapper">
              <div className="agent-hub__terminal-stack">
                {sessions.map((s) => {
                  const isActive = s.id === activeSessionId
                  const agent = agents.find((a) => a.id === s.agentId)
                  return (
                    <div
                      key={s.id}
                      className="agent-hub__terminal-panel"
                      style={{ display: isActive ? 'flex' : 'none' }}
                    >
                      {/* Per-session Markdown editor — each panel keeps its own
                          content state (panels stay always-mounted via display:none). */}
                      <MarkdownEditor
                        width={mdWidth}
                        onResize={(w) => setMdWidth(w)}
                        onOpenHistory={() => handleOpenHistory(s.id)}
                        ref={(handle) => {
                          if (handle) {
                            markdownRefs.current.set(s.id, handle)
                          } else {
                            markdownRefs.current.delete(s.id)
                          }
                        }}
                        onSend={(content) => handleSendToSession(s.id, content)}
                      />
                      {s.workDir ? (
                        <div className="agent-hub__terminal-area">
                          <TerminalView
                            sessionId={s.id}
                            command={agent?.command ?? s.agentId}
                            workDir={s.workDir}
                            active={isActive}
                            ref={(handle) => {
                              if (handle) {
                                terminalRefs.current.set(s.id, handle)
                              } else {
                                terminalRefs.current.delete(s.id)
                              }
                            }}
                            onPasted={(content) => recordHistory(s.id, content, 'paste')}
                          />
                        </div>
                      ) : (
                        <div className="agent-hub__workdir-prompt">
                          <div className="agent-hub__workdir-prompt-icon">📁</div>
                          <div className="agent-hub__workdir-prompt-text">
                            请选择工作目录
                          </div>
                          <div className="agent-hub__workdir-prompt-hint">
                            该会话缺少工作目录，请删除后重新创建
                          </div>
                          <button className="btn btn--primary" onClick={handleOpenNewSession} style={{ marginTop: 8 }}>
                            ＋ 新建会话
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Session Dialog */}
      {showNewSessionDialog && (
        <NewSessionDialog
          agents={agents}
          repos={repos}
          initialWorkDir={pendingWorkDir ?? undefined}
          onClose={handleDialogClose}
          onCreate={handleDialogCreate}
          onAddCustomAgent={handleAddCustomAgent}
        />
      )}

      {/* Session question history dialog */}
      {historySession && (
        <SessionHistoryDialog
          session={historySession}
          entries={histories[historySession.id] ?? []}
          onClose={handleCloseHistory}
          onReEdit={(entry) => handleReEdit(historySession.id, entry.content)}
        />
      )}
    </div>
  )
}
