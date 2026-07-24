import { useState, useEffect, useMemo, useCallback } from 'react'
import type { RepoEntry, RepoNavConfig, RepoIndex, RepoUserData } from '@shared/repoNav'
import RepoCard from './RepoCard'

type ViewTab = 'all' | 'favorites'

interface RepoNavViewProps {
  /** Map of repo path → AI memory data for display in RepoCard. */
  memoryMap?: Record<string, { description: string | null; tags: string[] }>
  /** Per-user data: favorites, user tags, open counts. */
  userData?: RepoUserData | null
  /** Toggle favorite state for a repo. */
  onToggleFavorite?: (repoPath: string) => void
  /** Add a user-defined tag. */
  onAddUserTag?: (repoPath: string, tag: string) => void
  /** Remove a user-defined tag. */
  onRemoveUserTag?: (repoPath: string, tag: string) => void
  /** Called after a successful open (so the parent can update userData). */
  onRepoOpen?: (repoPath: string) => void
}

/**
 * Main Repo Navigator view.
 *
 * Mount sequence (performance fix for users with many repos):
 *   1. Load config
 *   2. Try to load cached index.json (instant — just reads disk)
 *   3. If cache hit → display immediately, no spinner
 *   4. If cache miss (first run) → fall back to a full scan
 *
 * Sorting (when no search query): favorites first, then by open count desc,
 * then by last-opened-at recency, then alphabetical. This surfaces the
 * repos the user actually cares about at the top.
 *
 * Search: case-insensitive substring match against name/path/relativePath
 * AND any AI tag/description AND any user-defined tag. Multi-term OR.
 */
export default function RepoNavView({
  memoryMap,
  userData,
  onToggleFavorite,
  onAddUserTag,
  onRemoveUserTag,
  onRepoOpen
}: RepoNavViewProps): JSX.Element {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [filter, setFilter] = useState('')
  const [config, setConfig] = useState<RepoNavConfig | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('all')
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; name: string } | null>(null)

  // Load config on mount, then load cached index (or scan on first run)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await window.repoNav.getConfig()
        if (cancelled) return
        setConfig(cfg)
        setSelectedTemplate(cfg.defaultTemplate ?? '')

        const cached = await window.repoNav.loadCachedIndex()
        if (cancelled) return
        if (cached && cached.repos.length > 0) {
          setRepos(cached.repos)
          setCachedAt(cached.generatedAt)
          setLoading(false)
          return
        }

        setLoading(true)
        setScanProgress({ current: 0, total: 0, name: '正在发现仓库...' })
        const unsubInit = window.repoNav.onScanProgress((p) => { if (!cancelled) setScanProgress(p) })
        const result = await window.repoNav.scan()
        unsubInit()
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

  /**
   * Compute the final filtered + sorted repo list.
   *
   * Filter pipeline:
   *   1. Apply view tab (all | favorites)
   *   2. Apply search filter (multi-term OR against all searchable fields)
   *
   * Sort (stable): favorites first → openCount desc → lastOpenedAt desc →
   * alphabetical by name. With search active, exact-tag matches get a small
   * boost so users find what they typed.
   */
  const visibleRepos = useMemo(() => {
    const favorites = userData?.favorites ?? []
    const openCounts = userData?.openCounts ?? {}
    const lastOpenedAt = userData?.lastOpenedAt ?? {}
    const userTags = userData?.userTags ?? {}

    // Step 1: filter by tab
    let pool = repos
    if (viewTab === 'favorites') {
      const favSet = new Set(favorites)
      pool = repos.filter((r) => favSet.has(r.path))
    }

    // Step 2: filter by search query
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? pool.filter((r) => {
          const fields: string[] = [
            r.name.toLowerCase(),
            r.path.toLowerCase(),
            r.relativePath.toLowerCase()
          ]
          const mem = memoryMap?.[r.path]
          if (mem) {
            if (mem.description) fields.push(mem.description.toLowerCase())
            if (mem.tags?.length) fields.push(mem.tags.join(' ').toLowerCase())
          }
          const ut = userTags[r.path]
          if (ut?.length) fields.push(ut.join(' ').toLowerCase())
          const terms = q.split(/\s+/).filter((t) => t.length > 0)
          return terms.some((term) => fields.some((f) => f.includes(term)))
        })
      : pool

    // Step 3: sort
    const favSet = new Set(favorites)
    return [...filtered].sort((a, b) => {
      // Favorites first
      const aFav = favSet.has(a.path) ? 1 : 0
      const bFav = favSet.has(b.path) ? 1 : 0
      if (aFav !== bFav) return bFav - aFav
      // Then by open count desc
      const aCount = openCounts[a.path] ?? 0
      const bCount = openCounts[b.path] ?? 0
      if (aCount !== bCount) return bCount - aCount
      // Then by last opened (more recent first)
      const aLast = lastOpenedAt[a.path] ?? ''
      const bLast = lastOpenedAt[b.path] ?? ''
      if (aLast !== bLast) return bLast.localeCompare(aLast)
      // Then alphabetical
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
  }, [repos, viewTab, filter, userData, memoryMap])

  const handleRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setScanProgress({ current: 0, total: 0, name: '正在发现仓库...' })
    // Subscribe to progress events during scan
    const unsub = window.repoNav.onScanProgress((p) => setScanProgress(p))
    try {
      const result = await window.repoNav.scan()
      setRepos(result.index.repos)
      setCachedAt(result.index.generatedAt)
      showToast(`已刷新（${result.index.repos.length} 个仓库）`, 'success')
    } catch (e) {
      setError('扫描仓库失败: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      unsub()
      setScanProgress(null)
      setLoading(false)
    }
  }, [])

  const handleOpen = useCallback(async (repo: RepoEntry): Promise<void> => {
    if (!config) return
    const templates = config.commandTemplates ?? []
    const commands = config.commands ?? []
    const selected = templates.find((t) => t.id === selectedTemplate) ?? templates[0]
    // Resolve commandIds → command strings → join with '; '
    const command = selected?.commandIds
      ?.map((id) => commands.find((c) => c.id === id)?.command)
      .filter((c): c is string => !!c)
      .join('; ')
      ?? 'git pull; opencode'
    const mode = config.openIn

    try {
      const result = await window.repoNav.openRepo(repo.path, command, mode)
      if (result.success) {
        const methodLabel = result.method === 'wt' ? 'Windows Terminal' : 'PowerShell'
        showToast(`已通过 ${methodLabel} 打开 ${repo.name}`, 'success')
        onRepoOpen?.(repo.path) // parent updates userData
      } else {
        showToast(`打开失败: ${result.error ?? '未知错误'}`, 'error')
      }
    } catch (e) {
      showToast('打开失败: ' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }, [config, selectedTemplate, onRepoOpen])

  const showToast = (message: string, type: 'success' | 'error'): void => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const templates = config?.commandTemplates ?? []
  const favoritesCount = userData?.favorites.length ?? 0

  return (
    <div className="repo-nav-view">
      {/* Top toolbar */}
      <div className="repo-nav-view__toolbar">
        <input
          className="input repo-nav-view__search"
          type="text"
          placeholder="搜索仓库名、路径、标签或描述…"
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
              {tpl.name || '(未命名)'}
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

      {/* Tab switcher: 全部 / 收藏 */}
      <div className="repo-nav-view__tabs">
        <button
          type="button"
          className={`repo-nav-view__tab ${viewTab === 'all' ? 'repo-nav-view__tab--active' : ''}`}
          onClick={() => setViewTab('all')}
        >
          全部 ({repos.length})
        </button>
        <button
          type="button"
          className={`repo-nav-view__tab ${viewTab === 'favorites' ? 'repo-nav-view__tab--active' : ''}`}
          onClick={() => setViewTab('favorites')}
          disabled={favoritesCount === 0}
          title={favoritesCount === 0 ? '还没有收藏的仓库，点击仓库卡片右上角的 ☆ 收藏' : undefined}
        >
          ★ 收藏 ({favoritesCount})
        </button>
      </div>

      {/* Status info */}
      {!loading && !error && config && (
        <div className="repo-nav-view__info">
          共 {visibleRepos.length} 个仓库{filter ? `（搜索："${filter}"）` : ''}
          {cachedAt && (
            <span className="repo-nav-view__cache-age" title={cachedAt}>
              · 最后扫描 {formatRelativeAge(cachedAt)}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="repo-nav-view__error">{error}</div>
      )}

      {loading && (
        <div className="repo-nav-view__loading">
          <div className="spinner" />
          {scanProgress && scanProgress.total > 0 ? (
            <>
              <div>正在扫描仓库... ({scanProgress.current}/{scanProgress.total})</div>
              <div className="scan-progress-bar">
                <div className="scan-progress-bar__fill" style={{ width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%` }} />
              </div>
              <div className="scan-progress__name">{scanProgress.name}</div>
            </>
          ) : scanProgress ? (
            <div>{scanProgress.name}</div>
          ) : (
            <div>正在扫描仓库...</div>
          )}
        </div>
      )}

      {!loading && !error && visibleRepos.length === 0 && (
        <div className="repo-nav-view__empty">
          {repos.length === 0
            ? '未发现仓库。请检查扫描根目录设置。'
            : viewTab === 'favorites'
              ? '还没有收藏的仓库。切到「全部」标签，点击仓库卡片右上角的 ☆ 即可收藏。'
              : '没有匹配的仓库，请调整搜索条件。'}
        </div>
      )}

      {/* Repo grid */}
      {!loading && visibleRepos.length > 0 && (
        <div className="repo-nav-view__grid">
          {visibleRepos.map((repo) => {
            const isFavorite = userData?.favorites.includes(repo.path) ?? false
            const openCount = userData?.openCounts[repo.path] ?? 0
            const userTags = userData?.userTags[repo.path] ?? []
            return (
              <RepoCard
                key={repo.path}
                repo={repo}
                onOpen={() => handleOpen(repo)}
                aiDescription={memoryMap?.[repo.path]?.description}
                aiTags={memoryMap?.[repo.path]?.tags}
                isFavorite={isFavorite}
                openCount={openCount}
                userTags={userTags}
                onToggleFavorite={() => onToggleFavorite?.(repo.path)}
                onAddUserTag={(tag) => onAddUserTag?.(repo.path, tag)}
                onRemoveUserTag={(tag) => onRemoveUserTag?.(repo.path, tag)}
              />
            )
          })}
        </div>
      )}

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
    return new Date(iso).toISOString().slice(0, 10)
  } catch {
    return iso
  }
}
