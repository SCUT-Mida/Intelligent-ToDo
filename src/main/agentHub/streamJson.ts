/**
 * Claude Code `--output-format stream-json` line parser.
 *
 * Claude Code in `-p` (print) mode with `--output-format stream-json`
 * emits one JSON object per line on stdout:
 *
 *   {"type":"system","subtype":"init",...}                       — run metadata
 *   {"type":"assistant","message":{"role":"assistant",
 *     "content":[{"type":"text","text":"..."},
 *                {"type":"tool_use","id":"...","name":"Bash",
 *                 "input":{...}]}}                                — model turn
 *   {"type":"user","message":{"content":[
 *     {"type":"tool_result","tool_use_id":"...","content":"..."}]}} — tool output
 *   {"type":"result","subtype":"success","result":"...",          — final
 *    "usage":{"input_tokens":n,"output_tokens":m}}
 *
 * The parser is DEFENSIVE by design: unknown types / shapes are ignored so
 * a CLI upgrade that adds event kinds degrades gracefully (worst case the
 * timeline misses a row; the terminal experience is unaffected).
 *
 * Pure functions — unit tested in tests/main/agentHub/streamJson.test.ts.
 */

import type { TaskEventType } from '../../shared/agentHub'

/** A parsed event ready to be wrapped into a TaskEvent by the runner. */
export interface ParsedStreamEvent {
  type: TaskEventType
  text?: string
  toolName?: string
  toolInput?: string
  toolResult?: string
  result?: string
  error?: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

interface StreamLine {
  type?: unknown
  subtype?: unknown
  message?: unknown
  result?: unknown
  usage?: unknown
  is_error?: unknown
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function contentBlocks(message: unknown): Record<string, unknown>[] {
  if (!isRecord(message)) return []
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return []
  return content.filter(isRecord)
}

/** Parse one stdout line; returns null for blank/uninteresting lines. */
export function parseStreamJsonLine(line: string): ParsedStreamEvent | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) return null // tolerate banners/noise
  let parsed: StreamLine
  try {
    parsed = JSON.parse(trimmed) as StreamLine
  } catch {
    return null // torn or non-JSON line — ignore
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null

  if (parsed.type === 'assistant') {
    const blocks = contentBlocks(parsed.message)
    for (const block of blocks) {
      if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text']) {
        return { type: 'assistant_message', text: block['text'] }
      }
      if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
        return {
          type: 'tool_call',
          toolName: block['name'],
          toolInput: safeJsonStringify(block['input'])
        }
      }
    }
    return null
  }

  if (parsed.type === 'user') {
    const blocks = contentBlocks(parsed.message)
    for (const block of blocks) {
      if (block['type'] === 'tool_result') {
        return { type: 'tool_result', toolResult: truncate(String(block['content'] ?? ''), 8000) }
      }
    }
    return null
  }

  if (parsed.type === 'result') {
    const usage = isRecord(parsed.usage)
      ? {
          inputTokens: numberOrUndef((parsed.usage as { input_tokens?: unknown }).input_tokens),
          outputTokens: numberOrUndef((parsed.usage as { output_tokens?: unknown }).output_tokens)
        }
      : undefined
    const isError = parsed.is_error === true
    return {
      type: isError ? 'run_error' : 'run_finished',
      result: typeof parsed.result === 'string' ? truncate(parsed.result, 20000) : undefined,
      usage:
        usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined)
          ? usage
          : undefined,
      error: isError && typeof parsed.result === 'string' ? truncate(parsed.result, 2000) : undefined
    }
  }

  // 'system' init lines and any future types: not timeline-worthy.
  return null
}

function safeJsonStringify(v: unknown): string | undefined {
  if (v === undefined) return undefined
  try {
    return truncate(JSON.stringify(v), 4000)
  } catch {
    return undefined
  }
}

function numberOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…[truncated]'
}

/** Build the argv for a one-shot structured run of the given agent shape. */
export function buildTaskArgv(
  outputMode: 'stream-json' | 'print' | 'generic',
  prompt: string,
  userArgs: string[]
): string[] {
  if (outputMode === 'stream-json') {
    // Drop user-arg flags that would conflict with our one-shot invocation
    // (-p/--print and --output-format), skipping their VALUE tokens too —
    // a bare filter would leave orphaned values like 'opus' behind.
    const conflicts = ['-p', '--print', '--output-format']
    const filtered: string[] = []
    for (let i = 0; i < userArgs.length; i++) {
      const a = userArgs[i]
      if (conflicts.includes(a)) {
        if (!a.includes('=')) i++ // skip the flag's value token
        continue
      }
      if (a.startsWith('--output-format=')) continue
      filtered.push(a)
    }
    // Claude Code one-shot mode. --verbose is REQUIRED by Claude Code for
    // stream-json output in -p mode (it gates the intermediate events).
    return [...filtered, '-p', prompt, '--output-format', 'stream-json', '--verbose']
  }
  // print / generic: prompt as the trailing positional argument (works for
  // dsh headless `dsh --profile headless "<task>"`-style CLIs; users can
  // tailor behavior via per-agent args).
  return [...userArgs, prompt]
}
