/**
 * BFS git repository scanner (async, non-blocking).
 *
 * Two phases:
 *   1. BFS directory traversal — discovers all repo paths (synchronous,
 *      very fast — just readdirSync/statSync, no subprocess spawns).
 *   2. Git metadata enrichment — runs 4 git commands per repo, in parallel
 *      batches of BATCH_SIZE. Async (execFile, not execFileSync) so the
 *      main process event loop stays responsive. Reports progress via
 *      callback so the renderer can show a progress bar.
 *
 * Ported from scripts/repo-nav/Private/Build-RepoIndex.ps1.
 */

import { readdirSync, statSync, existsSync, writeFileSync } from 'fs'
import { join, relative as pathRelative } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { RepoIndex, RepoEntry, RepoNavConfig } from '../../shared/repoNav'
import { dataFilePath, migrateFromLegacy } from './paths'
import { logger } from '../logger'

const execFileAsync = promisify(execFile)

/** Number of repos to enrich in parallel per batch. */
const BATCH_SIZE = 10

/** Progress callback: (currentReposEnriched, totalReposDiscovered, currentRepoName). */
export type ScanProgressCallback = (current: number, total: number, repoName: string) => void

// ── Internal types ──────────────────────────────────────────────────────────

interface BfsEntry {
  path: string
  depth: number
  scanRoot: string
}

/** A discovered repo path that needs git metadata enrichment. */
interface DiscoveredRepo {
  name: string
  path: string
  relativePath: string
  scanRoot: string
}

// ── Async git metadata helpers (all return null on failure) ────────────────

async function gitGet(repoPath: string, gitBinary: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(gitBinary, ['-C', repoPath, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      windowsHide: true
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

// ── Directory traversal helpers (synchronous — fast, no subprocess) ────────

function isExcluded(dirName: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    if (dirName.toLowerCase() === pattern.toLowerCase()) return true
    if (pattern.includes('*')) {
      const reStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
      if (new RegExp(`^${reStr}$`, 'i').test(dirName)) return true
    }
  }
  return false
}

function hasGitDir(parentPath: string): boolean {
  try {
    const gitPath = join(parentPath, '.git')
    const stat = statSync(gitPath)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

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

// ── Phase 1: BFS traversal (synchronous, fast) ─────────────────────────────

/**
 * Walk the scan roots via BFS and collect all directories containing .git.
 * This phase is intentionally synchronous — it's just readdirSync/statSync,
 * which completes in milliseconds even for hundreds of directories.
 */
function discoverRepos(config: RepoNavConfig): DiscoveredRepo[] {
  const scanRoots = Array.isArray(config.scanRoots) ? config.scanRoots : []
  const scanDepth = typeof config.scanDepth === 'number' && config.scanDepth >= 1 ? config.scanDepth : 3
  const excludePatterns = Array.isArray(config.excludePatterns) ? config.excludePatterns : []
  const discovered: DiscoveredRepo[] = []

  for (const root of scanRoots) {
    try { statSync(root) } catch { continue }

    const queue: BfsEntry[] = [{ path: root, depth: 0, scanRoot: root }]
    while (queue.length > 0) {
      const current = queue.shift()!
      const dirName = current.path.split(/[\\/]/).pop() ?? ''
      if (isExcluded(dirName, excludePatterns)) continue

      if (hasGitDir(current.path)) {
        const relativePath = pathRelative(current.scanRoot, current.path).replace(/\\/g, '\\')
        discovered.push({ name: dirName, path: current.path, relativePath, scanRoot: current.scanRoot })
      }

      if (current.depth < scanDepth) {
        for (const subDir of getSubDirs(current.path)) {
          queue.push({ path: subDir, depth: current.depth + 1, scanRoot: current.scanRoot })
        }
      }
    }
  }

  return discovered
}

// ── Phase 2: Async git metadata enrichment ─────────────────────────────────

/**
 * Enrich a single discovered repo with git metadata (remote, branch, commit).
 * Runs 4 git commands in parallel via Promise.all for speed.
 */
async function enrichRepo(d: DiscoveredRepo, gitBinary: string, detectedAt: string): Promise<RepoEntry> {
  const [remoteUrl, defaultBranch, lastCommitDate, lastCommitMessage] = await Promise.all([
    gitGet(d.path, gitBinary, 'remote', 'get-url', 'origin'),
    gitGet(d.path, gitBinary, 'rev-parse', '--abbrev-ref', 'HEAD'),
    gitGet(d.path, gitBinary, 'log', '-1', '--format=%cI'),
    gitGet(d.path, gitBinary, 'log', '-1', '--format=%s')
  ])
  return {
    name: d.name,
    path: d.path,
    relativePath: d.relativePath,
    scanRoot: d.scanRoot,
    remoteUrl,
    defaultBranch,
    lastCommitDate,
    lastCommitMessage,
    detectedAt
  }
}

// ── Main scan function ─────────────────────────────────────────────────────

/**
 * Scan configured root directories for git repositories.
 *
 * Phase 1 (synchronous): BFS discovers all repo paths.
 * Phase 2 (async, batched): Each repo gets 4 git metadata calls in parallel.
 * The event loop stays responsive between batches — other IPC calls (like
 * the Todo app's data:load) can be served.
 *
 * @param config     RepoNavConfig with scanRoots, scanDepth, etc.
 * @param onProgress Optional callback for progress reporting.
 * @returns A RepoIndex object (never throws).
 */
export async function scanRepos(config: RepoNavConfig, onProgress?: ScanProgressCallback): Promise<RepoIndex> {
  const startTime = Date.now()
  const gitBinary = config.gitBinary?.trim() || 'git'
  logger.info('scanner', 'scan start', {
    scanRoots: config.scanRoots,
    scanDepth: config.scanDepth,
    gitBinary
  })

  // Phase 1: discover all repos (synchronous, fast)
  const discovered = discoverRepos(config)
  logger.info('scanner', 'phase 1 complete (BFS discovery)', { discovered: discovered.length })

  if (discovered.length === 0) {
    const index: RepoIndex = {
      version: 1,
      generatedAt: new Date().toISOString(),
      scanRoots: config.scanRoots ?? [],
      repoCount: 0,
      repos: []
    }
    persistIndex(index)
    return index
  }

  // Phase 2: enrich with git metadata (async, batched)
  const detectedAt = new Date().toISOString()
  const repos: RepoEntry[] = []

  for (let i = 0; i < discovered.length; i += BATCH_SIZE) {
    const batch = discovered.slice(i, i + BATCH_SIZE)
    const enriched = await Promise.all(batch.map((d) => enrichRepo(d, gitBinary, detectedAt)))
    repos.push(...enriched)

    // Report progress
    const lastInBatch = batch[batch.length - 1]
    onProgress?.(repos.length, discovered.length, lastInBatch?.name ?? '')

    // Yield to the event loop so other IPC calls can be processed.
    // Without this, the main process is still "busy" from the perspective
    // of other pending IPC handlers.
    await new Promise((resolve) => setImmediate(resolve))
  }

  const durationMs = Date.now() - startTime
  logger.info('scanner', 'scan complete', { repoCount: repos.length, durationMs })

  const index: RepoIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    scanRoots: config.scanRoots ?? [],
    repoCount: repos.length,
    repos
  }

  persistIndex(index)
  return index
}

/**
 * Write the index to <userData>/repo-nav/index.json.
 */
function persistIndex(index: RepoIndex): void {
  try {
    migrateFromLegacy('index.json')
    const indexPath = dataFilePath('index.json')
    writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8')
  } catch {
    // Silently continue
  }
}
