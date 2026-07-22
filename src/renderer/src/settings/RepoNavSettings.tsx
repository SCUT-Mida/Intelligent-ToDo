import { useState, useEffect, useCallback } from 'react'
import type { RepoNavConfig, CommandTemplate, RepoCommand, ToolKind, ToolProbeResult } from '@shared/repoNav'
import { DEFAULT_TEMPLATES, DEFAULT_COMMANDS, COMMON_COMMANDS } from '@shared/repoNav'
import Section from '../components/Section'

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const DEFAULT_CONFIG: RepoNavConfig = {
  scanRoots: ['D:\\Coding'],
  scanDepth: 3,
  excludePatterns: ['node_modules', '.git', 'dist', 'out', 'build', '__pycache__', '.venv', 'vendor'],
  commandTemplates: [...DEFAULT_TEMPLATES],
  commands: [...DEFAULT_COMMANDS],
  defaultTemplate: 'default',
  openIn: 'new-tab',
  fallbackToPowerShellExe: true,
  autoGenerateMemory: false,
  memoryBatchSize: 5,
}

/** Deep-clone a RepoNavConfig (JSON round-trip). */
function cloneConfig(cfg: RepoNavConfig): RepoNavConfig {
  return JSON.parse(JSON.stringify(cfg)) as RepoNavConfig
}

/* ── Status type ──────────────────────────────────────────────────────────── */

type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'error'; msg: string }

/* ── Tool Path types ─────────────────────────────────────────────────────── */

type ToolState = {
  probing: boolean
  probeResult: ToolProbeResult | null
}

type ToolCfgKey = 'gitBinary' | 'terminalBinary' | 'terminalFallback'

interface ToolKindItem {
  kind: ToolKind
  label: string
  placeholder: string
  cfgKey: ToolCfgKey
}

const TOOL_KINDS: ToolKindItem[] = [
  { kind: 'git', label: 'Git 可执行文件', placeholder: '留空使用 PATH 中的 git', cfgKey: 'gitBinary' },
  { kind: 'terminal', label: '主终端可执行文件', placeholder: '留空使用 wt.exe', cfgKey: 'terminalBinary' },
  { kind: 'terminalFallback', label: '终端回退可执行文件', placeholder: '留空使用 powershell.exe', cfgKey: 'terminalFallback' },
]

/* ── ToolPathRow (inline helper) ─────────────────────────────────────────── */

interface ToolPathRowProps {
  kind: ToolKind
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  toolState: ToolState
  onBrowse: () => void
  onProbe: () => void
}

function ToolPathRow({ label, placeholder, value, onChange, toolState, onBrowse, onProbe }: ToolPathRowProps): JSX.Element {
  const disabled = toolState.probing
  return (
    <div className="tool-block">
      <span className="tool-block__label">{label}</span>
      <div className="tool-row">
        <input
          className="input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className="btn btn--ghost tool-row__btn" disabled={disabled} onClick={onBrowse}>
          浏览…
        </button>
        <button type="button" className="btn btn--ghost tool-row__btn" disabled={disabled} onClick={onProbe}>
          {toolState.probing ? '检测中…' : '检测'}
        </button>
      </div>
      {toolState.probing && <div className="field__hint">正在检测…</div>}
      {!toolState.probing && toolState.probeResult?.ok && (
        <div className="field__hint field__hint--success">
          ✓ {toolState.probeResult.output?.slice(0, 80) ?? ''}
          {toolState.probeResult.resolvedPath && (
            <><br />{toolState.probeResult.resolvedPath}</>
          )}
        </div>
      )}
      {!toolState.probing && toolState.probeResult && !toolState.probeResult.ok && (
        <div className="field__hint field__hint--error">
          ✗ {toolState.probeResult.output?.slice(0, 120) ?? '未知错误'}
        </div>
      )}
    </div>
  )
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function RepoNavSettings(): JSX.Element {
  const [cfg, setCfg] = useState<RepoNavConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' })
  const [configPath, setConfigPath] = useState<string | null>(null)

  /* ── Scan roots input state ───────────────────────────────────────────── */
  const [rootInput, setRootInput] = useState('')
  const [rootError, setRootError] = useState('')

  /* ── Exclude patterns input state ─────────────────────────────────────── */
  const [excludeInput, setExcludeInput] = useState('')
  const [excludeError, setExcludeError] = useState('')

  /* ── Tool path state ──────────────────────────────────────────────────── */
  const [toolStates, setToolStates] = useState<Record<ToolKind, ToolState>>({
    git: { probing: false, probeResult: null },
    terminal: { probing: false, probeResult: null },
    terminalFallback: { probing: false, probeResult: null },
  })

  /* ── Load config on mount ─────────────────────────────────────────────── */
  useEffect(() => {
    void (async () => {
      try {
        const [loaded, path] = await Promise.all([
          window.repoNav.getConfig(),
          window.repoNav.getConfigPath(),
        ])
        // Defensively merge optional fields
        setCfg({
          ...loaded,
          scanRoots: loaded.scanRoots ?? [],
          scanDepth: loaded.scanDepth ?? 3,
          excludePatterns: loaded.excludePatterns ?? [],
          commandTemplates: loaded.commandTemplates?.length ? loaded.commandTemplates : [...DEFAULT_TEMPLATES],
          commands: loaded.commands?.length ? loaded.commands : [...DEFAULT_COMMANDS],
          defaultTemplate: loaded.defaultTemplate ?? 'default',
          openIn: loaded.openIn ?? 'new-tab',
          fallbackToPowerShellExe: loaded.fallbackToPowerShellExe ?? true,
          autoGenerateMemory: loaded.autoGenerateMemory ?? false,
          memoryBatchSize: loaded.memoryBatchSize ?? 5,
        })
        setConfigPath(path)
      } catch (e) {
        setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
        setCfg({ ...DEFAULT_CONFIG })
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

  /* ── Scan Roots ───────────────────────────────────────────────────────── */
  const addScanRoot = useCallback(() => {
    const value = rootInput.trim().replace(/[\\/]+$/, '')
    if (!value) return
    if (cfg?.scanRoots.some((r) => r.toLowerCase() === value.toLowerCase())) {
      setRootError('该目录已存在')
      window.setTimeout(() => setRootError(''), 2500)
      return
    }
    setCfg((prev) => prev ? { ...prev, scanRoots: [...prev.scanRoots, value] } : prev)
    setRootInput('')
    setRootError('')
  }, [rootInput, cfg])

  const removeScanRoot = useCallback((index: number) => {
    setCfg((prev) => prev ? { ...prev, scanRoots: prev.scanRoots.filter((_, i) => i !== index) } : prev)
  }, [])

  const pickDirectory = useCallback(async () => {
    const dir = await window.repoNav.pickDirectory()
    if (dir) {
      const normalized = dir.trim().replace(/[\\/]+$/, '')
      setCfg((prev) => {
        if (!prev) return prev
        if (prev.scanRoots.some((r) => r.toLowerCase() === normalized.toLowerCase())) {
          setRootError('该目录已存在')
          window.setTimeout(() => setRootError(''), 2500)
          return prev
        }
        return { ...prev, scanRoots: [...prev.scanRoots, normalized] }
      })
    }
  }, [])

  /* ── Exclude Patterns ─────────────────────────────────────────────────── */
  const addExcludePattern = useCallback(() => {
    const value = excludeInput.trim()
    if (!value) return
    if (cfg?.excludePatterns.some((p) => p.toLowerCase() === value.toLowerCase())) {
      setExcludeError('该模式已存在')
      window.setTimeout(() => setExcludeError(''), 2500)
      return
    }
    setCfg((prev) => prev ? { ...prev, excludePatterns: [...prev.excludePatterns, value] } : prev)
    setExcludeInput('')
    setExcludeError('')
  }, [excludeInput, cfg])

  const removeExcludePattern = useCallback((index: number) => {
    setCfg((prev) => prev ? { ...prev, excludePatterns: prev.excludePatterns.filter((_, i) => i !== index) } : prev)
  }, [])

  /* ── Tool Path helpers ─────────────────────────────────────────────────── */
  const setToolState = useCallback((kind: ToolKind, patch: Partial<ToolState>) => {
    setToolStates((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }))
  }, [])

  const browseTool = useCallback(async () => {
    const picked = await window.repoNav.pickExecutable()
    if (picked) {
      // Don't normalize — keep the user-selected path as-is (case-sensitive apps may care)
      return picked
    }
    return null
  }, [])

  const browseAndFillTool = useCallback(async (kind: ToolKind) => {
    const picked = await browseTool()
    if (picked === null) return
    const cfgKey: ToolCfgKey = kind === 'git' ? 'gitBinary' : kind === 'terminal' ? 'terminalBinary' : 'terminalFallback'
    setCfg((prev) => prev ? { ...prev, [cfgKey]: picked } : prev)
    // Clear any stale probe result since the value changed
    setToolState(kind, { probeResult: null })
  }, [browseTool, setToolState])

  const probeTool = useCallback(async (kind: ToolKind) => {
    setToolState(kind, { probing: true, probeResult: null })
    try {
      const result = await window.repoNav.probeTool(kind)
      // Auto-fill the resolved absolute path back into the config so the user
      // sees what was detected and the path becomes "sticky" (survives PATH changes).
      if (result.ok && result.resolvedPath) {
        const cfgKey: ToolCfgKey = kind === 'git' ? 'gitBinary' : kind === 'terminal' ? 'terminalBinary' : 'terminalFallback'
        setCfg((prev) => prev ? { ...prev, [cfgKey]: result.resolvedPath } : prev)
      }
      setToolState(kind, { probing: false, probeResult: result })
    } catch (e) {
      setToolState(kind, { probing: false, probeResult: { ok: false, output: e instanceof Error ? e.message : String(e) } })
    }
  }, [setToolState])

  /* ── Commands (individual reusable commands) ─────────────────────────── */
  const addCommand = useCallback(() => {
    const id = `cmd-${Date.now()}`
    const newCmd: RepoCommand = { id, name: '', command: '' }
    setCfg((prev) => prev ? { ...prev, commands: [...prev.commands, newCmd] } : prev)
  }, [])

  const removeCommand = useCallback((cmdId: string) => {
    setCfg((prev) => {
      if (!prev) return prev
      // Also remove references to this command from all templates
      return {
        ...prev,
        commands: prev.commands.filter((c) => c.id !== cmdId),
        commandTemplates: prev.commandTemplates.map((t) => ({
          ...t,
          commandIds: t.commandIds.filter((id) => id !== cmdId)
        }))
      }
    })
  }, [])

  const updateCommand = useCallback((cmdId: string, field: 'name' | 'command', value: string) => {
    setCfg((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        commands: prev.commands.map((c) => c.id === cmdId ? { ...c, [field]: value } : c)
      }
    })
  }, [])

  /* ── Command Templates ────────────────────────────────────────────────── */
  const addTemplate = useCallback(() => {
    const id = `tpl-${Date.now()}`
    const newTpl: CommandTemplate = { id, name: '', description: '', commandIds: [] }
    setCfg((prev) => prev ? { ...prev, commandTemplates: [...prev.commandTemplates, newTpl] } : prev)
  }, [])

  const removeTemplate = useCallback((index: number) => {
    setCfg((prev) => {
      if (!prev) return prev
      if (prev.commandTemplates.length <= 1) {
        setStatus({ kind: 'error', msg: '至少保留一个模板' })
        return prev
      }
      return {
        ...prev,
        commandTemplates: prev.commandTemplates.filter((_, i) => i !== index),
      }
    })
  }, [])

  const updateTemplateField = useCallback((index: number, field: 'name' | 'description', value: string) => {
    setCfg((prev) => {
      if (!prev) return prev
      const templates = [...prev.commandTemplates]
      templates[index] = { ...templates[index], [field]: value }
      return { ...prev, commandTemplates: templates }
    })
  }, [])

  // Add a command reference to a template's commandIds
  const addCommandToTemplate = useCallback((tplIndex: number, cmdId: string) => {
    if (!cmdId) return
    setCfg((prev) => {
      if (!prev) return prev
      const templates = [...prev.commandTemplates]
      templates[tplIndex] = {
        ...templates[tplIndex],
        commandIds: [...templates[tplIndex].commandIds, cmdId]
      }
      return { ...prev, commandTemplates: templates }
    })
  }, [])

  const removeCommandFromTemplate = useCallback((tplIndex: number, stepIndex: number) => {
    setCfg((prev) => {
      if (!prev) return prev
      const templates = [...prev.commandTemplates]
      templates[tplIndex] = {
        ...templates[tplIndex],
        commandIds: templates[tplIndex].commandIds.filter((_, i) => i !== stepIndex)
      }
      return { ...prev, commandTemplates: templates }
    })
  }, [])

  const moveCommandInTemplate = useCallback((tplIndex: number, stepIndex: number, dir: 'up' | 'down') => {
    setCfg((prev) => {
      if (!prev) return prev
      const templates = [...prev.commandTemplates]
      const ids = [...templates[tplIndex].commandIds]
      const target = dir === 'up' ? stepIndex - 1 : stepIndex + 1
      if (target < 0 || target >= ids.length) return prev
      ;[ids[stepIndex], ids[target]] = [ids[target], ids[stepIndex]]
      templates[tplIndex] = { ...templates[tplIndex], commandIds: ids }
      return { ...prev, commandTemplates: templates }
    })
  }, [])

  /* ── Validation ───────────────────────────────────────────────────────── */
  const validate = useCallback((c: RepoNavConfig): string | null => {
    if (c.scanRoots.length === 0) return '至少需要一个扫描根目录'
    if (c.scanDepth < 1 || c.scanDepth > 10) return '扫描深度必须在 1-10 之间'
    if (c.commandTemplates.length === 0) return '至少需要一个命令模板'
    const tplIds = c.commandTemplates.map((t) => t.id)
    if (new Set(tplIds).size !== tplIds.length) return '模板 ID 不能重复（内部错误）'
    if (c.commandTemplates.some((t) => !t.name.trim())) return '每个模板需要名称'
    if (c.commandTemplates.some((t) => t.commandIds.length === 0)) return '每个模板至少选择一个命令'
    if (!c.defaultTemplate || !tplIds.includes(c.defaultTemplate)) {
      return '默认模板必须对应一个已存在的模板'
    }
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
      const payload: RepoNavConfig = {
        ...cfg,
        autoGenerateMemory: cfg.autoGenerateMemory ?? false,
        memoryBatchSize: cfg.memoryBatchSize ?? 5,
      }
      await window.repoNav.saveConfig(payload)
      setStatus({ kind: 'saved' })
    } catch (e) {
      setStatus({ kind: 'error', msg: e instanceof Error ? e.message : String(e) })
    }
  }, [cfg, validate])

  /* ── Reset to defaults ────────────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    if (!window.confirm('确定恢复默认配置？当前自定义设置将被覆盖。')) return
    setCfg(cloneConfig(DEFAULT_CONFIG))
    setStatus({ kind: 'idle' })
  }, [])

  /* ── Loading state ────────────────────────────────────────────────────── */
  if (loading || cfg === null) {
    return (
      <div className="repo-nav-settings">
        <div className="repo-nav-settings__loading">
          <div className="spinner" />
          <span>正在加载配置…</span>
        </div>
      </div>
    )
  }

  /* ── Render ────────────────────────────────────────────────────────────── */
  const isSaving = status.kind === 'saving'
  const saveDisabled = loading || isSaving

  return (
    <div className="repo-nav-settings">

      {/* ─── 扫描配置 ─── */}
      <Section title="扫描配置" icon="🔍" label="扫描">
        {/* 扫描根目录 */}
        <div className="field">
          <label className="field__label">扫描根目录</label>
          <div className="scan-root-list">
            {cfg.scanRoots.length === 0 ? (
              <div className="scan-root-list__empty">暂无扫描根目录，请添加至少一个</div>
            ) : (
              cfg.scanRoots.map((root, i) => (
                <div key={`${root}-${i}`} className="scan-root-list__item">
                  <span className="scan-root-list__path" title={root}>{root}</span>
                  <button type="button" className="scan-root-list__remove" onClick={() => removeScanRoot(i)}>×</button>
                </div>
              ))
            )}
          </div>
          <div className="field__row" style={{ marginTop: 8 }}>
            <input
              className="input"
              placeholder="输入路径，如 D:\Projects"
              value={rootInput}
              onChange={(e) => setRootInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addScanRoot() }}
            />
            <button type="button" className="btn btn--ghost" style={{ flexShrink: 0 }} onClick={pickDirectory}>
              浏览…
            </button>
            <button type="button" className="btn btn--primary" style={{ flexShrink: 0 }} onClick={addScanRoot}>
              添加
            </button>
          </div>
          {rootError && <div className="field__hint field__hint--error">{rootError}</div>}
        </div>

        <div className="settings-divider" />

        {/* 扫描深度 */}
        <div className="field">
          <label className="field__label">扫描深度</label>
          <input
            className="input"
            type="number"
            min={1}
            max={10}
            step={1}
            value={cfg.scanDepth}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10)
              setCfg((prev) => prev ? { ...prev, scanDepth: Number.isNaN(v) ? 1 : v } : prev)
            }}
            style={{ maxWidth: 100 }}
          />
          <div className="field__hint">扫描子目录的递归深度，1 表示仅扫描根目录的直接子文件夹</div>
          {(cfg.scanDepth < 1 || cfg.scanDepth > 10) && (
            <div className="field__hint field__hint--error">深度必须在 1-10 之间</div>
          )}
        </div>

        <div className="settings-divider" />

        {/* 排除模式 */}
        <div className="field">
          <label className="field__label">排除模式</label>
          <div className="chip-list">
            {cfg.excludePatterns.length === 0 ? (
              <div className="scan-root-list__empty">暂无排除模式</div>
            ) : (
              cfg.excludePatterns.map((pattern, i) => (
                <span key={`${pattern}-${i}`} className="chip">
                  {pattern}
                  <span className="chip__remove" onClick={() => removeExcludePattern(i)} role="button" tabIndex={0}>×</span>
                </span>
              ))
            )}
          </div>
          <div className="chip-list__add-row" style={{ marginTop: 8 }}>
            <input
              className="input"
              placeholder="如 node_modules, .git"
              value={excludeInput}
              onChange={(e) => setExcludeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addExcludePattern() }}
              style={{ flex: 1 }}
            />
            <button type="button" className="btn btn--primary" style={{ flexShrink: 0 }} onClick={addExcludePattern}>
              添加
            </button>
          </div>
          {excludeError && <div className="field__hint field__hint--error">{excludeError}</div>}
          <div className="field__hint">匹配的目录将被跳过，不进入扫描</div>
        </div>
      </Section>

      {/* ─── 命令配置 ─── */}
      <Section title="命令配置" icon="⚙" label="命令" defaultOpen={false}>
        <div className="field">
          <label className="field__label">命令配置（可复用）</label>
          <div className="field__hint" style={{ marginBottom: 8 }}>
            定义独立命令，然后在下方模板中组合使用。
          </div>
          {cfg.commands.map((cmd) => (
            <div key={cmd.id} className="cmd-row">
              <input
                className="input cmd-row__name"
                value={cmd.name}
                onChange={(e) => updateCommand(cmd.id, 'name', e.target.value)}
                placeholder="名称（如：Git 拉取）"
              />
              <input
                className="input cmd-row__cmd"
                value={cmd.command}
                onChange={(e) => updateCommand(cmd.id, 'command', e.target.value)}
                placeholder="命令（如：git pull）"
                list="common-commands"
              />
              <button type="button" className="tpl-step__btn tpl-step__btn--del" onClick={() => removeCommand(cmd.id)} title="删除命令">×</button>
            </div>
          ))}
          <datalist id="common-commands">
            {COMMON_COMMANDS.map((c) => (
              <option key={c.command} value={c.command}>{c.label}</option>
            ))}
          </datalist>
          <button type="button" className="btn btn--ghost" style={{ marginTop: 6, fontSize: 12 }} onClick={addCommand}>
            + 添加命令
          </button>
        </div>

        <div className="settings-divider" />
      </Section>

      {/* ─── 命令模板 ─── */}
      <Section title="命令模板" icon="⌨️" label="模板" defaultOpen={false}>
        {/* 命令模板 — 组合选择 */}
        <div className="field">
          <label className="field__label">命令模板（组合）</label>
          <div className="field__hint" style={{ marginBottom: 8 }}>
            每个模板由多个命令按顺序组合，点击仓库「打开」时依次执行。
          </div>
          {cfg.commandTemplates.map((tpl, i) => (
            <div key={tpl.id || `tpl-${i}`} className="tpl-card">
              <div className="tpl-card__head">
                <input
                  className="input tpl-card__name"
                  value={tpl.name}
                  onChange={(e) => updateTemplateField(i, 'name', e.target.value)}
                  placeholder="名称（如：默认）"
                />
                <input
                  className="input tpl-card__desc"
                  value={tpl.description}
                  onChange={(e) => updateTemplateField(i, 'description', e.target.value)}
                  placeholder="描述（可选）"
                />
                <button type="button" className="btn btn--ghost tpl-card__del" onClick={() => removeTemplate(i)} title="删除模板">删除</button>
              </div>

              <div className="tpl-steps">
                <div className="tpl-steps__label">执行步骤:</div>
                {tpl.commandIds.length === 0 && (
                  <div className="tpl-steps__empty">暂无步骤，从下方下拉添加</div>
                )}
                {tpl.commandIds.map((cmdId, si) => {
                  const cmd = cfg.commands.find((c) => c.id === cmdId)
                  return (
                    <div key={si} className="tpl-step">
                      <span className="tpl-step__num">{si + 1}</span>
                      <span className="tpl-step__name">{cmd?.name ?? '(已删除)'}</span>
                      <span className="tpl-step__raw">{cmd?.command ?? ''}</span>
                      <button type="button" className="tpl-step__btn" onClick={() => moveCommandInTemplate(i, si, 'up')} disabled={si === 0} title="上移">↑</button>
                      <button type="button" className="tpl-step__btn" onClick={() => moveCommandInTemplate(i, si, 'down')} disabled={si === tpl.commandIds.length - 1} title="下移">↓</button>
                      <button type="button" className="tpl-step__btn tpl-step__btn--del" onClick={() => removeCommandFromTemplate(i, si)} title="移除">×</button>
                    </div>
                  )
                })}
                {/* Add command via dropdown */}
                <div className="tpl-add-cmd">
                  <select
                    className="select tpl-add-cmd__select"
                    value=""
                    onChange={(e) => { if (e.target.value) addCommandToTemplate(i, e.target.value); e.target.value = '' }}
                  >
                    <option value="">+ 选择命令添加…</option>
                    {cfg.commands.map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.command})</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          <button type="button" className="btn btn--ghost" style={{ marginTop: 8, fontSize: 12 }} onClick={addTemplate}>
            + 添加模板
          </button>
        </div>

        <div className="settings-divider" />

        {/* 默认模板 */}
        <div className="field">
          <label className="field__label">默认模板</label>
          <select
            className="select"
            value={cfg.defaultTemplate}
            onChange={(e) => setCfg((prev) => prev ? { ...prev, defaultTemplate: e.target.value } : prev)}
          >
            {!cfg.commandTemplates.some((t) => t.id === cfg.defaultTemplate) && (
              <option value={cfg.defaultTemplate}>(无)</option>
            )}
            {cfg.commandTemplates.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name || '(未命名)'}
              </option>
            ))}
          </select>
          <div className="field__hint">在仓库卡片中默认选中的命令模板</div>
        </div>
      </Section>

      {/* ─── 启动行为 ─── */}
      <Section title="启动行为" icon="🚀" label="启动" defaultOpen={false}>
        {/* 打开方式 */}
        <div className="field">
          <label className="field__label">打开方式</label>
          <div className="radio-group">
            <label className="radio-group__item">
              <input
                type="radio"
                name="openIn"
                value="new-tab"
                checked={cfg.openIn === 'new-tab'}
                onChange={() => setCfg((prev) => prev ? { ...prev, openIn: 'new-tab' } : prev)}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
              />
              <span className="field__row-text">新标签页 (new-tab)</span>
            </label>
            <label className="radio-group__item">
              <input
                type="radio"
                name="openIn"
                value="new-window"
                checked={cfg.openIn === 'new-window'}
                onChange={() => setCfg((prev) => prev ? { ...prev, openIn: 'new-window' } : prev)}
                style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
              />
              <span className="field__row-text">新窗口 (new-window)</span>
            </label>
          </div>
        </div>

        <div className="settings-divider" />

        {/* PowerShell 回退 */}
        <div className="field">
          <label className="field__row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cfg.fallbackToPowerShellExe}
              onChange={(e) => setCfg((prev) => prev ? { ...prev, fallbackToPowerShellExe: e.target.checked } : prev)}
              style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
            />
            <span className="field__row-text">
              wt.exe 不可用时回退到 powershell.exe
              <br />
              <span className="field__hint" style={{ marginTop: 2 }}>
                勾选后，如果 Windows Terminal (wt.exe) 未安装，将使用 powershell.exe 执行命令
              </span>
            </span>
          </label>
        </div>
      </Section>

      {/* ─── 工具路径 ─── */}
      <Section title="工具路径" icon="🛠️" label="高级" defaultOpen={false}>
        <div className="field">
          <label className="field__label">工具路径（可选）</label>
          <div className="field__hint" style={{ marginBottom: 12 }}>
            留空则使用 PATH 中的默认值。可填绝对路径或可执行文件名。
          </div>
          {TOOL_KINDS.map((item) => {
            const cfgKey = item.cfgKey
            const fieldValue = cfg[cfgKey] ?? ''
            return (
              <ToolPathRow
                key={item.kind}
                kind={item.kind}
                label={item.label}
                placeholder={item.placeholder}
                value={fieldValue}
                onChange={(v) => setCfg((prev) => prev ? { ...prev, [cfgKey]: v } : prev)}
                toolState={toolStates[item.kind]}
                onBrowse={() => { void browseAndFillTool(item.kind) }}
                onProbe={() => { void probeTool(item.kind) }}
              />
            )
          })}
        </div>
      </Section>

      {/* ─── AI 记忆 ─── */}
      <Section title="AI 记忆" icon="🧠" label="高级" defaultOpen={false}>
        <div className="field">
          <label className="field__row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={cfg.autoGenerateMemory ?? false}
              onChange={(e) => setCfg((prev) => prev ? { ...prev, autoGenerateMemory: e.target.checked } : prev)}
              style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
            />
            <span className="field__row-text">
              扫描后自动生成 AI 记忆描述
              <br />
              <span className="field__hint" style={{ marginTop: 2 }}>
                启用后，每次扫描仓库时会自动调用 AI 为每个仓库生成描述和标签
              </span>
            </span>
          </label>
        </div>
        {cfg.autoGenerateMemory && (
          <div className="field">
            <label className="field__label">批量大小 (batch size)</label>
            <input
              className="input"
              type="number"
              min={1}
              max={20}
              step={1}
              value={cfg.memoryBatchSize ?? 5}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10)
                setCfg((prev) => prev ? { ...prev, memoryBatchSize: Number.isNaN(v) ? 1 : v } : prev)
              }}
              style={{ maxWidth: 100 }}
            />
            <div className="field__hint">每次 LLM 请求处理的仓库数量，数值越大越快但可能触发限流</div>
          </div>
        )}
      </Section>

      {/* ─── 配置文件 ─── */}
      <Section title="配置文件" icon="📂" label="元信息" defaultOpen={false}>
        <div className="field">
          <label className="field__label">配置文件路径</label>
          <div className="repo-nav-settings__path">
            {configPath ?? '(未找到，将使用默认配置)'}
          </div>
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
          恢复默认
        </button>
        {status.kind === 'saving' && <div className="field__hint">正在保存…</div>}
        {status.kind === 'saved' && <div className="field__hint field__hint--success">✓ 配置已保存</div>}
        {status.kind === 'error' && <div className="field__hint field__hint--error">{status.msg}</div>}
      </div>
    </div>
  )
}
