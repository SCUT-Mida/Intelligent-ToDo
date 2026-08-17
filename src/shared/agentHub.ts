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
   CLIPBOARD_WRITE: 'agentHub:clipboardWrite'
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
  updatedAt: string
}

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
