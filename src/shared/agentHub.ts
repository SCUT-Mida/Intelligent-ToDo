/**
 * Agent Hub — unified CLI agent integration types & IPC channels.
 *
 * This feature lets non-developers chat with CLI-based AI coding agents
 * (Claude Code, Gemini CLI, Codex, Aider, etc.) through a friendly UI
 * with session management, streaming output, and raw log inspection.
 *
 * Architecture:
 *   renderer ──IPC──▶ main/agentHub/manager ──spawn──▶ CLI agent process
 *                          │
 *                          └──stream events──▶ renderer (live updates)
 *
 * Each user message spawns the agent in print/non-interactive mode with the
 * prompt as an argument. stdout is streamed back as text chunks. For agents
 * that support it (claude), --resume maintains conversation context across
 * one-shot invocations — giving the UX of a persistent session without the
 * fragility of parsing TUI ANSI escape codes.
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
   * Send a user message: spawns the agent (print mode) with the prompt,
   * streams stdout back via AGENT_STREAM events. Returns the new assistant
   * message id so the renderer can track streaming chunks.
   */
  SEND_MESSAGE: 'agentHub:sendMessage',
  /** Kill the currently-running agent process for a session. */
  STOP_SESSION: 'agentHub:stopSession',
  /** Show OS folder picker; returns selected path or null. */
  PICK_DIRECTORY: 'agentHub:pickDirectory',
  /** Probe a custom agent command (--version style). */
  PROBE_AGENT: 'agentHub:probeAgent'
} as const

// ── Streaming event channels (main → renderer, push via webContents.send) ───

export const AGENT_STREAM = {
  /** A text chunk arrived on stdout — append to the assistant message. */
  CHUNK: 'agentHub:stream:chunk',
  /** A tool-use event was parsed from agent output. */
  TOOL: 'agentHub:stream:tool',
  /** Session running status changed (idle/running/error). */
  STATUS: 'agentHub:stream:status',
  /** The agent process exited. */
  EXIT: 'agentHub:stream:exit',
  /** A text chunk arrived on stderr (shown in the log panel). */
  ERROR: 'agentHub:stream:error'
} as const

// ── Agent descriptors ───────────────────────────────────────────────────────

/**
 * How an agent produces output. Determines how we invoke it and parse results.
 *
 * - stream-json: agent emits newline-delimited JSON events (best — we can
 *   extract text, tool calls, and session IDs). Only claude-code currently.
 * - print: agent runs non-interactively and prints plain text to stdout.
 *   We stream it verbatim. Works for most agents' `-p` / `--print` modes.
 * - generic: we invoke `<command> <prompt>` and capture whatever stdout
 *   produces. Last-resort fallback for unknown agents.
 */
export type AgentOutputMode = 'stream-json' | 'print' | 'generic'

/**
 * Built-in agent definition. The `command` + `printArgs` describe how to
 * invoke the agent in non-interactive mode. `{PROMPT}` in printArgs is
 * replaced with the user's message; `{SESSION}` with the native session id.
 */
export interface AgentDefinition {
  /** Stable id, e.g. 'claude'. */
  id: string
  /** Display name, e.g. 'Claude Code'. */
  name: string
  /** Emoji icon. */
  icon: string
  /** Executable name or absolute path, e.g. 'claude'. */
  command: string
  /** One-line description for the agent picker. */
  description: string
  /** How output is produced and parsed. */
  outputMode: AgentOutputMode
  /**
   * Argument template for non-interactive invocation. `{PROMPT}` is replaced
   * with the user's message (shell-safe). `{SESSION}` is replaced with a
   * previously-obtained native session id for resume-capable agents.
   * Example for claude: ['-p', '{PROMPT}', '--output-format', 'stream-json', '--verbose']
   */
  printArgs: string[]
  /**
   * If true, the agent supports `--resume <id>` style session continuation.
   * The native session id is extracted from the agent's output and stored
   * on AgentSession.nativeSessionId for subsequent messages.
   */
  resumeCapable: boolean
  /** Optional URL to the agent's homepage / install docs. */
  homepage?: string
}

/**
 * An agent as seen by the renderer: the definition plus live detection info.
 */
export interface AgentDescriptor extends AgentDefinition {
  /** True if the executable was found on this machine. */
  detected: boolean
  /** Resolved absolute path if detected. */
  resolvedPath?: string
}

/**
 * Registry of built-in agents. Users pick from these (or use a generic custom
 * entry). Detection at runtime determines which are actually available.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    icon: '🤖',
    command: 'claude',
    description: 'Anthropic 官方 CLI 编程助手，支持流式 JSON 输出与会话恢复',
    outputMode: 'stream-json',
    printArgs: ['-p', '{PROMPT}', '--output-format', 'stream-json', '--verbose'],
    resumeCapable: true,
    homepage: 'https://docs.anthropic.com/en/docs/claude-code'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    icon: '💎',
    command: 'gemini',
    description: 'Google Gemini 命令行助手',
    outputMode: 'print',
    printArgs: ['--prompt', '{PROMPT}'],
    resumeCapable: false,
    homepage: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: '🧬',
    command: 'codex',
    description: 'OpenAI Codex 命令行编程助手',
    outputMode: 'print',
    printArgs: ['{PROMPT}'],
    resumeCapable: false,
    homepage: 'https://github.com/openai/codex'
  },
  {
    id: 'aider',
    name: 'Aider',
    icon: '✏️',
    command: 'aider',
    description: '开源 AI pair programmer，支持多种模型',
    outputMode: 'print',
    printArgs: ['--message', '{PROMPT}', '--no-auto-commits', '--no-check-update'],
    resumeCapable: false,
    homepage: 'https://aider.chat'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    icon: '🔓',
    command: 'opencode',
    description: '开源终端 AI 编程助手',
    outputMode: 'print',
    printArgs: ['{PROMPT}'],
    resumeCapable: false,
    homepage: 'https://opencode.ai'
  }
]

// ── Chat messages ──────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system'

/** A tool invocation extracted from agent streaming output (for rich display). */
export interface ToolCall {
  /** Tool name, e.g. 'Bash', 'Read', 'Edit'. */
  name: string
  /** Short input summary (truncated for display). */
  input?: string
  /** Tool result (truncated). */
  output?: string
  /** Lifecycle state. */
  status?: 'running' | 'success' | 'error'
}

/** A single chat message in a session. */
export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  /** ISO timestamp. */
  timestamp: string
  /** Tool calls parsed from agent output (assistant messages only). */
  toolCalls?: ToolCall[]
  /** True while an assistant message is actively receiving stream chunks. */
  streaming?: boolean
  /** Present when the message represents an error (shown with error styling). */
  error?: string
  /** Token/char count for display (optional, filled after stream completes). */
  tokenCount?: number
}

// ── Sessions ───────────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'running' | 'error' | 'stopped'

/** A conversation session with a CLI agent. */
export interface AgentSession {
  /** Unique id (uuid or timestamp-based). */
  id: string
  /** User-facing title. Auto-generated from first message, editable. */
  title: string
  /** References AgentDescriptor.id — which agent this session uses. */
  agentId: string
  /** Working directory passed to the agent as cwd. */
  workDir: string
  /** ISO timestamp — creation. */
  createdAt: string
  /** ISO timestamp — last activity. */
  updatedAt: string
  /** Ordered conversation messages. */
  messages: ChatMessage[]
  /** Current running status. */
  status: SessionStatus
  /**
   * Native session id for resume-capable agents (e.g. claude's session_id).
   * Extracted from the first response, reused in subsequent --resume calls.
   */
  nativeSessionId?: string
}

/** Persisted agent-hub data file (agentHub-sessions.json in userData). */
export interface AgentHubData {
  version: 1
  sessions: AgentSession[]
  /** Last-selected agent id (restored on next launch for convenience). */
  lastAgentId?: string
  /** ISO timestamp — last save. */
  updatedAt: string
}

/** Factory for empty agent-hub data (first launch / corruption recovery). */
export function createDefaultAgentHubData(): AgentHubData {
  return {
    version: 1,
    sessions: [],
    updatedAt: new Date().toISOString()
  }
}

// ── IPC payload types ──────────────────────────────────────────────────────

/** Payload for AGENT_IPC.SEND_MESSAGE. */
export interface SendMessageResult {
  /** The new assistant message id (streaming chunks reference this). */
  messageId: string
  /** Native session id if the agent provided one (for resume). */
  nativeSessionId?: string
}

/** Payload for AGENT_STREAM.CHUNK. */
export interface StreamChunkPayload {
  sessionId: string
  /** The assistant message id being streamed. */
  messageId: string
  /** Text to append. */
  text: string
}

/** Payload for AGENT_STREAM.TOOL. */
export interface StreamToolPayload {
  sessionId: string
  messageId: string
  tool: ToolCall
}

/** Payload for AGENT_STREAM.STATUS. */
export interface StreamStatusPayload {
  sessionId: string
  status: SessionStatus
}

/** Payload for AGENT_STREAM.EXIT. */
export interface StreamExitPayload {
  sessionId: string
  /** OS exit code, or null if killed. */
  code: number | null
  /** The assistant message id that just finished streaming. */
  messageId?: string
  /** Native session id extracted before exit (for resume). */
  nativeSessionId?: string
}

/** Payload for AGENT_STREAM.ERROR. */
export interface StreamErrorPayload {
  sessionId: string
  messageId?: string
  text: string
}

/** Result of probing a custom agent command. */
export interface AgentProbeResult {
  ok: boolean
  output?: string
  resolvedPath?: string
}
