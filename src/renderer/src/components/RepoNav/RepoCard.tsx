import type { RepoEntry } from '@shared/repoNav'

interface RepoCardProps {
  repo: RepoEntry
  onOpen: () => void
  /** Optional AI-generated description shown under repo name */
  aiDescription?: string | null
  /** Optional AI-generated tags shown as chips */
  aiTags?: string[]
}

/**
 * A single repo card showing: name, path, branch badge, last commit info,
 * remote URL, AI description/tags (if available), and an "Open" button.
 */
export default function RepoCard({ repo, onOpen, aiDescription, aiTags }: RepoCardProps): JSX.Element {
  const commitMessage = repo.lastCommitMessage
    ? repo.lastCommitMessage.length > 60
      ? repo.lastCommitMessage.slice(0, 60) + '…'
      : repo.lastCommitMessage
    : null

  const commitDate = repo.lastCommitDate
    ? formatIsoDate(repo.lastCommitDate)
    : null

  return (
    <div className="repo-card">
      <div className="repo-card__top">
        <div className="repo-card__name">{repo.name}</div>
        {repo.defaultBranch && (
          <span className="repo-card__branch">{repo.defaultBranch}</span>
        )}
      </div>

      {/* AI description */}
      {aiDescription && (
        <div className="repo-card__ai-description">{aiDescription}</div>
      )}

      {/* AI tags */}
      {aiTags && aiTags.length > 0 && (
        <div className="repo-card__ai-tags">
          {aiTags.map((tag, idx) => (
            <span key={idx} className="repo-card__ai-tag">{tag}</span>
          ))}
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
