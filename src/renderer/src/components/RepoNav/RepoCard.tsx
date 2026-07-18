import { useState } from 'react'
import type { RepoEntry } from '@shared/repoNav'

interface RepoCardProps {
  repo: RepoEntry
  onOpen: () => void
  /** Optional AI-generated description shown under repo name */
  aiDescription?: string | null
  /** Optional AI-generated tags shown as chips */
  aiTags?: string[]
  /** Whether this repo is in the user's favorites. */
  isFavorite: boolean
  /** Total times this repo has been opened (0 if never). */
  openCount: number
  /** User-defined tags for this repo (shown alongside AI tags). */
  userTags?: string[]
  /** Toggle favorite state. */
  onToggleFavorite: () => void
  /** Add a user tag. */
  onAddUserTag: (tag: string) => void
  /** Remove a user tag. */
  onRemoveUserTag: (tag: string) => void
}

/**
 * A single repo card showing: name, path, branch badge, last commit info,
 * remote URL, AI description/tags (if available), user tags, and an "Open"
 * button. Also: favorite toggle, open-count badge, user-tag editor.
 */
export default function RepoCard({
  repo,
  onOpen,
  aiDescription,
  aiTags,
  isFavorite,
  openCount,
  userTags,
  onToggleFavorite,
  onAddUserTag,
  onRemoveUserTag
}: RepoCardProps): JSX.Element {
  const [showTagInput, setShowTagInput] = useState(false)
  const [tagDraft, setTagDraft] = useState('')

  const commitMessage = repo.lastCommitMessage
    ? repo.lastCommitMessage.length > 60
      ? repo.lastCommitMessage.slice(0, 60) + '…'
      : repo.lastCommitMessage
    : null

  const commitDate = repo.lastCommitDate
    ? formatIsoDate(repo.lastCommitDate)
    : null

  const handleAddTag = (): void => {
    const trimmed = tagDraft.trim().toLowerCase()
    if (!trimmed) return
    if (userTags?.includes(trimmed)) {
      setTagDraft('')
      setShowTagInput(false)
      return
    }
    onAddUserTag(trimmed)
    setTagDraft('')
    setShowTagInput(false)
  }

  return (
    <div className={`repo-card ${isFavorite ? 'repo-card--favorite' : ''}`}>
      <div className="repo-card__top">
        <div className="repo-card__name">{repo.name}</div>
        {repo.defaultBranch && (
          <span className="repo-card__branch">{repo.defaultBranch}</span>
        )}
        {/* Open count badge — only show if user has opened this repo before */}
        {openCount > 0 && (
          <span className="repo-card__count-badge" title={`已打开 ${openCount} 次`}>
            ×{openCount}
          </span>
        )}
        {/* Favorite toggle */}
        <button
          type="button"
          className={`repo-card__fav ${isFavorite ? 'repo-card__fav--active' : ''}`}
          onClick={onToggleFavorite}
          aria-label={isFavorite ? '取消收藏' : '收藏'}
          title={isFavorite ? '取消收藏' : '收藏'}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </div>

      {/* AI description */}
      {aiDescription && (
        <div className="repo-card__ai-description">{aiDescription}</div>
      )}

      {/* AI tags */}
      {aiTags && aiTags.length > 0 && (
        <div className="repo-card__ai-tags">
          {aiTags.map((tag, idx) => (
            <span key={`ai-${idx}`} className="repo-card__ai-tag" title="AI 生成标签">{tag}</span>
          ))}
        </div>
      )}

      {/* User-defined tags (different color, removable) */}
      {userTags && userTags.length > 0 && (
        <div className="repo-card__user-tags">
          {userTags.map((tag, idx) => (
            <span
              key={`user-${idx}`}
              className="repo-card__user-tag"
              title="点击移除"
              onClick={() => onRemoveUserTag(tag)}
            >
              {tag}<span className="repo-card__user-tag-x">×</span>
            </span>
          ))}
        </div>
      )}

      {/* Tag input (toggle via + button below) */}
      {showTagInput && (
        <div className="repo-card__tag-input-row">
          <input
            className="input repo-card__tag-input"
            type="text"
            placeholder="输入标签，回车确认"
            value={tagDraft}
            autoFocus
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddTag()
              if (e.key === 'Escape') { setShowTagInput(false); setTagDraft('') }
            }}
          />
          <button type="button" className="btn btn--ghost" onClick={handleAddTag} disabled={!tagDraft.trim()}>添加</button>
          <button type="button" className="btn btn--ghost" onClick={() => { setShowTagInput(false); setTagDraft('') }}>取消</button>
        </div>
      )}

      <div className="repo-card__path" title={repo.path}>
        {repo.path}
      </div>

      {commitMessage && (
        <div className="repo-card__commit" title={repo.lastCommitMessage ?? undefined}>
          <span className="repo-card__commit-label">最近提交:</span>
          <span className="repo-card__commit-msg">{commitMessage}</span>
        </div>
      )}

      {commitDate && (
        <div className="repo-card__meta">
          <span className="repo-card__meta-item">{commitDate}</span>
        </div>
      )}

      {repo.remoteUrl && (
        <div className="repo-card__remote" title={repo.remoteUrl}>
          {repo.remoteUrl}
        </div>
      )}

      <div className="repo-card__actions">
        <button
          className="btn btn--primary repo-card__open"
          onClick={onOpen}
        >
          打开
        </button>
        {!showTagInput && (
          <button
            type="button"
            className="btn btn--ghost repo-card__add-tag-btn"
            onClick={() => setShowTagInput(true)}
            title="添加标签"
          >
            + 标签
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Format an ISO 8601 date string into a short human-friendly form.
 * "2026-07-17T12:34:56+08:00" → "2026-07-17 12:34"
 */
function formatIsoDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  } catch {
    return iso
  }
}
