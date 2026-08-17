/**
 * Append-only JSONL event log for AgentHub sessions.
 *
 * Event-sourced session persistence (design borrowed from dsh's session
 * log + PersistenceCoordinator):
 *  - writes are appends (one JSON line per TaskEvent) — cheap and crash-safe
 *  - reads tolerate a torn tail: a crash mid-append can leave a partial
 *    final line; on load we keep every complete line and TRUNCATE the file
 *    back to the last good line so the corruption doesn't accumulate.
 *
 * Files live at <userData>/agentHub/events/<sessionId>.jsonl.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, appendFileSync, truncateSync, readdirSync } from 'fs'
import type { TaskEvent } from '../../shared/agentHub'
import { logger } from '../logger'

function eventsDir(): string {
  return join(app.getPath('userData'), 'agentHub', 'events')
}

export function eventLogPath(sessionId: string): string {
  // Session ids are app-generated (`sess-<base36>`); scrub separators /
  // traversal just in case a corrupted sessions file ever feeds junk in.
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(eventsDir(), `${safe}.jsonl`)
}

/**
 * Parse one JSONL file body into events. Returns the events plus the byte
 * offset of the end of the last complete line (for torn-tail truncation).
 * Exported for unit tests — pure function.
 */
export function parseEventLogBody(body: string): {
  events: TaskEvent[]
  goodLength: number
  badLines: number
} {
  const events: TaskEvent[] = []
  let goodLength = 0
  let badLines = 0
  const lines = body.split('\n')
  // The final array element after split is '' for a well-formed file that
  // ends with '\n' — nothing to do there. A non-empty final element means
  // a torn (partial) last line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (i === lines.length - 1 && line === '') break
    if (line === '') {
      // Interior empty line — skip but keep counting offsets.
      goodLength += 1
      continue
    }
    try {
      const parsed = JSON.parse(line) as TaskEvent
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string') {
        events.push(parsed)
        goodLength += line.length + 1
      } else {
        throw new Error('missing type field')
      }
    } catch {
      // Bad line: stop counting further bytes as good — everything from
      // here on is suspect (torn tail). Keep events parsed so far.
      badLines = lines.length - i
      break
    }
  }
  return { events, goodLength, badLines }
}

/**
 * Load a session's events from disk. Truncates a torn tail in place
 * (crash mid-append) and logs when that happens.
 */
export function loadSessionEvents(sessionId: string): TaskEvent[] {
  const path = eventLogPath(sessionId)
  try {
    if (!existsSync(path)) return []
    const body = readFileSync(path, 'utf-8')
    const { events, goodLength, badLines } = parseEventLogBody(body)
    if (badLines > 0 && goodLength < body.length) {
      logger.warn('agentHub:events', 'torn tail truncated', {
        sessionId,
        goodBytes: goodLength,
        totalBytes: body.length
      })
      try {
        truncateSync(path, Buffer.byteLength(body.slice(0, goodLength), 'utf-8'))
      } catch (err) {
        logger.warn('agentHub:events', 'failed to truncate torn tail', {
          sessionId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return events
  } catch (err) {
    logger.warn('agentHub:events', 'failed to load event log', {
      sessionId,
      error: err instanceof Error ? err.message : String(err)
    })
    return []
  }
}

/** Append one event to a session's log. Never throws (logs on failure). */
export function appendSessionEvent(sessionId: string, event: TaskEvent): void {
  try {
    const path = eventLogPath(sessionId)
    const dir = join(path, '..')
    if (!existsSync(dir)) {
      // mkdirSync imported lazily-style to keep the hot path simple.
      const { mkdirSync } = require('fs') as typeof import('fs')
      mkdirSync(dir, { recursive: true })
    }
    appendFileSync(path, JSON.stringify(event) + '\n', 'utf-8')
  } catch (err) {
    logger.warn('agentHub:events', 'failed to append event', {
      sessionId,
      type: event.type,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/** Next monotonic seq for a session (max existing seq + 1). */
export function nextSeqFor(sessionId: string): number {
  const events = loadSessionEvents(sessionId)
  return events.length > 0 ? (events[events.length - 1].seq ?? events.length - 1) + 1 : 0
}

/** All session ids that have an event log on disk (for search). */
export function listEventLogSessions(): string[] {
  try {
    const dir = eventsDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.slice(0, -'.jsonl'.length))
  } catch {
    return []
  }
}
