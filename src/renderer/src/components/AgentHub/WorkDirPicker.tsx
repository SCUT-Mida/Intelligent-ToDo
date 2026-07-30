import { useCallback, useState, useRef, useEffect } from 'react'

interface RepoEntry {
  name: string
  path: string
}

interface WorkDirPickerProps {
  value: string
  onChange: (path: string) => void
  /** When true, the browse button is disabled (no active session). */
  disabled?: boolean
  /** Repo entries for the repos dropdown. */
  repos: RepoEntry[]
}

/**
 * Shows the current working directory path (or placeholder) with a
 * "浏览…" button that opens the OS folder picker via IPC, plus a
 * repo dropdown for quick selection from the repo index.
 */
export default function WorkDirPicker({ value, onChange, disabled, repos }: WorkDirPickerProps): JSX.Element {
  const [reposOpen, setReposOpen] = useState(false)
  const [repoSearch, setRepoSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePick = useCallback(async () => {
    if (disabled) return
    try {
      const result = await window.agentHub.pickDirectory()
      if (result) {
        onChange(result)
      }
    } catch (err: unknown) {
      console.error('Failed to pick directory', err)
    }
  }, [onChange, disabled])

  // Close repo dropdown on click outside
  useEffect(() => {
    if (!reposOpen) return
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setReposOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [reposOpen])

  const filteredRepos = repos.filter((r) => {
    if (!repoSearch) return true
    const q = repoSearch.toLowerCase()
    return r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)
  })

  function handleRepoSelect(path: string): void {
    onChange(path)
    setReposOpen(false)
    setRepoSearch('')
  }

  const hasRepos = repos.length > 0

  return (
    <div className="workdir-picker" ref={containerRef}>
      <span
        className={`workdir-picker__path ${!value ? 'workdir-picker__path--empty' : ''}`}
        title={value || undefined}
      >
        {value || '未选择工作目录'}
      </span>
      <button
        className="btn btn--ghost workdir-picker__btn"
        onClick={handlePick}
        disabled={disabled}
        title={disabled ? '请先选择或新建一个会话' : undefined}
      >
        浏览…
      </button>
      <div className="workdir-picker__repos-wrapper">
        <button
          className={`btn btn--ghost workdir-picker__repos-btn ${reposOpen ? 'workdir-picker__repos-btn--open' : ''}`}
          onClick={() => {
            if (!disabled && hasRepos) setReposOpen((v) => !v)
          }}
          disabled={disabled || !hasRepos}
          title={hasRepos ? '从仓库列表选择' : '无仓库'}
        >
          📦
        </button>
        {reposOpen && (
          <div className="workdir-picker__repos-dropdown">
            <input
              className="workdir-picker__repos-search"
              type="text"
              placeholder="搜索仓库…"
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              autoFocus
            />
            <div className="workdir-picker__repos-list">
              {filteredRepos.length === 0 ? (
                <div className="workdir-picker__repos-empty">无匹配仓库</div>
              ) : (
                filteredRepos.map((repo) => (
                  <div
                    key={repo.path}
                    className={`workdir-picker__repos-item ${repo.path === value ? 'workdir-picker__repos-item--selected' : ''}`}
                    onClick={() => handleRepoSelect(repo.path)}
                    title={repo.path}
                  >
                    <span className="workdir-picker__repos-item-name">{repo.name}</span>
                    <span className="workdir-picker__repos-item-path">{repo.path}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
