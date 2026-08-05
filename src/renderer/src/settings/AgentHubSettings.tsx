import { useState, useEffect, useCallback } from 'react'
import type { AgentHubConfig, AgentDefinition, AgentDescriptor } from '@shared/agentHub'
import { createDefaultAgentHubConfig } from '@shared/agentHub'
import Section from '../components/Section'

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Deep-clone via JSON round-trip (cfg is plain data). */
function cloneConfig(cfg: AgentHubConfig): AgentHubConfig {
  return JSON.parse(JSON.stringify(cfg)) as AgentHubConfig
}

/* ── Status type ──────────────────────────────────────────────────────────── */

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; msg: string }

/* ── Custom agent row (inline helper) ─────────────────────────────────────── */

interface CustomAgentRowProps {
  agent: AgentDefinition
  detected?: boolean
  resolvedPath?: string
  onChange: (field: 'name' | 'icon' | 'command' | 'description', value: string) => void
  onDelete: () => void
  onProbe: () => void
  probing: boolean
  probeOk?: boolean | null
  probeOutput?: string
}

function CustomAgentRow({
  agent, detected, onChange, onDelete, onProbe, probing, probeOk, probeOutput
}: CustomAgentRowProps): JSX.Element {
  return (
    <div className="tpl-card agent-settings__custom-card">
      <div className="tpl-card__head">
        <input
          className="input agent-settings__icon-input"
          value={agent.icon}
          onChange={(e) => onChange('icon', e.target.value)}
          placeholder="图标"
          title="显示图标（emoji 或字符）"
          maxLength={4}
        />
        <input
          className="input tpl-card__name"
          value={agent.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="名称（如：Aider）"
        />
        <input
          className="input tpl-card__desc"
          value={agent.command}
          onChange={(e) => onChange('command', e.target.value)}
          placeholder="命令（如：aider）"
        />
        <button
          type="button"
          className="btn btn--ghost tpl-card__del"
          onClick={onDelete}
          title="删除自定义 Agent"
        >
          删除
        </button>
      </div>
      <div className="agent-settings__custom-meta">
        <input
          className="input agent-settings__desc-input"
          value={agent.description}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder="描述（可选）"
        />
        <button
          type="button"
          className="btn btn--ghost agent-settings__probe-btn"
          onClick={onProbe}
          disabled={probing || !agent.command.trim()}
          title="检测命令是否可用"
        >
          {probing ? '检测中…' : '检测'}
        </button>
      </div>
      {detected === true && (
        <div className="field__hint field__hint--success">
          ✓ 已检测到{probeOutput ? `：${probeOutput.slice(0, 80)}` : ''}
        </div>
      )}
      {probeOk === false && (
        <div className="field__hint field__hint--error">
          ✗ 未找到命令「{agent.command}」，请确认已安装并在 PATH 中
        </div>
      )}
    </div>
  )
}

/* ── Component ────────────────────────────────────────────────────────────── */

/**
 * Agent Hub settings panel — configure per-agent startup args and manage
 * custom agent definitions.
 *
 * Two sections:
 *   1. "Agent 启动参数" — list ALL agents (built-in + custom) with an args
 *      input per agent. Writes to `cfg.agentArgs[id]`.
 *   2. "自定义 Agent" — CRUD for `cfg.customAgents`. Add/edit/delete custom
 *      agent definitions; probe to verify the command exists.
 *
 * Follows the RepoNavSettings pattern: Section components, status feedback,
 * Save/Reset footer, defensive config loading.
 */
export default function AgentHubSettings(): JSX.Element {
  const [cfg, setCfg] = useState<AgentHubConfig | null>(null)
  const [agents, setAgents] = useState<AgentDescriptor[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })

  /* ── "Add custom agent" form state ─────────────────────────────────────── */
  const [newCmd, setNewCmd] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  /* ── Per-row probe state (keyed by agent command) ─────────────────────── */
  const [probeStates, setProbeStates] = useState<
    Record<string, { probing: boolean; ok: boolean | null; output?: string }>
  >({})

  /* ── Load config + agent list on mount ────────────────────────────────── */
  useEffect(() => {
    void (async () => {
      try {
        const [loaded, agentList] = await Promise.all([
          window.agentHub.getAgentConfig(),
          window.agentHub.listAgents()
        ])
        setCfg({
          version: 1,
          customAgents: Array.isArray(loaded.customAgents) ? loaded.customAgents : [],
          agentArgs: (loaded.agentArgs && typeof loaded.agentArgs === 'object') ? loaded.agentArgs : {},
          updatedAt: loaded.updatedAt ?? new Date().toISOString()
        })
        setAgents(agentList)
      } catch (e) {
        setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
        setCfg(createDefaultAgentHubConfig())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  /* ── Clear saved status after 3s ──────────────────────────────────────── */
  useEffect(() => {
    if (status.kind !== 'saved') return
    const id = window.setTimeout(() => setStatus({ kind: 'idle' }), 3000)
    return () => window.clearTimeout(id)
  }, [status.kind])

  /* ── Args editing (per-agent, writes to cfg.agentArgs) ─────────────────── */
  const updateAgentArgs = useCallback((agentId: string, value: string) => {
    setCfg((prev) => {
      if (!prev) return prev
      const next = { ...prev.agentArgs }
      if (value.trim() === '') {
        delete next[agentId]
      } else {
        next[agentId] = value
      }
      return { ...prev, agentArgs: next }
    })
  }, [])

  /* ── Custom agent CRUD ─────────────────────────────────────────────────── */
  const updateCustomAgent = useCallback(
    (index: number, field: 'name' | 'icon' | 'command' | 'description', value: string) => {
      setCfg((prev) => {
        if (!prev) return prev
        const customAgents = [...prev.customAgents]
        customAgents[index] = { ...customAgents[index], [field]: value }
        return { ...prev, customAgents }
      })
    },
    []
  )

  const removeCustomAgent = useCallback((index: number) => {
    setCfg((prev) => {
      if (!prev) return prev
      const target = prev.customAgents[index]
      if (!target) return prev
      // Also clean up orphan args entry for this agent id
      const nextArgs = { ...prev.agentArgs }
      delete nextArgs[target.id]
      return {
        ...prev,
        customAgents: prev.customAgents.filter((_, i) => i !== index),
        agentArgs: nextArgs
      }
    })
  }, [])

  const handleAddCustom = useCallback(async (): Promise<void> => {
    const cmd = newCmd.trim()
    if (!cmd) return
    setAdding(true)
    setAddError('')
    try {
      const result = await window.agentHub.probeAgent(cmd)
      if (!result.ok) {
        setAddError(`未找到命令「${cmd}」，请确认已安装并在 PATH 中`)
        return
      }
      const id = `custom-${cmd}`
      setCfg((prev) => {
        if (!prev) return prev
        // Avoid duplicate id
        if (prev.customAgents.some((a) => a.id === id)) {
          setAddError('该自定义 Agent 已存在')
          return prev
        }
        const newAgent: AgentDefinition = {
          id,
          name: cmd,
          icon: '⚡',
          command: cmd,
          description: '自定义',
          outputMode: 'generic'
        }
        return { ...prev, customAgents: [...prev.customAgents, newAgent] }
      })
      setNewCmd('')
    } catch {
      setAddError('检测失败，请重试')
    } finally {
      setAdding(false)
    }
  }, [newCmd])

  /* ── Probe a custom agent's command ────────────────────────────────────── */
  const probeCustomAgent = useCallback(async (command: string) => {
    const cmd = command.trim()
    if (!cmd) return
    setProbeStates((prev) => ({ ...prev, [cmd]: { probing: true, ok: null } }))
    try {
      const result = await window.agentHub.probeAgent(cmd)
      setProbeStates((prev) => ({
        ...prev,
        [cmd]: { probing: false, ok: result.ok, output: result.output }
      }))
    } catch (e) {
      setProbeStates((prev) => ({
        ...prev,
        [cmd]: { probing: false, ok: false, output: e instanceof Error ? e.message : String(e) }
      }))
    }
  }, [])

  /* ── Validation ───────────────────────────────────────────────────────── */
  const validate = useCallback((c: AgentHubConfig): string | null => {
    for (const a of c.customAgents) {
      if (!a.name.trim()) return '每个自定义 Agent 需要名称'
      if (!a.command.trim()) return '每个自定义 Agent 需要命令'
    }
    // Check for duplicate ids
    const ids = c.customAgents.map((a) => a.id)
    if (new Set(ids).size !== ids.length) return '自定义 Agent ID 不能重复'
    return null
  }, [])

  /* ── Save ──────────────────────────────────────────────────────────────── */
  const handleSave = useCallback(async () => {
    if (!cfg) return
    const err = validate(cfg)
    if (err) {
      setStatus({ kind: 'error', msg: err })
      return
    }
    setStatus({ kind: 'saving' })
    try {
      // Clean orphan agentArgs entries (ids that no longer correspond to any agent)
      const allAgentIds = new Set<string>([
        ...cfg.customAgents.map((a) => a.id),
        ...agents.map((a) => a.id) // built-in ids
      ])
      const cleanedArgs: Record<string, string> = {}
      for (const [id, value] of Object.entries(cfg.agentArgs)) {
        if (allAgentIds.has(id)) {
          cleanedArgs[id] = value
        }
      }
      const payload: AgentHubConfig = {
        ...cfg,
        agentArgs: cleanedArgs,
        updatedAt: new Date().toISOString()
      }
      await window.agentHub.saveAgentConfig(payload)
      setCfg(payload)
      setStatus({ kind: 'saved' })
      // Refresh the agents list so newly-added customs show up in the args section
      try {
        const fresh = await window.agentHub.listAgents()
        setAgents(fresh)
      } catch {
        // non-fatal — the save itself succeeded
      }
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }, [cfg, agents, validate])

  /* ── Reset to defaults ────────────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    if (!window.confirm('确定清空所有自定义 Agent 和启动参数？')) return
    setCfg(createDefaultAgentHubConfig())
    setStatus({ kind: 'idle' })
  }, [])

  /* ── Loading state ────────────────────────────────────────────────────── */
  if (loading || cfg === null) {
    return (
      <div className="agent-settings">
        <div className="repo-nav-settings__loading">
          <div className="spinner" />
          <span>正在加载配置…</span>
        </div>
      </div>
    )
  }

  /* ── Derived: merge detected status for custom agents ─────────────────── */
  const customAgentDetected = (agent: AgentDefinition): {
    detected: boolean
    resolvedPath?: string
  } => {
    const desc = agents.find((a) => a.id === agent.id)
    return { detected: desc?.detected ?? false, resolvedPath: desc?.resolvedPath }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  const isSaving = status.kind === 'saving'
  const saveDisabled = loading || isSaving

  return (
    <div className="agent-settings">

      {/* ─── Agent 启动参数 ─── */}
      <Section title="Agent 启动参数" icon="⚙️" label="参数" defaultOpen={true}>
        <div className="field">
          <label className="field__label">启动参数（可选）</label>
          <div className="field__hint" style={{ marginBottom: 8 }}>
            为每个 Agent 配置启动时附加的命令行参数（如 <code>--model opus</code>、<code>--no-git</code>）。
            支持双引号包裹含空格的值。留空则不附加参数。
          </div>
          {agents.length === 0 ? (
            <div className="scan-root-list__empty">未检测到任何 Agent</div>
          ) : (
            <div className="agent-settings__args-list">
              {agents.map((agent) => (
                <div key={agent.id} className="agent-settings__args-row">
                  <span className="agent-settings__args-icon" title={agent.description}>
                    {agent.icon}
                  </span>
                  <div className="agent-settings__args-info">
                    <div className="agent-settings__args-name">
                      {agent.name}
                      {!agent.detected && (
                        <span className="agent-picker__option-status agent-picker__option-status--missing">
                          未安装
                        </span>
                      )}
                    </div>
                    <div className="agent-settings__args-cmd">{agent.command}</div>
                  </div>
                  <input
                    className="input agent-settings__args-input"
                    placeholder="如：--model opus"
                    value={cfg.agentArgs[agent.id] ?? ''}
                    onChange={(e) => updateAgentArgs(agent.id, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ─── 自定义 Agent ─── */}
      <Section title="自定义 Agent" icon="⚡" label="自定义" defaultOpen={false}>
        <div className="field">
          <label className="field__label">自定义 Agent 列表</label>
          <div className="field__hint" style={{ marginBottom: 8 }}>
            添加自定义 CLI Agent。配置后可在 Agent Hub 中选择并启动，参数可在上方配置。
          </div>

          {cfg.customAgents.length === 0 ? (
            <div className="scan-root-list__empty">暂无自定义 Agent，在下方添加</div>
          ) : (
            <div className="agent-settings__custom-list">
              {cfg.customAgents.map((agent, i) => {
                const { detected } = customAgentDetected(agent)
                const ps = probeStates[agent.command]
                return (
                  <CustomAgentRow
                    key={agent.id}
                    agent={agent}
                    detected={detected}
                    onChange={(field, value) => updateCustomAgent(i, field, value)}
                    onDelete={() => removeCustomAgent(i)}
                    onProbe={() => { void probeCustomAgent(agent.command) }}
                    probing={ps?.probing ?? false}
                    probeOk={ps?.ok ?? (detected ? true : null)}
                    probeOutput={ps?.output}
                  />
                )
              })}
            </div>
          )}

          {/* Add new custom agent form */}
          <div className="settings-divider" />
          <div className="field__row" style={{ marginTop: 8 }}>
            <input
              className="input"
              placeholder="输入命令名，如：aider, gemini…"
              value={newCmd}
              onChange={(e) => setNewCmd(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleAddCustom() }}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn--primary"
              style={{ flexShrink: 0 }}
              onClick={() => void handleAddCustom()}
              disabled={adding || !newCmd.trim()}
            >
              {adding ? '检测中…' : '＋ 添加'}
            </button>
          </div>
          {addError && <div className="field__hint field__hint--error">{addError}</div>}
        </div>
      </Section>

      {/* ─── 操作按钮 ─── */}
      <div className="repo-nav-settings__footer">
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          {isSaving ? '正在保存…' : '保存'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={handleReset}
          disabled={isSaving}
        >
          清空
        </button>
        {status.kind === 'saving' && <div className="field__hint">正在保存…</div>}
        {status.kind === 'saved' && <div className="field__hint field__hint--success">✓ 配置已保存</div>}
        {status.kind === 'error' && <div className="field__hint field__hint--error">{status.msg}</div>}
      </div>
    </div>
  )
}
