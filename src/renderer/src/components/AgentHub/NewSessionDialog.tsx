import { useState, useCallback, useEffect } from 'react'
import AgentPicker from './AgentPicker'
import WorkDirPicker from './WorkDirPicker'
import type { AgentDescriptor } from '@shared/agentHub'

interface RepoEntry {
  name: string
  path: string
}

interface NewSessionDialogProps {
  agents: AgentDescriptor[]
  repos: RepoEntry[]
  /** Pre-filled workDir when jumping from RepoNav. */
  initialWorkDir?: string
  /** Preferred preselected agent (the last-used one); falls back if unknown. */
  initialAgentId?: string
  onClose: () => void
  /** Called with (agentId, workDir, title) when user confirms creation. */
  onCreate: (agentId: string, workDir: string, title: string) => void
  onAddCustomAgent?: (command: string) => Promise<boolean>
}

/**
 * Modal dialog for creating a new Agent Hub session.
 *
 * Contains:
 *  - Agent picker (reuses AgentPicker component, preselected to the last-used
 *    agent passed via initialAgentId when it exists)
 *  - Work directory picker with repo dropdown (reuses WorkDirPicker)
 *  - Auto-suggested editable title
 *  - Create / Cancel buttons
 *
 * The dialog appears when clicking "新建会话" in the sidebar or empty state,
 * or when jumping from RepoNav with a pre-filled workDir.
 */
export default function NewSessionDialog({
  agents,
  repos,
  initialWorkDir,
  initialAgentId,
  onClose,
  onCreate,
  onAddCustomAgent
}: NewSessionDialogProps): JSX.Element {
  // Preferred agent: the last-used one (initialAgentId) if present in the list,
  // else the first detected agent, else the first agent, else 'claude'.
  const [agentId, setAgentId] = useState(() => {
    if (initialAgentId && agents.some((a) => a.id === initialAgentId)) {
      return initialAgentId
    }
    return agents.find((a) => a.detected)?.id ?? agents[0]?.id ?? 'claude'
  })
  const [workDir, setWorkDir] = useState(initialWorkDir ?? '')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)

  const canCreate = agentId.length > 0 && workDir.length > 0

  // Auto-suggest title from agent name + dir basename
  const suggestTitle = useCallback(
    (agId: string, dir: string): string => {
      const agent = agents.find((a) => a.id === agId)
      const agentName = agent?.name ?? agId
      if (!dir) return `${agentName} 新会话`
      const parts = dir.replace(/\\/g, '/').split('/')
      const base = parts[parts.length - 1] ?? ''
      return `${agentName} · ${base}`
    },
    [agents]
  )

  // Update title when agent or workDir changes (if not manually edited)
  useEffect(() => {
    if (!titleTouched) {
      setTitle(suggestTitle(agentId, workDir))
    }
  }, [agentId, workDir, titleTouched, suggestTitle])

  // When initialWorkDir changes externally (e.g., first mount), reset titleTouched
  useEffect(() => {
    setTitleTouched(false)
    setWorkDir(initialWorkDir ?? '')
  }, [initialWorkDir])

  const handleAgentChange = useCallback((id: string): void => {
    setAgentId(id)
  }, [])

  const handleWorkDirChange = useCallback((path: string): void => {
    setWorkDir(path)
  }, [])

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      setTitleTouched(true)
      setTitle(e.target.value)
    },
    []
  )

  const handleCreate = useCallback((): void => {
    if (!canCreate) return
    const finalTitle = title.trim() || suggestTitle(agentId, workDir)
    onCreate(agentId, workDir, finalTitle)
  }, [canCreate, title, suggestTitle, agentId, workDir, onCreate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === 'Enter' && canCreate) {
        handleCreate()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [canCreate, handleCreate, onClose]
  )

  return (
    <div
      className="new-session-dialog"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="new-session-dialog__box">
        <div className="new-session-dialog__heading">新建会话</div>

        {/* Agent picker field */}
        <div className="new-session-dialog__field">
          <div className="new-session-dialog__label">Agent</div>
          <AgentPicker
            agents={agents}
            value={agentId}
            onChange={handleAgentChange}
            onAddCustomAgent={onAddCustomAgent}
          />
        </div>

        {/* Work directory field */}
        <div className="new-session-dialog__field">
          <div className="new-session-dialog__label">工作目录</div>
          <WorkDirPicker
            value={workDir}
            onChange={handleWorkDirChange}
            disabled={false}
            repos={repos}
          />
        </div>

        {/* Title field */}
        <div className="new-session-dialog__field">
          <div className="new-session-dialog__label">会话标题</div>
          <input
            className="new-session-dialog__input"
            type="text"
            value={title}
            onChange={handleTitleChange}
            placeholder={suggestTitle(agentId, workDir)}
            autoFocus={!initialWorkDir}
          />
        </div>

        {/* Actions */}
        <div className="new-session-dialog__actions">
          <button className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
          <button
            className="btn btn--primary"
            disabled={!canCreate}
            onClick={handleCreate}
          >
            创建会话
          </button>
        </div>
      </div>
    </div>
  )
}
