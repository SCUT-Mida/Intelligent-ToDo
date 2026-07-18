import { useState, useEffect, useMemo, useCallback } from 'react'
import type { RepoEntry, RepoNavConfig, RepoIndex } from '@shared/repoNav'
import RepoCard from './RepoCard'

/**
 * Main Repo Navigator view.
 *
 * Mount sequence (performance fix for users with many repos):
 *   1. Load config
 *   2. Try to load cached index.json (instant — just reads disk)
 *   3. If cache hit → display immediately, no spinner
 *   4. If cache miss (first run) → fall back to a full scan
 *
 * Re-scans are ONLY triggered by:
 *   - User clicking the "刷新" button
 *   - Cache miss on first mount
 *
 * The cache timestamp is shown next to the refresh button so the user knows
 * how stale the list is.
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
  const [cachedAt, setCachedAt] = useState<string | null>(null)

  // Load config on mount, then load cached index (or scan on first run)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await window.repoNav.getConfig()
        if (cancelled) return
        setConfig(cfg)
        setSelectedTemplate(cfg.defaultTemplate ?? '')

        // Try cached index first — instant
        const cached = await window.repoNav.loadCachedIndex()
        if (cancelled) return
        if (cached && cached.repos.length > 0) {
          setRepos(cached.repos)
          setCachedAt(cached.generatedAt)
          setLoading(false)
          return
        }

        // Cache miss (first run or empty cache) — fall back to scan
        setLoading(true)
        const result = await window.repoNav.scan()
        if (cancelled) return
        setRepos(result.index.repos)
        setCachedAt(result.index.generatedAt)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        setError('加载失败: ' + (e instanceof Error ? e.message : String(e)))
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

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

  // Handle refresh (re-scan) — only triggered manually
  const handleRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.repoNav.scan()
      setRepos(result.index.repos)
      setCachedAt(result.index.generatedAt)
      showToast(`已刷新（${result.index.repos.length} 个仓库）`, 'success')
    } catch (e) {
      setError('扫描仓库失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setLoading(false)
    }
  }, [])

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
          共 {repos.length} 个仓库，筛选后 {filteredRepos.length} 个
          {cachedAt && (
            <span className="repo-nav-view__cache-age" title={cachedAt}>
              · 最后扫描 {formatRelativeAge(cachedAt)}
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

/**
 * Format an ISO 8601 timestamp as a short Chinese relative-age string.
 * Examples: "刚刚" / "5 分钟前" / "3 小时前" / "2 天前" / "2026-01-01"
 */
function formatRelativeAge(iso: string): string {
  try {
    const then = new Date(iso).getTime()
    if (isNaN(then)) return iso
    const seconds = Math.floor((Date.now() - then) / 1000)
    if (seconds < 60) return '刚刚'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} 分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} 小时前`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} 天前`
    // Older than 30 days — show the date stamp
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}
