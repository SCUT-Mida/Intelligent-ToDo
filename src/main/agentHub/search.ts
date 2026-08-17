/**
 * Cross-session search (v1.23) — local substring search over everything
 * users typed or agents produced:
 *   - question histories (AgentHubData.histories, keyed by workDir)
 *   - structured event logs (events/<sessionId>.jsonl)
 *
 * Purely local (no LLM — v1.11.5 removed semantic search for good reason);
 * results are snippets with the match roughly centered.
 */

import type { AgentHubData, SessionSearchHit, TaskEvent } from '../../shared/agentHub'
import { listEventLogSessions, loadSessionEvents } from './eventLog'

const SNIPPET_RADIUS = 60
const MAX_HITS = 50

/** Build a display snippet with the first match roughly centered. */
export function buildSnippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return truncateOneLine(text, SNIPPET_RADIUS * 2)
  const start = Math.max(0, idx - SNIPPET_RADIUS)
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS)
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < text.length ? '…' : '')
  )
}

function truncateOneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : flat.slice(0, max) + '…'
}

function eventSearchText(e: TaskEvent): string | null {
  if (e.type === 'user_message') return e.prompt ?? null
  if (e.type === 'assistant_message') return e.text ?? null
  if (e.type === 'tool_call') return e.toolName ?? null
  return null
}

function eventSource(e: TaskEvent): 'prompt' | 'assistant' | 'tool' | null {
  if (e.type === 'user_message') return 'prompt'
  if (e.type === 'assistant_message') return 'assistant'
  if (e.type === 'tool_call') return 'tool'
  return null
}

/**
 * Search sessions. Histories are searched first (they exist for every
 * session that ever sent a prompt), then event logs. Results are capped
 * at MAX_HITS; empty/whitespace queries return [].
 */
export function searchSessions(query: string, data: AgentHubData): SessionSearchHit[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const hits: SessionSearchHit[] = []

  // workDir → session ids (titles resolve in the renderer).
  const byWorkDir = new Map<string, string[]>()
  for (const s of data.sessions) {
    byWorkDir.set(s.workDir, [...(byWorkDir.get(s.workDir) ?? []), s.id])
  }

  // 1. Question histories.
  for (const [workDir, entries] of Object.entries(data.histories ?? {})) {
    for (const entry of entries) {
      if (!entry.content.toLowerCase().includes(q)) continue
      hits.push({
        sessionId: byWorkDir.get(workDir)?.[0] ?? null,
        workDir,
        at: entry.at,
        source: 'prompt',
        snippet: buildSnippet(entry.content, query.trim())
      })
      if (hits.length >= MAX_HITS) return hits
    }
  }

  // 2. Event logs.
  for (const sessionId of listEventLogSessions()) {
    const events = loadSessionEvents(sessionId)
    const session = data.sessions.find((s) => s.id === sessionId)
    const workDir = session?.workDir ?? ''
    for (const e of events) {
      const source = eventSource(e)
      const text = eventSearchText(e)
      if (!source || !text || !text.toLowerCase().includes(q)) continue
      hits.push({
        sessionId,
        workDir,
        at: e.at,
        source,
        snippet: buildSnippet(text, query.trim())
      })
      if (hits.length >= MAX_HITS) return hits
    }
  }

  return hits
}
