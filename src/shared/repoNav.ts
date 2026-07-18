/**
 * Shared types for the Repo Navigator feature.
 * This schema is BIT-COMPATIBLE with the PS CLI version at scripts/repo-nav/.
 * The generated index.json is shared between the Electron GUI and the PS CLI.
 */

// ── IPC channel name constants ──────────────────────────────────────────────

export const IPC = {
  SCAN: 'repoNav:scan',
  LOAD_CACHED_INDEX: 'repoNav:loadCachedIndex',
  OPEN_REPO: 'repoNav:openRepo',
  GET_CONFIG: 'repoNav:getConfig',
  SAVE_CONFIG: 'repoNav:saveConfig',
  PICK_DIRECTORY: 'repoNav:pickDirectory',
  PICK_EXECUTABLE: 'repoNav:pickExecutable',
  GET_CONFIG_PATH: 'repoNav:getConfigPath',
  PROBE_TOOL: 'repoNav:probeTool'
} as const

/**
 * Type helper: all IPC channel string values.
 */
export type RepoNavIpcChannel = (typeof IPC)[keyof typeof IPC]

// ── Repo entry ──────────────────────────────────────────────────────────────

export interface RepoEntry {
  /** Directory name (not full path). */
  name: string
  /** Full absolute path to the git repository. */
  path: string
  /** Path relative to the scan root it was found under. */
  relativePath: string
  /** The scan root that discovered this repo. */
  scanRoot: string
  /** Remote origin URL (e.g. "https://github.com/user/repo.git"), or null. */
  remoteUrl: string | null
  /** Current branch name (HEAD), or null. */
  defaultBranch: string | null
  /** ISO 8601 commit date of the latest commit, or null. */
  lastCommitDate: string | null
  /** Subject line of the latest commit, or null. */
  lastCommitMessage: string | null
  /** ISO 8601 timestamp of when this entry was discovered. */
  detectedAt: string
}

// ── Repo index (matches index.json) ─────────────────────────────────────────

export interface RepoIndex {
  /** Schema version (always 1 for now). */
  version: 1
  /** ISO 8601 timestamp of when the index was generated. */
  generatedAt: string
  /** Scan roots that were scanned. */
  scanRoots: string[]
  /** Number of repos found. */
  repoCount: number
  /** All discovered repos. */
  repos: RepoEntry[]
}

// ── Command Template ────────────────────────────────────────────────────────

export interface CommandTemplate {
  /** Stable key like 'default', 'update'. */
  id: string
  /** Chinese label like '默认'. */
  label: string
  /** Chinese description like '拉取最新代码并启动 opencode 编辑器'. */
  description: string
  /** Shell command like 'git pull; opencode'. */
  command: string
}

// ── AI Memory types ─────────────────────────────────────────────────────────

export interface RepoMemoryEntry {
  name: string
  path: string
  /** null if LLM call failed for this repo. */
  description: string | null
  tags: string[]
  /** ISO 8601. */
  generatedAt: string
}

export interface RepoMemory {
  version: 1
  /** ISO 8601 of last full regeneration. */
  generatedAt: string
  entries: RepoMemoryEntry[]
}

export interface RankedRepoMatch {
  repoPath: string
  repoName: string
  /** 0..1 */
  score: number
  /** Chinese explanation from LLM. */
  reason: string
}

// ── IPC_V2 channel names ───────────────────────────────────────────────────

export const IPC_V2 = {
  REPO_DESCRIBE_BATCH: 'repoNav:describeBatch',
  REPO_GET_MEMORY: 'repoNav:getMemory',
  REPO_REGENERATE_MEMORY: 'repoNav:regenerateMemory',
} as const

// ── Default command templates (Chinese labels) ─────────────────────────────

export const DEFAULT_TEMPLATES: CommandTemplate[] = [
  { id: 'default', label: '默认', description: '拉取最新代码并启动 opencode 编辑器', command: 'git pull; opencode' },
  { id: 'update', label: '仅更新', description: '只拉取最新代码，不开编辑器', command: 'git pull --prune' },
  { id: 'code', label: 'VSCode', description: '拉取最新代码并用 VSCode 打开', command: 'git pull; code .' },
  { id: 'build', label: '构建', description: '拉取最新代码并执行 npm 构建', command: 'git pull; npm run build' },
]

// ── Repo Navigator config (matches config.json / config.example.json) ────────

export interface RepoNavConfig {
  /** Optional schema pointer (informational only). */
  '$schema'?: string
  /** Absolute directories to scan for git repos. */
  scanRoots: string[]
  /** Maximum BFS depth when scanning (1 = only immediate children). */
  scanDepth: number
  /** Directory name patterns to skip (PowerShell-like wildcards). */
  excludePatterns: string[]
  /** Named command templates. */
  commandTemplates: CommandTemplate[]
  /** Which template is selected by default. */
  defaultTemplate: string
  /** Open mode: "new-tab" or "new-window". */
  openIn: 'new-tab' | 'new-window'
  /** Whether to fall back to powershell.exe if wt.exe is missing. */
  fallbackToPowerShellExe: boolean
  /** Auto-generate AI memory descriptions on scan. Default false. */
  autoGenerateMemory?: boolean
  /** Batch size for LLM calls. Default 5. */
  memoryBatchSize?: number
  /**
   * Optional override for the git executable (used by the scanner).
   * Accepts a bare name (resolved via PATH) or an absolute path.
   * Default: 'git'.
   */
  gitBinary?: string
  /**
   * Optional override for the primary terminal executable.
   * Accepts a bare name (resolved via PATH) or an absolute path.
   * Default: 'wt.exe'.
   */
  terminalBinary?: string
  /**
   * Optional override for the fallback terminal executable.
   * Used when terminalBinary is unavailable.
   * Default: 'powershell.exe'.
   */
  terminalFallback?: string
}

// ── IPC payload types ───────────────────────────────────────────────────────

export interface OpenRepoRequest {
  path: string
  command: string
  mode: 'new-tab' | 'new-window'
}

export interface OpenRepoResult {
  success: boolean
  method: 'wt' | 'powershell' | 'failed'
  error?: string
}

export interface ScanResult {
  index: RepoIndex
  durationMs: number
}

// ── Tool probe / autodetect ─────────────────────────────────────────────────

/**
 * Tool kinds that can be probed or auto-detected.
 * Used by the IPC.PROBE_TOOL channel.
 */
export type ToolKind = 'git' | 'terminal' | 'terminalFallback'

/** Result of probing a single tool with `--version` (or equivalent). */
export interface ToolProbeResult {
  /** Whether the tool was found and ran successfully. */
  ok: boolean
  /** Trimmed version/output string on success, or stderr/error message on failure. */
  output?: string
  /** Absolute path resolved by `where.exe`/PATH lookup, if available. */
  resolvedPath?: string
}

/** Default binary names for each tool kind. */
export const DEFAULT_TOOL_BINARIES: Record<ToolKind, string> = {
  git: 'git',
  terminal: 'wt.exe',
  terminalFallback: 'powershell.exe'
}

// ── Legacy config migration ─────────────────────────────────────────────────

/**
 * Convert an old-format config whose `commandTemplates` is a `Record<string, string>`
 * to the new `CommandTemplate[]` format. Idempotent — safe to call on already-migrated
 * configs (they pass through unchanged).
 *
 * Accepts raw parsed JSON (unknown) to handle runtime format detection without
 * compile-time conflicts.
 */
export function migrateLegacyConfig(raw: unknown): RepoNavConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {} as RepoNavConfig
  }

  // Access commandTemplates dynamically to handle dual format
  const rawObj = raw as Record<string, unknown>
  const templates = rawObj['commandTemplates']

  // Detect legacy format: is a non-null, non-array object (Record<string, string>)
  if (typeof templates === 'object' && templates !== null && !Array.isArray(templates)) {
    const legacyEntries = Object.entries(templates as Record<string, unknown>)
    const migrated: CommandTemplate[] = legacyEntries.map(([id, command]) => ({
      id,
      label: id,
      description: '',
      command: typeof command === 'string' ? command : String(command)
    }))

    // Return merged with other fields preserved
    return {
      ...(raw as RepoNavConfig),
      commandTemplates: migrated
    }
  }

  // Already migrated or no templates field — return as-is
  return raw as RepoNavConfig
}
