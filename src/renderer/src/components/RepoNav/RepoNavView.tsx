import { useState, useEffect, useMemo, useCallback } from 'react'
import type { RepoEntry, RepoNavConfig } from '@shared/repoNav'
import RepoCard from './RepoCard'

/**
 * Main Repo Navigator view.
 *
 * On mount: fetches config, then triggers a scan.
 * Manages search filter, template selection, loading/error states.
 * Settings are managed via the global UnifiedSettingsModal (ActivityBar ⚙).
 */
interface RepoNavViewProps {
  /** Optional map of repo path → AI memory data for display in RepoCard */
  memoryMap?: Record<string, { description: string | null; tags: string[] }>
}

export default function RepoNavView({ memoryMap }: RepoNavViewProps): JSX.Element {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [filter, setFilter] = useState('')
  const [config, setConfig] = useState<RepoNavConfig | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Load config on mount
  useEffect(() => {
    window.repoNav
      .getConfig()
      .then((cfg) => {
        setConfig(cfg)
        setSelectedTemplate(cfg.defaultTemplate ?? '')
      })
      .catch((e) => {
        setError('加载配置失败: ' + (e instanceof Error ? e.message : String(e)))
        setLoading(false)
      })
  }, [])

  // Trigger scan when config is ready
  useEffect(() => {
    if (!config) return

    setLoading(true)
    setError(null)

    window.repoNav
      .scan()
      .then((result) => {
        setRepos(result.index.repos)
        setLoading(false)
      })
      .catch((e) => {
        setError('扫描仓库失败: ' + (e instanceof Error ? e.message : String(e)))
        setLoading(false)
      })
  }, [config])

  // Filter repos by name or path (case-insensitive)
  const filteredRepos = useMemo(() => {
    if (!filter.trim()) return repos
    const lower = filter.toLowerCase()
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.path.toLowerCase().includes(lower) ||
        r.relativePath.toLowerCase().includes(lower)
    )
  }, [repos, filter])

  // Handle refresh (re-scan)
  const handleRefresh = useCallback(async (): Promise<void> => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.repoNav.scan()
      setRepos(result.index.repos)
    } catch (e) {
      setError('扫描仓库失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [config])

  // Handle opening a repo
  const handleOpen = useCallback(async (repo: RepoEntry): Promise<void> => {
    if (!config) return

    // Find the selected template by ID, fall back to first available or default
    const templates = config.commandTemplates ?? []
    const selected = templates.find((t) => t.id === selectedTemplate) ?? templates[0]
    const command = selected?.command ?? 'git pull; opencode'
    const mode = config.openIn

    try {
      const result = await window.repoNav.openRepo(repo.path, command, mode)
      if (result.success) {
        const methodLabel = result.method === 'wt' ? 'Windows Terminal' : 'PowerShell'
        showToast(`已通过 ${methodLabel} 打开 ${repo.name}`, 'success')
      } else {
        showToast(`打开失败: ${result.error ?? '未知错误'}`, 'error')
      }
    } catch (e) {
      showToast('打开失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [config, selectedTemplate])

  // Show toast notification (auto-dismiss after 3s)
  const showToast = (message: string, type: 'success' | 'error'): void => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const templates = config?.commandTemplates ?? []

  return (
    <div className="repo-nav-view">
      {/* Top toolbar */}
      <div className="repo-nav-view__toolbar">
        <input
          className="input repo-nav-view__search"
          type="text"
          placeholder="搜索仓库名称或路径..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <select
          className="select repo-nav-view__template"
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
          disabled={templates.length === 0}
        >
          {templates.length === 0 && (
            <option value="">无模板</option>
          )}
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id} title={tpl.description}>
              {tpl.label || tpl.id}
            </option>
          ))}
        </select>

        <button
          className="btn btn--primary"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? '扫描中...' : '刷新'}
        </button>
      </div>

      {/* Status info */}
      {!loading && !error && config && (
        <div className="repo-nav-view__info">
          扫描根目录: {config.scanRoots.join(', ')}
          {repos.length > 0 && (
            <span style={{ marginLeft: 16 }}>
              共 {repos.length} 个仓库，筛选后 {filteredRepos.length} 个
            </span>
          )}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="repo-nav-view__error">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="repo-nav-view__loading">
          <div className="spinner" />
          <div>正在扫描仓库...</div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredRepos.length === 0 && (
        <div className="repo-nav-view__empty">
          {repos.length === 0
            ? '未发现仓库。请检查扫描根目录设置。'
            : '没有匹配的仓库，请调整搜索条件。'}
        </div>
      )}

      {/* Repo grid */}
      {!loading && filteredRepos.length > 0 && (
        <div className="repo-nav-view__grid">
          {filteredRepos.map((repo) => (
            <RepoCard
              key={repo.path}
              repo={repo}
              onOpen={() => handleOpen(repo)}
              aiDescription={memoryMap?.[repo.path]?.description}
              aiTags={memoryMap?.[repo.path]?.tags}
            />
          ))}
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div className={`repo-nav-view__toast repo-nav-view__toast--${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}
