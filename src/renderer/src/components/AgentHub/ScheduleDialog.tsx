import { useEffect, useState } from 'react'
import type { AgentDescriptor, ScheduledTask } from '@shared/agentHub'
import { scheduleSessionId, isScheduleDue, isValidScheduleTime } from '@shared/agentHub'
import AgentPicker from './AgentPicker'
import WorkDirPicker from './WorkDirPicker'

interface RepoEntry {
  name: string
  path: string
}

interface ScheduleDialogProps {
  agents: AgentDescriptor[]
  repos: RepoEntry[]
  recents: string[]
  onClose: () => void
  /** Run once immediately (background, scheduled session id so results land in the same log). */
  onRunNow: (task: ScheduledTask) => void
}

function newTask(): ScheduledTask {
  return {
    id: `st-${Date.now().toString(36)}`,
    name: '',
    agentId: '',
    workDir: '',
    prompt: '',
    // v1.28.2: interactive-paste is the default — it works with ANY TUI
    // agent exactly like Agent 对话 sessions do.
    mode: 'pty',
    hour: 9,
    minute: 0,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function formatLastRun(task: ScheduledTask): string {
  if (!task.lastRunAt) return '从未运行'
  const status = task.lastStatus ?? '—'
  const statusText =
    status === 'ok' ? '✅ 成功' : status === 'error' ? '❌ 失败' : status === 'running' ? '⏳ 运行中' : status === 'cancelled' ? '⏹ 已取消' : '—'
  const diff = Date.now() - new Date(task.lastRunAt).getTime()
  const hours = Math.floor(diff / 3600000)
  const rel = hours < 1 ? `${Math.max(1, Math.floor(diff / 60000))} 分钟前` : hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`
  return `${statusText} · ${rel}`
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Scheduled-task manager (v1.28): create/edit/enable/delete daily agent
 * tasks (e.g. nightly knowledge-base refresh). Runs go through the same
 * task runner (background + notifications), with results logged under a
 * per-task synthetic session.
 */
export default function ScheduleDialog({ agents, repos, recents, onClose, onRunNow }: ScheduleDialogProps): JSX.Element {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [editing, setEditing] = useState<ScheduledTask | null>(null)
  const [saving, setSaving] = useState(false)
  const [lastResult, setLastResult] = useState<{ id: string; text: string | null } | null>(null)

  useEffect(() => {
    void window.agentHub
      .scheduleList()
      .then((d) => setTasks(d.tasks))
      .catch((err) => console.error('Failed to load schedules', err))
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !editing) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editing])

  const persist = async (task: ScheduledTask): Promise<void> => {
    setSaving(true)
    try {
      await window.agentHub.scheduleSave(task)
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id)
        if (idx >= 0) {
          const next = [...prev]
          next[idx] = task
          return next
        }
        return [...prev, task]
      })
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (task: ScheduledTask): Promise<void> => {
    if (!window.confirm(`确定删除定时任务「${task.name}」吗？`)) return
    await window.agentHub.scheduleDelete(task.id)
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
  }

  const toggleEnabled = async (task: ScheduledTask): Promise<void> => {
    const next = { ...task, enabled: !task.enabled, updatedAt: new Date().toISOString() }
    await window.agentHub.scheduleSave(next)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? next : t)))
  }

  const showLastResult = async (task: ScheduledTask): Promise<void> => {
    try {
      const [events, runs] = await Promise.all([
        window.agentHub.getSessionEvents(scheduleSessionId(task.id)),
        window.agentHub.listTasks()
      ])
      const running = runs.find(
        (r) => r.sessionId === scheduleSessionId(task.id) && r.status === 'running'
      )
      const last = [...events].reverse().find((e) => e.type === 'run_finished' || e.type === 'run_error')

      // Still running: say so with elapsed time instead of "no records" —
      // pty runs only write run_finished when the turn completes.
      if (!last && running) {
        const minutes = Math.max(1, Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000))
        setLastResult({
          id: task.id,
          text: `⏳ 任务正在运行中（已约 ${minutes} 分钟）。\n交互粘贴模式会在 agent 停止输出后自动结束并通知；完成后再次点击「结果」即可查看输出。`
        })
        return
      }
      const text = last
        ? last.type === 'run_finished'
          ? `${new Date(last.at).toLocaleString('zh-CN', { hour12: false })}\n\n${last.result ?? last.text ?? '（无输出）'}`
          : `${new Date(last.at).toLocaleString('zh-CN', { hour12: false })}\n\n❌ ${last.error ?? '未知错误'}`
        : null
      setLastResult({ id: task.id, text })
    } catch {
      setLastResult({ id: task.id, text: null })
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="modal schedule-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <div className="modal__title">⏰ 定时任务</div>
          <button className="modal__close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal__body">
          {editing === null ? (
            <>
              <div className="schedule-dialog__hint">
                每天 in 应用运行期间定时执行 agent 任务（如知识库更新、健康度检查、自动修复）。
                若当天错过（应用未开），启动后会自动补跑当天的一次。
              </div>
              <button
                className="btn btn--primary schedule-dialog__add"
                onClick={() => setEditing({ ...newTask(), agentId: agents[0]?.id ?? '' })}
              >
                ＋ 新建定时任务
              </button>
              {tasks.length === 0 ? (
                <div className="schedule-dialog__empty">暂无定时任务。</div>
              ) : (
                <div className="schedule-dialog__list">
                  {tasks.map((task) => {
                    const agent = agents.find((a) => a.id === task.agentId)
                    const dueNow = isScheduleDue(task, new Date())
                    return (
                      <div key={task.id} className="schedule-dialog__item">
                        <div className="schedule-dialog__item-main">
                          <div className="schedule-dialog__item-title">
                            <span className={`schedule-dialog__time ${task.enabled ? '' : 'schedule-dialog__time--off'}`}>
                              {pad2(task.hour)}:{pad2(task.minute)}
                            </span>
                            <span className="schedule-dialog__name" title={task.name}>{task.name}</span>
                            {!task.enabled && <span className="schedule-dialog__badge">已停用</span>}
                            {task.enabled && dueNow && task.lastStatus !== 'ok' && (
                              <span className="schedule-dialog__badge schedule-dialog__badge--due">待执行</span>
                            )}
                          </div>
                          <div className="schedule-dialog__item-meta">
                            {agent?.icon} {agent?.name ?? task.agentId} · 📁 {task.workDir.replace(/\\/g, '/').split('/').pop()}
                            <span style={{ margin: '0 6px', color: 'var(--text-faint)' }}>|</span>
                            {formatLastRun(task)}
                          </div>
                        </div>
                        <div className="schedule-dialog__item-actions">
                          <label className="schedule-dialog__switch" title={task.enabled ? '停用' : '启用'}>
                            <input type="checkbox" checked={task.enabled} onChange={() => void toggleEnabled(task)} />
                            <span>{task.enabled ? '启用中' : '已停用'}</span>
                          </label>
                          <button className="btn btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => onRunNow(task)} title="立即运行一次">
                            ▶ 运行
                          </button>
                          <button className="btn btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void showLastResult(task)} title="查看最近一次输出">
                            📄 结果
                          </button>
                          <button className="btn btn--ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setEditing({ ...task })}>
                            ✏️ 编辑
                          </button>
                          <button className="btn btn--ghost schedule-dialog__del" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => void handleDelete(task)}>
                            🗑
                          </button>
                        </div>
                        {lastResult?.id === task.id && (
                          <pre className="schedule-dialog__result">{lastResult.text ?? '暂无运行记录'}</pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="schedule-dialog__form">
              <div className="field">
                <label className="field__label">任务名称</label>
                <input
                  className="input"
                  placeholder="如：llm-wiki 知识库每日更新"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="field__label">Agent</label>
                <AgentPicker agents={agents} value={editing.agentId} onChange={(id) => setEditing({ ...editing, agentId: id })} />
              </div>
              <div className="field">
                <label className="field__label">工作目录</label>
                <WorkDirPicker
                  value={editing.workDir}
                  onChange={(p) => setEditing({ ...editing, workDir: p })}
                  repos={repos}
                  recents={recents}
                />
              </div>
              <div className="field">
                <label className="field__label">执行时间（每天，本地时间）</label>
                <input
                  className="input"
                  type="time"
                  value={`${pad2(editing.hour)}:${pad2(editing.minute)}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number)
                    setEditing({ ...editing, hour: h ?? 9, minute: m ?? 0 })
                  }}
                  style={{ width: 130 }}
                />
              </div>
              <div className="field">
                <label className="field__label">运行方式</label>
                <div className="radio-group">
                  <label className="radio-group__item">
                    <input
                      type="radio"
                      name="schedMode"
                      checked={(editing.mode ?? 'pty') === 'pty'}
                      onChange={() => setEditing({ ...editing, mode: 'pty' })}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                    <span className="field__row-text">交互粘贴（推荐）— 与 Agent 对话完全一致：真实终端启动后自动粘贴提示词，兼容所有 TUI agent</span>
                  </label>
                  <label className="radio-group__item">
                    <input
                      type="radio"
                      name="schedMode"
                      checked={editing.mode === 'headless'}
                      onChange={() => setEditing({ ...editing, mode: 'headless' })}
                      style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                    />
                    <span className="field__row-text">参数无头 — 无终端运行（claude -p 流可获得结构化时间线，需 CLI 支持对应约定）</span>
                  </label>
                </div>
              </div>
              {(editing.mode ?? 'pty') === 'headless' && (
                <div className="field">
                  <label className="field__label">启动参数（可选，仅无头运行生效）</label>
                  <input
                    className="input"
                    value={editing.args ?? ''}
                    onChange={(e) => setEditing({ ...editing, args: e.target.value })}
                    placeholder="如：-p"
                    spellCheck={false}
                  />
                  <div className="field__hint">
                    无头运行与交互终端的启动参数相互独立。Claude 系封装通常需要
                    <code className="inline-code">-p</code>，否则无法识别提示词导致退出码 1。
                    若不确定，请改用「交互粘贴」模式。
                  </div>
                </div>
              )}
              <div className="field">
                <label className="field__label">任务提示词（每次运行发送给 agent）</label>
                <textarea
                  className="input schedule-dialog__prompt"
                  rows={7}
                  value={editing.prompt}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                  placeholder={'例如：\n1. 更新 llm-wiki 个人知识库（扫描最近变更）\n2. 执行健康度检查并输出报告\n3. 发现可自动修复的问题时直接修复并提交'}
                />
                <div className="field__hint">
                  建议提示词中要求 agent 完成后自行提交改动（任务分支），便于追溯。
                </div>
              </div>
              <label className="task-run-dialog__bg">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <span>启用（应用运行期间到点自动执行）</span>
              </label>
              <div className="modal__footer" style={{ padding: '12px 0 0' }}>
                <button className="btn btn--ghost" onClick={() => setEditing(null)} disabled={saving}>取消</button>
                <button
                  className="btn btn--primary"
                  disabled={saving || !editing.name.trim() || !editing.workDir || !editing.prompt.trim() || !editing.agentId || !isValidScheduleTime(editing.hour, editing.minute)}
                  onClick={() => void persist({ ...editing, updatedAt: new Date().toISOString() })}
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
