/**
 * Agent Hub — CLI agent session manager & terminal launcher.
 *
 * A launcher-style UI that lets users manage CLI agent sessions (Claude Code,
 * Hermes, NGA, etc.) and launch them in system terminal windows with one click.
 *
 * Architecture:
 *   renderer ──IPC──▶ main/agentHub ──launchTerminal──▶ OS terminal (wt/powershell)
 *
 * Each "session" is a saved (agent + workDir) pair. The user clicks "launch"
 * and a real terminal window opens at the workDir with the agent running.
 * The terminal uses -NoExit so it stays open after the agent exits.
 *
 * This approach gives 100% native CLI interaction (slash commands, TUI,
 * streaming) because the agent runs in a real terminal — not an embedded
 * emulation layer. The Agent Hub's job is session history + quick launch.
 */

// ── IPC channels (renderer → main, request/response) ────────────────────────

export const AGENT_IPC = {
   /** Detect installed CLI agents on this machine. Returns AgentDescriptor[]. */
   LIST_AGENTS: 'agentHub:listAgents',
   /** Load all saved sessions from disk. */
   GET_SESSIONS: 'agentHub:getSessions',
   /** Persist all sessions to disk. */
   SAVE_SESSIONS: 'agentHub:saveSessions',
   /** Load the Agent Hub configuration (custom agents + per-agent args). */
   GET_AGENT_CONFIG: 'agentHub:getAgentConfig',
   /** Persist the Agent Hub configuration. */
   SAVE_AGENT_CONFIG: 'agentHub:saveAgentConfig',
  /**
   * Launch an agent in a system terminal window at the given workDir.
   * Returns the launch result (success/failure + method).
   */
   LAUNCH: 'agentHub:launch',
   /** Show OS folder picker; returns selected path or null. */
   PICK_DIRECTORY: 'agentHub:pickDirectory',
   /** Probe a custom agent command (--version style). */
   PROBE_AGENT: 'agentHub:probeAgent',
   /** Load cached repo index from repoNav (for workDir dropdown). */
   GET_REPO_INDEX: 'agentHub:getRepoIndex',

   // ── Embedded PTY (terminal inside the app window) ──
   /** Create a PTY session. Returns the session id. */
   PTY_CREATE: 'agentHub:pty:create',
   /** Write data to a PTY's stdin. */
   PTY_INPUT: 'agentHub:pty:input',
   /** Resize a PTY. */
   PTY_RESIZE: 'agentHub:pty:resize',
   /** Kill a PTY process. */
   PTY_KILL: 'agentHub:pty:kill',
   /** Read clipboard text from the main process (reliable paste into PTY). */
   CLIPBOARD_READ: 'agentHub:clipboardRead',
   /** Write text to the OS clipboard from the main process (reliable copy). */
   CLIPBOARD_WRITE: 'agentHub:clipboardWrite',
  /**
   * Session environment diagnosis (v1.25.3): probes git resolution, repo
   * detection, PATH augmentation and cmd AutoRun through the SAME env the
   * PTY would use — for debugging agent-side repo/whitelist failures.
   */
  DIAGNOSE_ENV: 'agentHub:diagnoseEnv'
 } as const

 // ── PTY push event channels (main → renderer) ──────────────────────────────

 export const PTY_STREAM = {
   /** PTY stdout/stderr data arrived. */
   DATA: 'agentHub:pty:data',
   /** PTY process exited. */
   EXIT: 'agentHub:pty:exit'
 } as const

// ── Structured task runs (v1.23) ─────────────────────────────────────────────

/** IPC channels for the task runner (renderer → main). */
export const TASK_IPC = {
  /** Start a structured one-shot task run. Returns the run id (or null). */
  RUN: 'agentHub:task:run',
  /** Cancel a running task. */
  CANCEL: 'agentHub:task:cancel',
  /** List known runs (running + recent finished). */
  LIST: 'agentHub:task:list',
  /** Load a session's persisted event log. */
  GET_EVENTS: 'agentHub:task:getEvents',
  /** Search across session histories + event logs. */
  SEARCH: 'agentHub:search'
} as const

/**
 * Worktree isolation IPC (v1.27). The renderer orchestrates: create before
 * session creation / task runs, merge+cleanup when the user decides.
 */
export const WORKTREE_IPC = {
  /** Create a sibling worktree with a fresh task branch. */
  CREATE: 'agentHub:worktree:create',
  /** Rebase the task branch onto the repo's checked-out branch + ff merge (+ optional push). */
  MERGE: 'agentHub:worktree:merge',
  /** Remove the worktree (and optionally its branch). */
  REMOVE: 'agentHub:worktree:remove'
} as const

export interface WorktreeCreateResult {
  ok: boolean
  repoPath?: string
  branch?: string
  path?: string
  error?: string
}

export interface WorktreeMergeResult {
  ok: boolean
  /** True when the rebase hit conflicts (auto-aborted; worktree intact). */
  conflict?: boolean
  /** True when the optional push to origin succeeded. */
  pushed?: boolean
  /** Commits carried into the main branch. */
  mergedCount?: number
  error?: string
}

export interface WorktreeRemoveOptions {
  /** Force removal even when the worktree is dirty. */
  force?: boolean
  /** Also delete the task branch (`-D`, losing unmerged commits). */
  deleteBranch?: boolean
}

export interface WorktreeRemoveResult {
  ok: boolean
  error?: string
}

// ── Scheduled agent tasks (v1.28) ─────────────────────────────────────────────

/** IPC channels for scheduled-task management (renderer → main). */
export const SCHEDULE_IPC = {
  /** Load all scheduled tasks. */
  LIST: 'agentHub:schedule:list',
  /** Upsert one scheduled task (matched by id). */
  SAVE: 'agentHub:schedule:save',
  /** Delete a scheduled task by id. */
  DELETE: 'agentHub:schedule:delete'
} as const

/** Local-time daily schedule: run every day at HH:MM. */
export interface ScheduledTask {
  id: string
  /** User-facing name, e.g. 「llm-wiki 知识库更新」. */
  name: string
  agentId: string
  workDir: string
  /** The prompt sent to the agent each run. */
  prompt: string
  /** Local time of day (24h). */
  hour: number
  minute: number
  enabled: boolean
  createdAt: string
  updatedAt: string
  /** ISO timestamp of the last (attempted) run. */
  lastRunAt?: string | null
  /** Outcome of the last run. */
  lastStatus?: 'running' | 'ok' | 'error' | 'cancelled' | null
}

export interface AgentScheduleData {
  version: 1
  tasks: ScheduledTask[]
}

export function createDefaultScheduleData(): AgentScheduleData {
  return { version: 1, tasks: [] }
}

/** Synthetic session id for a scheduled task's runs (its event log key). */
export function scheduleSessionId(taskId: string): string {
  return `sched-${taskId}`
}

/** True when the time-of-day is a valid HH:MM pair. */
export function isValidScheduleTime(hour: unknown, minute: unknown): boolean {
  return (
    typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23 &&
    typeof minute === 'number' && Number.isInteger(minute) && minute >= 0 && minute <= 59
  )
}

/**
 * Whether a task should run at `now`. Due when enabled, the scheduled
 * time has passed (or is exactly now), and it has not already run today —
 * so an app launched later in the day catches up the same day, and at
 * most one run happens per calendar day. Pure — unit tested.
 */
export function isScheduleDue(task: ScheduledTask, now: Date): boolean {
  if (!task.enabled) return false
  if (!isValidScheduleTime(task.hour, task.minute)) return false
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const dueMinutes = task.hour * 60 + task.minute
  if (nowMinutes < dueMinutes) return false
  if (task.lastRunAt) {
    const last = new Date(task.lastRunAt)
    if (!Number.isNaN(last.getTime())) {
      const sameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate()
      if (sameDay) return false
    }
  }
  return true
}

/** Push events for task runs (main → renderer). */
export const TASK_STREAM = {
  /** One structured TaskEvent was produced (persisted + pushed live). */
  EVENT: 'agentHub:task:event',
  /** A run reached a terminal state (finished/error/cancelled). */
  DONE: 'agentHub:task:done'
} as const

/** Structured event types for a session's append-only JSONL log. */
export type TaskEventType =
  | 'run_started'
  | 'user_message'
  | 'assistant_message'
  | 'tool_call'
  | 'tool_result'
  | 'run_finished'
  | 'run_error'
  | 'run_cancelled'

/**
 * One append-only event in a session's structured log
 * (<userData>/agentHub/events/<sessionId>.jsonl). Event-sourced design
 * borrowed from dsh's session log: everything the agent did is replayable.
 */
export interface TaskEvent {
  /** Monotonic per-file sequence number (0-based). */
  seq: number
  /** ISO timestamp. */
  at: string
  type: TaskEventType
  /** Which run produced this event (runs are keyed `run-<base36>`). */
  runId: string
  /** For run_started / run_finished / run_error / run_cancelled. */
  command?: string
  /** assistant_message text. */
  text?: string
  /** user_message prompt. */
  prompt?: string
  /** tool_call name + JSON-stringified input. */
  toolName?: string
  toolInput?: string
  /** tool_result content (may be truncated). */
  toolResult?: string
  /** run_finished: process exit code. */
  exitCode?: number
  /** run_finished: final result text (claude 'result' event). */
  result?: string
  /** run_error message. */
  error?: string
  /** Token usage when the agent reports it (claude result event). */
  usage?: { inputTokens?: number; outputTokens?: number }
}

/** Request payload for starting a structured task run. */
export interface TaskRunRequest {
  sessionId: string
  /** AgentDefinition.command — resolved on the main side. */
  command: string
  /** AgentDefinition.outputMode decides the parsing strategy. */
  outputMode: AgentOutputMode
  /** Optional per-agent args string (same format as PTY launches). */
  args?: string
  workDir: string
  /** The task prompt. */
  prompt: string
  /** Background runs fire an OS notification on completion (v1.24). */
  background?: boolean
}

/** Live/persisted run descriptor (TASK_IPC.LIST + TaskRunDialog state). */
export interface TaskRunInfo {
  runId: string
  sessionId: string
  command: string
  workDir: string
  startedAt: string
  status: 'running' | 'finished' | 'error' | 'cancelled'
  /** exit code when finished. */
  exitCode?: number
  endedAt?: string
}

/** Result of TASK_IPC.RUN. */
export interface TaskRunStartResult {
  ok: boolean
  runId?: string
  error?: string
}

/** One row of a session environment diagnosis (v1.25.3). */
export interface EnvDiagnosisRow {
  label: string
  value: string
  /** null = informational; true/false = check-style pass/fail. */
  ok: boolean | null
}

/** Full diagnosis report for a (command, workDir) session environment. */
export interface EnvDiagnosisResult {
  at: string
  appVersion: string
  rows: EnvDiagnosisRow[]
}

/** Search hit for TASK_IPC.SEARCH. */
export interface SessionSearchHit {
  /** Session id when the hit maps to a saved session, else null. */
  sessionId: string | null
  /** Repo/workDir context for display. */
  workDir: string
  /** ISO timestamp of the matched entry. */
  at: string
  /** Where the hit came from. */
  source: 'prompt' | 'assistant' | 'tool'
  /** Snippet with the match roughly centered (already truncated). */
  snippet: string
  /**
   * The exact history entry id when the hit came from a question history
   * (v1.26.1) — lets the renderer open that repo's history and highlight it.
   */
  entryId?: string
}

/**
 * Build the pre-filled task prompt for a Todo → Agent hand-off (v1.24).
 * Pure function — unit tested in tests/shared/agentHub.test.ts.
 */
export function buildHandoffPrompt(task: { title: string; notes?: string }): string {
  return (
    `请完成以下任务：\n\n${task.title}` +
    (task.notes ? `\n\n任务备注：\n${task.notes}` : '') +
    `\n\n完成后请给出简明总结（做了什么、关键结论与后续建议）。`
  )
}

// ── Agent descriptors ───────────────────────────────────────────────────────

export type AgentOutputMode = 'stream-json' | 'print' | 'generic'

export interface AgentDefinition {
  id: string
  name: string
  icon: string
  command: string
  description: string
  outputMode: AgentOutputMode
  homepage?: string
}

export interface AgentDescriptor extends AgentDefinition {
  detected: boolean
  resolvedPath?: string
  /**
   * Resolved startup args for this agent (from AgentHubConfig.agentArgs[id]).
   * Present only when the user has configured args for this agent. UI display
   * field — the actual launch plumbing reads it from the descriptor.
   */
  args?: string
}

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'claude', name: 'Claude Code', icon: '🤖', command: 'claude',
    description: 'Anthropic 官方 CLI 编程助手',
    outputMode: 'stream-json',
    homepage: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  {
    id: 'codeagent', name: 'codeAgent', icon: '🔮', command: 'codeagent',
    description: 'codeAgent（内部 Claude Code 封装）',
    outputMode: 'print'
  },
  {
    id: 'opencode', name: 'OpenCode', icon: '🔓', command: 'opencode',
    description: '开源终端 AI 编程助手',
    outputMode: 'print',
    homepage: 'https://opencode.ai'
  },
  {
    id: 'hermes', name: 'Hermes', icon: '⚡', command: 'hermes',
    description: 'Hermes CLI 助手',
    outputMode: 'print'
  },
  {
    id: 'nga', name: 'NGA', icon: '🧰', command: 'nga',
    description: 'NGA（内部 opencode 封装）',
    outputMode: 'print'
  },
  {
    // v1.24: DeepSeek's open-source agent harness ("Everything is a Plugin").
    // TUI works in the embedded terminal; task runs use the headless
    // `dsh --profile headless "<task>"` form — users can tailor the profile
    // via per-agent args (e.g. --profile headless).
    id: 'dsh', name: 'DeepSeek Harness', icon: '🐋', command: 'dsh',
    description: 'DeepSeek 官方插件化 agent harness（dsh）',
    outputMode: 'print',
    homepage: 'https://github.com/deepseek-ai/deepseek-harness'
  }
]

// ── Sessions ───────────────────────────────────────────────────────────────

/**
 * Worktree isolation for a session (v1.27): the session's workDir points at
 * a dedicated `git worktree` checkout with its own task branch, so multiple
 * tasks can run in parallel against the same repo without conflicting.
 */
export interface SessionWorktree {
  /** The MAIN repo the worktree belongs to (sidebar groups by this). */
  repoPath: string
  /** Task branch checked out in the worktree, e.g. `task/fix-login`. */
  branch: string
  /** Absolute worktree path — the session's actual workDir. */
  path: string
}

/**
 * A saved agent session — METADATA ONLY. Records which agent to launch in
 * which directory. The actual terminal process is ephemeral.
 */
export interface AgentSession {
  id: string
  title: string
  /**
   * Where the title came from (v1.22):
   *  - 'rule': generated by the NewSessionDialog heuristic (agent · dir).
   *  - 'auto': LLM-generated from the session's first prompt; only replaces
   *            'rule' titles, never a user-edited one.
   *  - 'manual': the user typed/renamed it — auto-titling must not touch it.
   *  - undefined (legacy data): treated as 'manual' (conservative).
   */
  titleKind?: 'rule' | 'auto' | 'manual'
  agentId: string
  workDir: string
  /** Present when the session runs in an isolated git worktree (v1.27). */
  worktree?: SessionWorktree
  createdAt: string
  updatedAt: string
  launchCount: number
  lastLaunchedAt: string | null
}

export interface SessionHistoryEntry {
  id: string
  /** ISO timestamp of the send/paste */
  at: string
  /** The content injected into the terminal */
  content: string
  /** Source: markdown editor send button or manual terminal paste */
  source: 'markdown' | 'paste'
  /** Pinned entries sort to the top of the history dialog (v1.26). */
  pinned?: boolean
}

/**
 * Safety-valve retention for per-repo question history (v1.26.3).
 *
 * Appends are NOT capped — the dialog pages and searches, so display cost
 * doesn't depend on total count. The only real constraint is persistence:
 * histories live in the whole-file agentHub-sessions.json, so unbounded
 * growth would make every save expensive. We therefore prune only beyond
 * this generous threshold, and PINNED entries are always exempt.
 * (Long-term fix — per-repo append-only files — is on the roadmap.)
 */
export const HISTORY_PRUNE_LIMIT = 5000

/**
 * Keep every pinned entry plus the newest non-pinned entries up to
 * HISTORY_PRUNE_LIMIT. Chronological order within each group is preserved.
 * Pure — unit tested.
 */
export function pruneHistoryEntries(entries: SessionHistoryEntry[]): SessionHistoryEntry[] {
  if (entries.length <= HISTORY_PRUNE_LIMIT) return entries
  const pinned = entries.filter((e) => e.pinned === true)
  const rest = entries.filter((e) => e.pinned !== true)
  const keptRest = rest.slice(-HISTORY_PRUNE_LIMIT)
  return [...pinned, ...keptRest]
}

/**
 * Display order for history entries: pinned first, then by recency —
 * newest first within each group. Non-mutating. Pure — unit tested.
 */
export function sortHistoryEntries(entries: SessionHistoryEntry[]): SessionHistoryEntry[] {
  const byTimeDesc = (a: SessionHistoryEntry, b: SessionHistoryEntry): number =>
    b.at.localeCompare(a.at)
  const pinned = entries.filter((e) => e.pinned === true).sort(byTimeDesc)
  const rest = entries.filter((e) => e.pinned !== true).sort(byTimeDesc)
  return [...pinned, ...rest]
}

export interface AgentHubData {
  version: 1
  sessions: AgentSession[]
  lastAgentId?: string
  /** Default agent for quick-launch (e.g. from RepoNav jump). Skips the dialog. */
  defaultAgentId?: string
  /** Per-repo question history (keyed by workDir). Newest last. Survives session deletion. */
  histories: Record<string, SessionHistoryEntry[]>
  updatedAt: string
}

export function createDefaultAgentHubData(): AgentHubData {
  return { version: 1, sessions: [], histories: {}, updatedAt: new Date().toISOString() }
}

// ── Agent Hub configuration (custom agents + per-agent startup args) ─────────

/**
 * Persistent Agent Hub configuration, stored at <userData>/agentHub-config.json
 * (sibling to agentHub-sessions.json).
 *
 * - `customAgents`: user-defined agent definitions that survive restarts.
 * - `agentArgs`: per-agent startup args keyed by agent id. Applies to BOTH
 *   built-in and custom agents. This is the SINGLE source of truth for
 *   "what args does this agent launch with" — resolved into AgentDescriptor
 *   .args at detection time so the renderer never needs to fetch config
 *   separately just to display args.
 *
 * Keeping args in a single map (instead of duplicating them inside each
 * AgentDefinition) avoids orphan entries when a custom agent is deleted:
 * deleting the agent also removes its args entry.
 */
export interface AgentHubConfig {
  version: 1
  /** User-defined custom agents (persisted across restarts). */
  customAgents: AgentDefinition[]
  /**
   * Per-agent startup args keyed by agent id (e.g. { "claude": "--model opus" }).
   * Applied to both built-in and custom agents at detection time.
   */
  agentArgs: Record<string, string>
  /**
   * Recently used work directories, most recent first (v1.28) — quick-pick
   * in the new-session dialog, esp. for plain folders that aren't repos.
   * Deduplicated case-insensitively, capped at 15.
   */
  recentWorkDirs?: string[]
  updatedAt: string
}

export const RECENT_WORK_DIRS_LIMIT = 15

export function createDefaultAgentHubConfig(): AgentHubConfig {
  return { version: 1, customAgents: [], agentArgs: {}, updatedAt: new Date().toISOString() }
}

// ── IPC payload types ──────────────────────────────────────────────────────

export interface LaunchPayload {
  command: string
  workDir: string
}

export interface LaunchResult {
  success: boolean
  method: 'wt' | 'powershell' | 'failed'
  error?: string
}

export interface AgentProbeResult {
  ok: boolean
  output?: string
  resolvedPath?: string
}
