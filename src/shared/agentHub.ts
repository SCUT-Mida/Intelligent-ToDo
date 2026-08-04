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
