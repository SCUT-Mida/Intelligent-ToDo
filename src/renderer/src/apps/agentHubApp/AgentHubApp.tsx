import { useState, useEffect, useCallback, useRef } from 'react'
import SessionSidebar from '../../components/AgentHub/SessionSidebar'
import AgentPicker from '../../components/AgentHub/AgentPicker'
import WorkDirPicker from '../../components/AgentHub/WorkDirPicker'
import type {
  AgentSession,
  AgentDescriptor,
  AgentHubData,
  LaunchResult
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
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)

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

  const handleLaunch = useCallback(async (): Promise<void> => {
    const session = sessionsRef.current.find((s) => s.id === activeSessionIdRef.current)
    if (!session) return
    if (!session.workDir) {
      setLaunchError('请先选择工作目录')
      return
    }
    const agent = agentsRef.current.find((a) => a.id === session.agentId)
    if (!agent) {
      setLaunchError(`未找到 Agent「${session.agentId}」`)
      return
    }
    setLaunchError(null)
    setLaunching(true)
    try {
      const result: LaunchResult = await window.agentHub.launch({
        command: agent.command,
        workDir: session.workDir
      })
      if (result.success) {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  launchCount: s.launchCount + 1,
                  lastLaunchedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString()
                }
              : s
          )
        )
        pendingSaveRef.current++
      } else {
        setLaunchError(result.error ?? '启动失败')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setLaunchError(msg)
    } finally {
      setLaunching(false)
    }
  }, [])

  const handleRescan = useCallback(async (): Promise<void> => {
    setLaunching(true)
    try {
      const fresh = await window.agentHub.listAgents()
      setAgents((prev) => {
        const customs = prev.filter((a) => a.id.startsWith('custom-'))
        return [...fresh, ...customs]
      })
    } catch (err: unknown) {
      console.error('Failed to rescan agents', err)
    } finally {
      setLaunching(false)
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

  const dismissError = useCallback((): void => {
    setLaunchError(null)
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
      {launchError && (
        <div className="agent-hub__error-banner">
          <span>{launchError}</span>
          <button className="agent-hub__error-close" onClick={dismissError}>
            ✕
          </button>
        </div>
      )}

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
            disabled={launching}
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
            <div className="agent-hub__detail-card">
              <div className="agent-hub__detail-header">
                <span className="agent-hub__detail-icon">
                  {selectedAgent?.icon ?? '🤖'}
                </span>
                <div className="agent-hub__detail-info">
                  <div className="agent-hub__detail-title">{activeSession.title}</div>
                  <div className="agent-hub__detail-meta">
                    <span>{selectedAgent?.name ?? activeSession.agentId}</span>
                    {activeSession.workDir && (
                      <>
                        <span className="agent-hub__detail-sep">·</span>
                        <span className="agent-hub__detail-dir" title={activeSession.workDir}>
                          {activeSession.workDir}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="agent-hub__detail-stats">
                <div className="agent-hub__detail-stat">
                  <span className="agent-hub__detail-stat-value">{activeSession.launchCount}</span>
                  <span className="agent-hub__detail-stat-label">启动次数</span>
                </div>
                <div className="agent-hub__detail-stat">
                  <span className="agent-hub__detail-stat-value">
                    {activeSession.lastLaunchedAt
                      ? new Date(activeSession.lastLaunchedAt).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '—'}
                  </span>
                  <span className="agent-hub__detail-stat-label">上次启动</span>
                </div>
                <div className="agent-hub__detail-stat">
                  <span className="agent-hub__detail-stat-value">
                    {new Date(activeSession.createdAt).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                  <span className="agent-hub__detail-stat-label">创建时间</span>
                </div>
              </div>

              {activeSession.workDir ? (
                <button
                  className="agent-hub__launch-btn"
                  onClick={handleLaunch}
                  disabled={launching}
                >
                  {launching ? '启动中…' : '🚀 在终端中启动'}
                </button>
              ) : (
                <div className="agent-hub__launch-hint">
                  请在上方工具栏中选择工作目录后启动
                </div>
              )}
            </div>
          ) : (
            <div className="agent-hub__empty">
              <div className="agent-hub__empty-icon">🚀</div>
              <div className="agent-hub__empty-text">
                选择一个会话或新建一个会话开始使用
              </div>
              <div className="agent-hub__empty-hint">
                Agent Hub 可以帮助你在系统终端中快速启动 AI 编程助手
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
