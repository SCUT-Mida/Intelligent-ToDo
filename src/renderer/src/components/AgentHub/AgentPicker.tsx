import { useState, useRef, useEffect } from 'react'
import type { AgentDescriptor } from '@shared/agentHub'

interface AgentPickerProps {
  agents: AgentDescriptor[]
  value: string
  onChange: (id: string) => void
  /** Optional: called when user adds a custom agent command. Returns true on success. */
  onAddCustomAgent?: (command: string) => Promise<boolean>
}

/**
 * Custom dropdown for selecting an AI agent to launch.
 * Shows detected agents first, undetected agents greyed out with "未安装" hint.
 * Includes a "自定义 Agent…" option for entering a custom command.
 */
export default function AgentPicker({ agents, value, onChange, onAddCustomAgent }: AgentPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customCmd, setCustomCmd] = useState('')
  const [customProbing, setCustomProbing] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = agents.find((a) => a.id === value)

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Sort: detected first, then undetected
  const sorted = [...agents].sort((a, b) => {
    if (a.detected && !b.detected) return -1
    if (!a.detected && b.detected) return 1
    return 0
  })

  function handleSelect(id: string): void {
    onChange(id)
    setOpen(false)
  }

  async function handleAddCustom(): Promise<void> {
    if (!onAddCustomAgent) return
    const cmd = customCmd.trim()
    if (!cmd) return
    setCustomProbing(true)
    setCustomError(null)
    try {
      const ok = await onAddCustomAgent(cmd)
      if (ok) {
        setCustomCmd('')
        setShowCustomInput(false)
        setOpen(false)
      } else {
        setCustomError(`未找到命令「${cmd}」，请确认已安装并在 PATH 中`)
      }
    } catch {
      setCustomError('检测失败，请重试')
    } finally {
      setCustomProbing(false)
    }
  }

  return (
    <div className="agent-picker" ref={containerRef}>
      <button
        className={`agent-picker__trigger ${open ? 'agent-picker__trigger--open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {selected && <span className="agent-picker__trigger-icon">{selected.icon}</span>}
        <span>{selected?.name ?? '选择 Agent'}</span>
        <span className="agent-picker__trigger-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="agent-picker__dropdown">
          {sorted.map((agent) => {
            const isSelected = agent.id === value
            return (
              <div
                key={agent.id}
                className={`agent-picker__option ${isSelected ? 'agent-picker__option--selected' : ''} ${!agent.detected ? 'agent-picker__option--undetected' : ''}`}
                onClick={() => handleSelect(agent.id)}
              >
                <span className="agent-picker__option-icon">{agent.icon}</span>
                <div className="agent-picker__option-info">
                  <div className="agent-picker__option-name">{agent.name}</div>
                  <div className="agent-picker__option-desc">{agent.description}</div>
                </div>
                {agent.detected ? (
                  <span
                    className="agent-picker__option-status agent-picker__option-status--detected"
                    title="已检测到"
                  >
                    ● 已就绪
                  </span>
                ) : (
                  <span
                    className="agent-picker__option-status agent-picker__option-status--missing"
                    title="未安装"
                  >
                    未安装
                  </span>
                )}
                {isSelected && <span className="agent-picker__option-check">✓</span>}
              </div>
            )
          })}

          {/* Custom agent input */}
          {onAddCustomAgent && (
            <>
              <div className="agent-picker__divider" />
              {!showCustomInput ? (
                <div
                  className="agent-picker__option agent-picker__option--custom"
                  onClick={() => setShowCustomInput(true)}
                >
                  <span className="agent-picker__option-icon">⚡</span>
                  <span className="agent-picker__option-name">自定义 Agent…</span>
                </div>
              ) : (
                <div className="agent-picker__custom-form">
                  <input
                    type="text"
                    className="agent-picker__custom-input"
                    placeholder="输入命令名，如: claude, gemini…"
                    value={customCmd}
                    onChange={(e) => setCustomCmd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAddCustom()
                      if (e.key === 'Escape') {
                        setShowCustomInput(false)
                        setCustomCmd('')
                        setCustomError(null)
                      }
                    }}
                    autoFocus
                  />
                  <div className="agent-picker__custom-actions">
                    <button
                      className="btn btn--primary agent-picker__custom-confirm"
                      onClick={() => void handleAddCustom()}
                      disabled={customProbing || !customCmd.trim()}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      {customProbing ? '检测中…' : '确认'}
                    </button>
                    <button
                      className="btn btn--ghost agent-picker__custom-cancel"
                      onClick={() => {
                        setShowCustomInput(false)
                        setCustomCmd('')
                        setCustomError(null)
                      }}
                      style={{ fontSize: 12, padding: '4px 10px' }}
                    >
                      取消
                    </button>
                  </div>
                  {customError && (
                    <div className="agent-picker__custom-error">{customError}</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
