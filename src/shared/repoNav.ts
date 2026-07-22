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
  PROBE_TOOL: 'repoNav:probeTool',
  GET_USER_DATA: 'repoNav:getUserData',
  SAVE_USER_DATA: 'repoNav:saveUserData'
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
  /** Ordered list of shell commands executed sequentially (joined by '; '). */
  steps: string[]
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
  { id: 'default', label: '默认', description: '拉取最新代码并启动 opencode 编辑器', steps: ['git pull', 'opencode'] },
  { id: 'update', label: '仅更新', description: '只拉取最新代码，不开编辑器', steps: ['git pull'] },
  { id: 'code', label: 'VSCode', description: '拉取最新代码并用 VSCode 打开', steps: ['git pull', 'code .'] },
  { id: 'build', label: '构建', description: '拉取最新代码并执行 npm 构建', steps: ['git pull', 'npm run build'] },
]

/**
 * Common commands users can pick from when building templates.
 * Shown in the UI as a "quick add" dropdown for convenience.
 */
export const COMMON_COMMANDS: Array<{ command: string; label: string }> = [
  { command: 'git pull', label: 'Git 拉取' },
  { command: 'git pull --prune', label: 'Git 拉取+清理' },
  { command: 'git status', label: 'Git 状态' },
  { command: 'opencode', label: 'OpenCode' },
  { command: 'code .', label: 'VSCode' },
  { command: 'npm install', label: 'NPM 安装依赖' },
  { command: 'npm run build', label: 'NPM 构建' },
  { command: 'npm run dev', label: 'NPM 开发' },
  { command: 'npm test', label: 'NPM 测试' },
  { command: 'pnpm install', label: 'PNPM 安装' },
  { command: 'cargo build', label: 'Cargo 构建' },
  { command: 'go build ./...', label: 'Go 构建' },
  { command: 'python -m venv .venv', label: 'Python 虚拟环境' },
  { command: 'docker compose up -d', label: 'Docker 启动' },
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

// ── Per-user data (favorites, user tags, open counts) ───────────────────────

/**
 * Per-user data layered on top of the scanned RepoIndex. Stored separately
 * from RepoNavConfig (which holds only static settings) so user behavior
 * data persists independently of config changes.
 *
 * Path is the key throughout — repo paths from the RepoIndex.
 */
export interface RepoUserData {
  /** Schema version (always 1 for now). */
  version: 1
  /** Favorite repo paths. Rendered in a dedicated "Favorites" tab. */
  favorites: string[]
  /** User-defined tags per repo path. Layered ON TOP of AI-generated tags. */
  userTags: Record<string, string[]>
  /** Open count per repo path. Drives sorting (popular first). */
  openCounts: Record<string, number>
  /** ISO timestamp of last open per repo path (secondary sort key). */
  lastOpenedAt: Record<string, string>
  /** ISO timestamp when this file was last saved. */
  updatedAt: string
}

/** Factory for a fresh RepoUserData (used on first run). */
export function createDefaultUserData(): RepoUserData {
  return {
    version: 1,
    favorites: [],
    userTags: {},
    openCounts: {},
    lastOpenedAt: {},
    updatedAt: new Date().toISOString()
  }
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

// ── AI operation result ─────────────────────────────────────────────────────

/**
 * Structured result of an AI-backend operation (memory generation, etc).
 * When `success` is false, `error` is a short technical message AND `hint`
 * is a longer, user-facing suggestion for how to fix it (display in UI).
 */
export interface AiOperationResult<T> {
  success: boolean
  data?: T
  /** Short technical error message (English-or-Chinese mixed). */
  error?: string
  /** Categorized error kind for UI styling / routing. */
  errorKind?: 'auth' | 'not-found' | 'network' | 'timeout' | 'config' | 'unknown'
  /** Longer user-facing hint with suggested actions (Chinese). */
  hint?: string
}

/**
 * Classify a thrown error from an LLM call into a structured { kind, hint }.
 * Used by all AI IPC handlers to give actionable error messages.
 */
export function classifyLlmError(err: unknown): { kind: AiOperationResult<unknown>['errorKind']; hint: string; message: string } {
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()

  // Auth failures
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('invalid_api_key')) {
    return {
      kind: 'auth',
      message,
      hint: 'API Key 不正确或已失效。请到「设置 → 通用 → AI 模型」检查当前选中的 provider，确保其 API Key 有效。'
    }
  }

  // Model not found / wrong endpoint
  if (lower.includes('404') || lower.includes('not found') || lower.includes('model not found')) {
    return {
      kind: 'not-found',
      message,
      hint: 'API 地址或模型名不正确。可能是 provider 改了 baseURL 或下线了该模型。请重新选择模型或检查 opencode.json 配置。'
    }
  }

  // Timeout / abort
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('abort') || lower.includes('timeoutms')) {
    return {
      kind: 'timeout',
      message,
      hint: '请求超时（60 秒未响应）。可能是网络较慢或服务端繁忙。建议稍后重试；如果仓库较多，可以在「设置 → 仓库导航 → AI 记忆」调小批量大小。'
    }
  }

  // Network / connection refused
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network')) {
    return {
      kind: 'network',
      message,
      hint: '无法连接到 API 服务。请检查：1) 网络是否正常；2) 是否需要 VPN/代理；3) API 地址是否正确。'
    }
  }

  // Rate limit
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      kind: 'network',
      message,
      hint: 'API 调用频次超限（429 Rate Limited）。请稍后重试，或在「设置 → 仓库导航 → AI 记忆」调小批量大小。'
    }
  }

  // Generic
  return {
    kind: 'unknown',
    message,
    hint: 'AI 调用失败。请查看日志（设置 → 通用 → 诊断日志）了解详情，或稍后重试。'
  }
}

/** Default binary names for each tool kind. */
export const DEFAULT_TOOL_BINARIES: Record<ToolKind, string> = {
  git: 'git',
  terminal: 'wt.exe',
  terminalFallback: 'powershell.exe'
}

// ── Legacy config migration ─────────────────────────────────────────────────

/**
 * Normalize a single command template from any known legacy format to the
 * current `{ id, label, description, steps }` shape. Handles:
 *   - Record<string,string> entries (oldest format, from v1.9 era)
 *   - `{ command: string }` entries (pre-v1.12 single-string format)
 *   - `{ steps: string[] }` entries (current format, passthrough)
 */
function normalizeTemplate(raw: Record<string, unknown>): CommandTemplate {
  const id = typeof raw['id'] === 'string' ? raw['id'] : 'cmd'
  const label = typeof raw['label'] === 'string' ? raw['label'] : id
  const description = typeof raw['description'] === 'string' ? raw['description'] : ''

  // Current format: steps is already an array
  if (Array.isArray(raw['steps'])) {
    return {
      id, label, description,
      steps: (raw['steps'] as unknown[]).filter((s): s is string => typeof s === 'string')
    }
  }

  // Legacy: command is a single string → split by semicolon into steps
  if (typeof raw['command'] === 'string') {
    return {
      id, label, description,
      steps: raw['command']
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  }

  // Unknown shape — return empty steps
  return { id, label, description, steps: [] }
}

/**
 * Convert an old-format config to the current format. Idempotent — safe to
 * call on already-migrated configs.
 *
 * Handles two legacy shapes:
 *   1. commandTemplates as Record<string, string> (v1.9 era)
 *   2. commandTemplates as array of { command: string } (pre-v1.12)
 */
export function migrateLegacyConfig(raw: unknown): RepoNavConfig {
  if (typeof raw !== 'object' || raw === null) {
    return {} as RepoNavConfig
  }

  const rawObj = raw as Record<string, unknown>
  const templates = rawObj['commandTemplates']

  // Shape 1: legacy Record<string, string>
  if (typeof templates === 'object' && templates !== null && !Array.isArray(templates)) {
    const legacyEntries = Object.entries(templates as Record<string, unknown>)
    const migrated: CommandTemplate[] = legacyEntries.map(([id, command]) =>
      normalizeTemplate({
        id,
        label: id,
        description: '',
        command: typeof command === 'string' ? command : String(command)
      })
    )
    return { ...(raw as RepoNavConfig), commandTemplates: migrated }
  }

  // Shape 2: array that may contain { command: string } entries
  if (Array.isArray(templates)) {
    const migrated = templates.map((t) => {
      if (t && typeof t === 'object') {
        return normalizeTemplate(t as Record<string, unknown>)
      }
      return { id: 'unknown', label: 'unknown', description: '', steps: [] }
    })
    return { ...(raw as RepoNavConfig), commandTemplates: migrated }
  }

  // No commandTemplates or already in current format — return as-is
  return raw as RepoNavConfig
}
