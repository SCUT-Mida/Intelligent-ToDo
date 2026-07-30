import { useState, useEffect, useCallback, useRef } from 'react'
import SessionSidebar from '../../components/AgentHub/SessionSidebar'
import AgentPicker from '../../components/AgentHub/AgentPicker'
import WorkDirPicker from '../../components/AgentHub/WorkDirPicker'
import TerminalView from '../../components/AgentHub/TerminalView'
import type {
  AgentSession,
  AgentDescriptor,
  AgentHubData
} from '@shared/agentHub'
import { createDefaultAgentHubData } from '@shared/agentHub'
import '../../styles/agentHub.css'

interface RepoEntry {
  name: string
  path: string
}

/**
 * Root component for the Agent Hub sub-app.
 *
 * A session manager + terminal launcher. Users pick an agent + working directory,
 * click "launch", and a real OS terminal opens with the agent running.
 * Sessions are saved metadata (agent + workDir pair) for quick relaunch.
 */
export default function AgentHubApp(): JSX.Element {
  // ── State ──────────────────────────────────────────────────────────────

  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string>('claude')
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [loading, setLoading] = useState(true)

  // Refs to always have access to latest values in callbacks
  const selectedAgentIdRef = useRef(selectedAgentId)
  selectedAgentIdRef.current = selectedAgentId

  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const agentsRef = useRef(agents)
  agentsRef.current = agents

  const activeSessionIdRef = useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  // Counter-based persistence flag
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
        const [agentList, hubData, repoIndex] = await Promise.all([
          window.agentHub.listAgents(),
          window.agentHub.getSessions(),
          window.agentHub.getRepoIndex()
        ])
        setAgents(agentList)
        const data = hubData ?? createDefaultAgentHubData()
        setSessions(data.sessions)
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

  // ── Derived values ────────────────────────────────────────────────────

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null
  const activeWorkDir = activeSession?.workDir ?? ''

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleNewSession = useCallback((): void => {
    const agentId = selectedAgentIdRef.current
    const agent = agentsRef.current.find((a) => a.id === agentId)
    const newSession: AgentSession = {
      id: `sess-${Date.now().toString(36)}`,
      title: agent ? `${agent.name} 新会话` : '新会话',
      agentId,
      workDir: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      launchCount: 0,
      lastLaunchedAt: null
    }
    setSessions((prev) => [newSession, ...prev])
    setActiveSessionId(newSession.id)
    pendingSaveRef.current++
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
    const session = sessionsRef.current.find((s) => s.id === id)
    if (session) {
      setSelectedAgentId(session.agentId)
    }
  }, [])

  const handleAgentChange = useCallback((id: string): void => {
    setSelectedAgentId(id)
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
            title="重新扫描已安装的 Agent"
          >
            ⟳
          </button>
          <WorkDirPicker
            value={activeWorkDir}
            onChange={handleWorkDirChange}
            disabled={!activeSessionId}
            repos={repos}
          />
        </div>

        <div className="agent-hub__content">
          {activeSession ? (
            activeSession.workDir ? (
              <TerminalView
                key={activeSession.id}
                sessionId={activeSession.id}
                command={selectedAgent?.command ?? activeSession.agentId}
                workDir={activeSession.workDir}
              />
            ) : (
              <div className="agent-hub__workdir-prompt">
                <div className="agent-hub__workdir-prompt-icon">📁</div>
                <div className="agent-hub__workdir-prompt-text">
                  请先在上方工具栏选择工作目录
                </div>
                <div className="agent-hub__workdir-prompt-hint">
                  选择目录后，终端将在此处启动 {selectedAgent?.name ?? activeSession.agentId}
                </div>
              </div>
            )
          ) : (
            <div className="agent-hub__empty">
              <div className="agent-hub__empty-icon">💬</div>
              <div className="agent-hub__empty-text">
                选择一个会话或新建一个会话开始对话
              </div>
              <div className="agent-hub__empty-hint">
                Agent Hub 在应用内嵌入终端，支持 CLI 助手的全部原生交互
              </div>
              <button className="btn btn--primary" onClick={handleNewSession}>
                ＋ 新建会话
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
