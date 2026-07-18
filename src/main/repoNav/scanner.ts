/**
 * BFS git repository scanner.
 *
 * Ported from scripts/repo-nav/Private/Build-RepoIndex.ps1.
 * Produces a RepoIndex that is bit-compatible with the PS CLI version.
 *
 * Key design decisions:
 *   - Queue-based BFS (not recursion) to control depth precisely.
 *   - Detects .git directories OR files (git submodules use a .git file).
 *   - All git metadata calls are wrapped in try/catch — NEVER throw.
 *   - Inaccessible directories are silently skipped.
 */

import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import type { RepoIndex, RepoEntry, RepoNavConfig } from '../../shared/repoNav'

// ── Internal types ──────────────────────────────────────────────────────────

interface BfsEntry {
  /** Absolute path to the directory to explore. */
  path: string
  /** Current depth (0-based: scan root is depth 0). */
  depth: number
  /** The scan root that spawned this BFS branch. */
  scanRoot: string
}

// ── Git metadata helpers (all return null on failure) ──────────────────────

/**
 * Run `git -C <repoPath> <args>` and return trimmed stdout, or null on failure.
 */
function gitGet(repoPath: string, ...args: string[]): string | null {
  try {
    const stdout = execFileSync('git', ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function getRemoteUrl(repoPath: string): string | null {
  return gitGet(repoPath, 'remote', 'get-url', 'origin')
}

function getDefaultBranch(repoPath: string): string | null {
  return gitGet(repoPath, 'rev-parse', '--abbrev-ref', 'HEAD')
}

function getLastCommitDate(repoPath: string): string | null {
  return gitGet(repoPath, 'log', '-1', '--format=%cI')
}

function getLastCommitMessage(repoPath: string): string | null {
  return gitGet(repoPath, 'log', '-1', '--format=%s')
}

// ── Directory traversal helpers ────────────────────────────────────────────

/**
 * Check if `dirName` matches any of the `excludePatterns`.
 * Matches using simple wildcard semantics (case-insensitive).
 */
function isExcluded(dirName: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    if (dirName.toLowerCase() === pattern.toLowerCase()) return true
    // Simple glob matching: treat "*" as prefix/suffix/infix wildcards
    if (pattern.includes('*')) {
      const reStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape special regex chars except *
        .replace(/\*/g, '.*')
      if (new RegExp(`^${reStr}$`, 'i').test(dirName)) return true
    }
  }
  return false
}

/**
 * Check if a path contains a .git entry (directory for regular repos, file for submodules).
 */
function hasGitDir(parentPath: string): boolean {
  try {
    const gitPath = join(parentPath, '.git')
    const stat = statSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

/**
 * Get immediate subdirectories of a path.
 * Returns an empty array if the path is inaccessible.
 */
function getSubDirs(dirPath: string): string[] {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => join(dirPath, e.name))
  } catch {
    return []
  }
}

// ── Main scan function ─────────────────────────────────────────────────────

/**
 * Scan configured root directories for git repositories using BFS.
 *
 * @param config - The RepoNavConfig to use for scanning.
 * @returns A RepoIndex object (never throws).
 */
export async function scanRepos(config: RepoNavConfig): Promise<RepoIndex> {
  const startTime = Date.now()
  const repos: RepoEntry[] = []

  const scanRoots = Array.isArray(config.scanRoots) ? config.scanRoots : []
  const scanDepth = typeof config.scanDepth === 'number' && config.scanDepth >= 1
    ? config.scanDepth
    : 3
  const excludePatterns = Array.isArray(config.excludePatterns) ? config.excludePatterns : []

  const detectedAt = new Date().toISOString()

  for (const root of scanRoots) {
    // Skip non-existent scan roots
    try {
      statSync(root)
    } catch {
      // PS CLI: Write-Warning "Scan root does not exist, skipping: $root"
      // In the GUI we silently skip to avoid noise.
      continue
    }

    // BFS queue
    const queue: BfsEntry[] = [{ path: root, depth: 0, scanRoot: root }]

    while (queue.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const current = queue.shift()!

      // Get the directory name for exclusion check
      const dirName = current.path.split(/[\\/]/).pop() ?? ''

      // Check exclusion patterns
      if (isExcluded(dirName, excludePatterns)) {
        continue
      }

      // Check for .git directory/file
      if (hasGitDir(current.path)) {
        const relativePath = pathRelative(current.scanRoot, current.path).replace(/\\/g, '\\')

        const entry: RepoEntry = {
          name: dirName,
          path: current.path,
          relativePath,
          scanRoot: current.scanRoot,
          remoteUrl: getRemoteUrl(current.path),
          defaultBranch: getDefaultBranch(current.path),
          lastCommitDate: getLastCommitDate(current.path),
          lastCommitMessage: getLastCommitMessage(current.path),
          detectedAt
        }

        repos.push(entry)
      }

      // Enumerate subdirectories if not at max depth
      if (current.depth < scanDepth) {
        const subDirs = getSubDirs(current.path)
        for (const subDir of subDirs) {
          queue.push({ path: subDir, depth: current.depth + 1, scanRoot: current.scanRoot })
        }
      }
    }
  }

  const generatedAt = new Date().toISOString()
  const durationMs = Date.now() - startTime

  const index: RepoIndex = {
    version: 1,
    generatedAt,
    scanRoots,
    repoCount: repos.length,
    repos
  }

  // Persist the index to disk so the PS CLI can also read it
  persistIndex(index)

  return index
}

/**
 * Write the index to ~/.repo-navigator/index.json so the PS CLI and Electron
 * GUI share the same data file.
 */
function persistIndex(index: RepoIndex): void {
  try {
    const dir = join(homedir(), '.repo-navigator')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const indexPath = join(dir, 'index.json')
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch {
    // Silently continue — the in-memory index is returned to the caller
  }
}
