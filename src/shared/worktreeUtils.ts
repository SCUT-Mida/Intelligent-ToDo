/**
 * Worktree helpers shared by main (git operations) and renderer (UI hints).
 * Pure functions — unit tested in tests/shared/worktreeUtils.test.ts.
 */

/**
 * Derive a branch/path slug from a free-form task title: keeps ASCII
 * alphanumerics and dashes, collapses the rest to '-', trims, caps length.
 * Chinese-only titles yield '' — callers fall back to a timestamp suffix.
 */
export function slugifyBranchSuffix(title: string, maxLen = 24): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
    .replace(/-$/g, '')
  return slug
}

/** Suggested worktree sibling directory name: `<repoName>-<slug>`. */
export function worktreeDirName(repoName: string, slug: string): string {
  return slug ? `${repoName}-${slug}` : `${repoName}-task`
}

/** Suggested task branch name: `task/<slug>`. */
export function worktreeBranchName(slug: string): string {
  return `task/${slug || 'task'}`
}
