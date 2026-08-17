import { useState, useEffect, useCallback, useRef } from 'react'
import { useAppContext } from '../../store/AppContext'
import SessionSidebar from '../../components/AgentHub/SessionSidebar'
import NewSessionDialog from '../../components/AgentHub/NewSessionDialog'
import SessionHistoryDialog from '../../components/AgentHub/SessionHistoryDialog'
import TaskRunDialog from '../../components/AgentHub/TaskRunDialog'
import TaskTimeline from '../../components/AgentHub/TaskTimeline'
import MarkdownEditor from '../../components/AgentHub/MarkdownEditor'
import type { MarkdownHandle } from '../../components/AgentHub/MarkdownEditor'
import TerminalView from '../../components/AgentHub/TerminalView'
import type { TerminalHandle } from '../../components/AgentHub/TerminalView'
import type { AgentSession, AgentDescriptor, AgentDefinition, AgentHubData, AgentHubConfig, SessionHistoryEntry, TaskEvent, TaskRunInfo, SessionSearchHit } from '@shared/agentHub'
import { createDefaultAgentHubData, buildHandoffPrompt } from '@shared/agentHub'
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
  const { state, dispatch, clearPendingWorkDir, clearPendingAgentTask } = useAppContext()

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

  // ── Structured tasks (v1.23) ──────────────────────────────────────────
  // Per-session structured event log (loaded from main; appended live).
  const [sessionEvents, setSessionEvents] = useState<Record<string, TaskEvent[]>>({})
  // Live/recent runs from the main registry.
  const [taskRuns, setTaskRuns] = useState<TaskRunInfo[]>([])
  // Session whose task-run dialog is open (null = closed).
  const [taskDialogSessionId, setTaskDialogSessionId] = useState<string | null>(null)
  // Pre-filled prompt for the next opened task dialog (cross-app hand-off).
  const [taskDialogPrefill, setTaskDialogPrefill] = useState<string | undefined>(undefined)
  // Per-session right-pane tab: interactive terminal vs structured timeline.
  const [sessionTabs, setSessionTabs] = useState<Record<string, 'terminal' | 'tasks'>>({})
  // Cross-session search.
  const [searchResults, setSearchResults] = useState<SessionSearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  // Ephemeral flash banner (task write-back confirmations etc.).
  const [flash, setFlash] = useState<string | null>(null)

  // Dialog state
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false)
  const [pendingWorkDir, setPendingWorkDir] = useState<string | null>(null)

  // ── Todo → Agent hand-off bookkeeping (v1.24) ──────────────────────────
  // TaskId currently awaiting a task-dialog run (set when consuming
  // pendingAgentHubTask), and runId → taskId links for write-back.
  const pendingHandoffRef = useRef<string | null>(null)
  const taskLinksRef = useRef(new Map<string, string>())

  // Refs to always have access to latest values in callbacks
  const selectedAgentIdRef = useRef(selectedAgentId)
  selectedAgentIdRef.current = selectedAgentId

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const historiesRef = useRef(histories)
  historiesRef.current = histories

  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  const agentsRef = useRef(agents)
  agentsRef.current = agents

  const sessionEventsRef = useRef(sessionEvents)
  sessionEventsRef.current = sessionEvents

  const appStateRef = useRef(state.data)
  appStateRef.current = state.data

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
        // History is keyed by workDir (repo path). Remap any entries still
        // keyed by session id (pre-v1.18.3 shape) so they carry over.
        const rawHistories = data.histories ?? {}
        const remapped: Record<string, SessionHistoryEntry[]> = {}
        for (const [key, entries] of Object.entries(rawHistories)) {
          const session = data.sessions.find((s) => s.id === key)
          const newKey = session?.workDir || key
          remapped[newKey] = [...(remapped[newKey] ?? []), ...entries]
        }
        setHistories(remapped)
        if (data.lastAgentId) {
          setSelectedAgentId(data.lastAgentId)
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

  // Refresh agents list when the settings modal closes, so changes made in the
  // Agent Hub settings tab (agent args, custom agents) are reflected without
  // requiring a manual rescan. Skips the initial mount (handled by init effect).
  const skipFirstSettingsClose = useRef(true)
  useEffect(() => {
    if (state.settingsOpen) return
    if (skipFirstSettingsClose.current) {
      skipFirstSettingsClose.current = false
      return
    }
    void (async () => {
      try {
        const fresh = await window.agentHub.listAgents()
        setAgents(fresh)
      } catch {
        // non-fatal — keep the stale list
      }
    })()
  }, [state.settingsOpen])

  // ── Structured tasks: load persisted event logs + subscribe to live ones ──
  useEffect(() => {
    if (loading || sessions.length === 0) return
    void (async () => {
      try {
        const entries = await Promise.all(
          sessions.map(async (s) => [s.id, await window.agentHub.getSessionEvents(s.id)] as const)
        )
        setSessionEvents((prev) => {
          const next = { ...prev }
          for (const [id, events] of entries) next[id] = events
          return next
        })
      } catch (err) {
        console.error('Failed to load session event logs', err)
      }
    })()
  }, [loading, sessions.length])

  useEffect(() => {
    // Live events: append to the session's timeline if we know the session.
    const unsubEvents = window.agentHub.onTaskEvent((sessionId, event) => {
      setSessionEvents((prev) => {
        if (!prev[sessionId]) return prev // unknown session — skip until reload
        return { ...prev, [sessionId]: [...prev[sessionId], event] }
      })
    })
    const unsubDone = window.agentHub.onTaskDone((_sessionId, info) => {
      // Refresh the runs registry (running counts drive tab badges etc.).
      window.agentHub.listTasks().then(setTaskRuns).catch(() => { /* non-fatal */ })

      // Todo write-back (v1.24): runs launched via 「交给 Agent」 append
      // their result summary back to the task's notes.
      const linkedTaskId = taskLinksRef.current.get(info.runId)
      if (linkedTaskId && info.status === 'finished') {
        taskLinksRef.current.delete(info.runId)
        const events = sessionEventsRef.current[info.sessionId] ?? []
        const lastFinish = [...events].reverse().find((e) => e.type === 'run_finished')
        const summary = (lastFinish?.result || lastFinish?.text || '').trim()
        if (summary) {
          const now = new Date()
          const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          const data = appStateRef.current
          const tasks = data.tasks.map((t) =>
            t.id === linkedTaskId
              ? {
                  ...t,
                  notes: `${t.notes ? t.notes + '\n\n' : ''}[Agent 完成 @ ${stamp}]\n${summary.slice(0, 500)}`,
                  updatedAt: now.toISOString()
                }
              : t
          )
          dispatch({ type: 'SET_DATA', payload: { ...data, tasks } })
          setFlash(`Agent 任务完成，摘要已回写到任务「${data.tasks.find((t) => t.id === linkedTaskId)?.content ?? linkedTaskId}」的备注`)
          window.setTimeout(() => setFlash(null), 6000)
        }
      }
    })
    window.agentHub.listTasks().then(setTaskRuns).catch(() => { /* non-fatal */ })
    return () => {
      unsubEvents()
      unsubDone()
    }
  }, [dispatch])

  // Check for pendingAgentHubWorkDir (cross-app jump from RepoNav).
  // The jump ALWAYS opens the interactive dialog — the last-used agent is
  // preselected via initialAgentId={selectedAgentId} so the user can pick any
  // other agent (or confirm the remembered one).
  useEffect(() => {
    if (loading) return
    const pending = state.pendingAgentHubWorkDir
    if (!pending) return
    clearPendingWorkDir()
    setPendingWorkDir(pending)
    setShowNewSessionDialog(true)
  }, [loading, state.pendingAgentHubWorkDir, clearPendingWorkDir])

  // Consume a Todo → Agent task hand-off (v1.24): pre-fill the task dialog
  // on the active session (or the first one) and remember the task link so
  // the finished result writes back to the task's notes.
  useEffect(() => {
    if (loading) return
    const pending = state.pendingAgentHubTask
    if (!pending) return
    clearPendingAgentTask()
    if (sessions.length === 0) {
      setFlash('还没有 Agent 会话——请先「＋ 新建会话」（选好 agent 与工作目录），再从任务里使用「交给 Agent」')
      window.setTimeout(() => setFlash(null), 8000)
      return
    }
    const target = activeSessionIdRef.current ?? sessions[0].id
    setActiveSessionId(target)
    pendingHandoffRef.current = pending.taskId
    setTaskDialogPrefill(buildHandoffPrompt({ title: pending.title, notes: pending.notes }))
    setTaskDialogSessionId(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, state.pendingAgentHubTask])

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
    (agentId: string, workDir: string, title: string): void => {
      const newSession: AgentSession = {
        id: `sess-${Date.now().toString(36)}`,
        title,
        // 'rule' marks the heuristic title as replaceable by the LLM
        // auto-title on the session's first prompt (v1.22).
        titleKind: 'rule',
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
    // NOTE: question history is keyed by workDir (repo), NOT by session id,
    // so it intentionally survives session deletion — a new session opened
    // in the same repo will find the previous history.
    // Close the history dialog if it was showing the deleted session
    setHistorySessionId((prev) => (prev === id ? null : prev))
    pendingSaveRef.current++
  }, [])

  // ── Question history ────────────────────────────────────────────────────

  // Record one entry per Markdown send. History is keyed by the session's
  // workDir (repo) — NOT by session id — so it survives session deletion and
  // is shared across sessions opened in the same repo. Capped at 100 entries.
  const recordHistory = useCallback(
    (sessionId: string, content: string): void => {
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      const key = session?.workDir || sessionId
      const entry: SessionHistoryEntry = {
        id: `hist-${Date.now().toString(36)}`,
        at: new Date().toISOString(),
        content,
        source: 'markdown'
      }
      setHistories((prev) => ({
        ...prev,
        [key]: [...(prev[key] ?? []), entry].slice(-100)
      }))
      // Flag for persistence — without this the new entry would never be
      // written to disk (the persist effect only saves when flagged).
      pendingSaveRef.current++

      // v1.22 auto-title: the first prompt of a still-rule-titled session
      // asks the LLM for a short title (fire-and-forget; silent on failure
      // or when no AI config exists — the rule title stays).
      if (session && session.titleKind === 'rule') {
        const agentName =
          agentsRef.current.find((a) => a.id === session.agentId)?.name ?? session.agentId
        void window.api
          .generateSessionTitle(agentName, session.workDir, content)
          .then((title) => {
            if (!title) return
            setSessions((prev) =>
              prev.map((s) =>
                s.id === sessionId && s.titleKind === 'rule'
                  ? { ...s, title, titleKind: 'auto', updatedAt: new Date().toISOString() }
                  : s
              )
            )
            pendingSaveRef.current++
          })
          .catch(() => {
            /* silent — keep the rule-based title */
          })
      }
    },
    []
  )

  // Send Markdown content into a specific session's terminal (as a paste).
  // Each session panel owns its own Markdown editor, so the target session id
  // is passed in explicitly instead of reading the active session.
  const handleSendToSession = useCallback(
    (sessionId: string, content: string, submit?: boolean): boolean => {
      const handle = terminalRefs.current.get(sessionId)
      if (!handle) return false
      const ok = handle.paste(content, submit)
      if (ok) recordHistory(sessionId, content)
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
      prev.map((s) =>
        s.id === id
          ? { ...s, title, titleKind: 'manual', updatedAt: new Date().toISOString() }
          : s
      )
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
      // listAgents() now returns built-in + persisted custom agents merged in
      // the main process, so a plain refresh is enough — no manual re-merge.
      const fresh = await window.agentHub.listAgents()
      setAgents(fresh)
    } catch (err: unknown) {
      console.error('Failed to rescan agents', err)
    }
  }, [])

  // ── Structured task handlers (v1.23) ──────────────────────────────────

  const handleOpenTaskDialog = useCallback((sessionId: string, prefill?: string): void => {
    setTaskDialogPrefill(prefill)
    setTaskDialogSessionId(sessionId)
  }, [])

  const handleCloseTaskDialog = useCallback((): void => {
    setTaskDialogSessionId(null)
    setTaskDialogPrefill(undefined)
  }, [])

  const handleRunTask = useCallback(
    async (sessionId: string, prompt: string, background: boolean): Promise<void> => {
      const session = sessionsRef.current.find((s) => s.id === sessionId)
      if (!session) return
      const agent = agentsRef.current.find((a) => a.id === session.agentId) ?? null
      if (!agent) {
        console.error('Agent not found for task run', session.agentId)
        return
      }
      try {
        const result = await window.agentHub.runTask({
          sessionId,
          command: agent.command,
          outputMode: agent.outputMode,
          args: agent.args,
          workDir: session.workDir,
          prompt,
          background
        })
        if (!result.ok) {
          console.error('Task run failed to start', result.error)
          pendingHandoffRef.current = null
          return
        }
        // Link this run to the handed-off Todo task (if any) for write-back.
        if (pendingHandoffRef.current && result.runId) {
          taskLinksRef.current.set(result.runId, pendingHandoffRef.current)
          pendingHandoffRef.current = null
        }
        // Ensure the timeline tracks this session even if it was never loaded.
        setSessionEvents((prev) => (prev[sessionId] ? prev : { ...prev, [sessionId]: [] }))
        window.agentHub.listTasks().then(setTaskRuns).catch(() => { /* non-fatal */ })
        handleCloseTaskDialog()
        if (!background) {
          setSessionTabs((prev) => ({ ...prev, [sessionId]: 'tasks' }))
        }
      } catch (err) {
        console.error('Task run failed', err)
      }
    },
    [handleCloseTaskDialog]
  )

  const handleCancelRun = useCallback((runId: string): void => {
    window.agentHub.cancelTask(runId).catch(() => { /* non-fatal */ })
  }, [])

  const handleSetSessionTab = useCallback((sessionId: string, tab: 'terminal' | 'tasks'): void => {
    setSessionTabs((prev) => ({ ...prev, [sessionId]: tab }))
  }, [])

  // ── Cross-session search (v1.23) ──────────────────────────────────────

  const handleSearch = useCallback((query: string): void => {
    const q = query.trim()
    if (q.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }
    setSearching(true)
    window.agentHub
      .searchSessions(q)
      .then((hits) => setSearchResults(hits))
      .catch(() => setSearchResults([]))
      .finally(() => setSearching(false))
  }, [])

  const handleSelectSearchResult = useCallback((hit: SessionSearchHit): void => {
    if (hit.sessionId) {
      setActiveSessionId(hit.sessionId)
      if (hit.source !== 'prompt') {
        setSessionTabs((prev) => ({ ...prev, [hit.sessionId as string]: 'tasks' }))
      }
    }
  }, [])

  const handleAddCustomAgent = useCallback(async (command: string): Promise<boolean> => {
    const trimmed = command.trim()
    if (!trimmed) return false
    try {
      const result = await window.agentHub.probeAgent(trimmed)
      if (!result.ok) return false
      const id = `custom-${trimmed}`
      const newAgent: AgentDefinition = {
        id,
        name: trimmed,
        icon: '⚡',
        command: trimmed,
        description: '自定义',
        outputMode: 'generic'
      }
      // Persist to config so the custom agent survives restart. Previously
      // custom agents were in-memory only, which broke sessions referencing
      // `custom-<command>` ids after the app was closed and reopened.
      const config = await window.agentHub.getAgentConfig()
      if (!config.customAgents.some((a) => a.id === id)) {
        const updated: AgentHubConfig = {
          ...config,
          customAgents: [...config.customAgents, newAgent],
          updatedAt: new Date().toISOString()
        }
        await window.agentHub.saveAgentConfig(updated)
      }
      // Refresh the agents list — main now returns the merged result so the
      // new custom agent appears with detection + args applied.
      const fresh = await window.agentHub.listAgents()
      setAgents(fresh)
      setSelectedAgentId(id)
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
        onSearch={handleSearch}
        searchResults={searchResults}
        searching={searching}
        onSelectResult={handleSelectSearchResult}
      />

      <div className="agent-hub__main">
        {/* Flash banner (write-back confirmations, hand-off hints). */}
        {flash && (
          <div className="agent-hub__flash">
            {flash}
            <button className="agent-hub__flash-close" onClick={() => setFlash(null)} aria-label="关闭">×</button>
          </div>
        )}
        {/* Background task indicator (v1.24): running tasks across sessions.
            Clicking jumps to that session's 任务记录 tab. */}
        {taskRuns.filter((r) => r.status === 'running').length > 0 && (
          <div className="agent-hub__tasks-bar">
            <span className="spinner spinner--sm" />
            <span className="agent-hub__tasks-bar-label">
              {taskRuns.filter((r) => r.status === 'running').length} 个任务后台运行中
            </span>
            {taskRuns
              .filter((r) => r.status === 'running')
              .slice(0, 4)
              .map((r) => (
                <button
                  key={r.runId}
                  className="agent-hub__tasks-bar-chip"
                  title={`${r.command}\n${r.workDir}`}
                  onClick={() => {
                    setActiveSessionId(r.sessionId)
                    setSessionTabs((prev) => ({ ...prev, [r.sessionId]: 'tasks' }))
                  }}
                >
                  {r.command} · {r.workDir.split(/[\\/]/).pop()}
                </button>
              ))}
          </div>
        )}
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
                  const tab = sessionTabs[s.id] ?? 'terminal'
                  const runningHere = taskRuns.filter(
                    (r) => r.sessionId === s.id && r.status === 'running'
                  ).length
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
                        onSend={(content, submit) => handleSendToSession(s.id, content, submit)}
                      />
                      {s.workDir ? (
                        <div className="agent-hub__terminal-area">
                          <div className="agent-hub__panel-header">
                            <div className="agent-hub__panel-tabs">
                              <button
                                className={`agent-hub__panel-tab ${tab === 'terminal' ? 'agent-hub__panel-tab--active' : ''}`}
                                onClick={() => handleSetSessionTab(s.id, 'terminal')}
                              >
                                终端
                              </button>
                              <button
                                className={`agent-hub__panel-tab ${tab === 'tasks' ? 'agent-hub__panel-tab--active' : ''}`}
                                onClick={() => handleSetSessionTab(s.id, 'tasks')}
                              >
                                任务记录{runningHere > 0 ? ` ⏳${runningHere}` : ''}
                              </button>
                            </div>
                            <button
                              className="btn btn--ghost agent-hub__panel-run"
                              onClick={() => handleOpenTaskDialog(s.id)}
                              title="以非交互方式运行一次性任务（输出解析为结构化时间线）"
                            >
                              ▶ 运行任务
                            </button>
                          </div>
                          {/* TerminalView stays MOUNTED across tab switches so
                              the live PTY session survives (same reason panels
                              stay mounted across app switches). */}
                          <div
                            className="agent-hub__terminal-holder"
                            style={{ display: tab === 'terminal' ? 'flex' : 'none' }}
                          >
                            <TerminalView
                              sessionId={s.id}
                              command={agent?.command ?? s.agentId}
                              args={agent?.args}
                              workDir={s.workDir}
                              active={isActive && tab === 'terminal'}
                              ref={(handle) => {
                                if (handle) {
                                  terminalRefs.current.set(s.id, handle)
                                } else {
                                  terminalRefs.current.delete(s.id)
                                }
                              }}
                            />
                          </div>
                          {tab === 'tasks' && (
                            <TaskTimeline
                              sessionId={s.id}
                              events={sessionEvents[s.id] ?? []}
                              runs={taskRuns}
                              onCancelRun={handleCancelRun}
                              onRerun={() => handleOpenTaskDialog(s.id)}
                            />
                          )}
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
          initialAgentId={selectedAgentId}
          onClose={handleDialogClose}
          onCreate={handleDialogCreate}
          onAddCustomAgent={handleAddCustomAgent}
        />
      )}

      {/* Session question history dialog */}
      {historySession && (
        <SessionHistoryDialog
          session={historySession}
          entries={histories[historySession.workDir] ?? []}
          onClose={handleCloseHistory}
          onReEdit={(entry) => handleReEdit(historySession.id, entry.content)}
        />
      )}

      {/* Structured task run dialog (v1.23) */}
      {taskDialogSessionId && (() => {
        const session = sessions.find((s) => s.id === taskDialogSessionId)
        if (!session) return null
        const agent = agents.find((a) => a.id === session.agentId) ?? null
        return (
          <TaskRunDialog
            sessionTitle={session.title}
            agent={agent}
            workDir={session.workDir}
            initialPrompt={taskDialogPrefill}
            onClose={handleCloseTaskDialog}
            onRun={(prompt, background) => {
              void handleRunTask(session.id, prompt, background)
            }}
          />
        )
      })()}
    </div>
  )
}
