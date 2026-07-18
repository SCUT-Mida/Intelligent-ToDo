/**
 * File-based application logger.
 *
 * Writes to <userData>/logs/app-YYYY-MM-DD.log. One file per day, appended.
 * Logs older than MAX_AGE_DAYS are deleted on initialize() to bound disk use.
 *
 * All levels are also mirrored to console.log/warn/error so dev mode still
 * shows them in the terminal.
 *
 * Usage:
 *   import { logger } from './logger'
 *   logger.info('scope', 'message', { optional: 'meta object' })
 *
 * Format: `<ISO timestamp> [<LEVEL>] [<scope-padded>] message {meta-json}`
 */

import { app } from 'electron'
import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync, unlinkSync, WriteStream } from 'fs'
import { join } from 'path'

const MAX_AGE_DAYS = 7
const SCOPE_MAX_LEN = 14

class Logger {
  private stream: WriteStream | null = null

  /**
   * Open the log file for today and clean up old logs.
   * Must be called AFTER app.whenReady() (uses app.getPath('userData')).
   */
  initialize(): void {
    const dir = this.logsDir()
    if (!existsSync(dir)) {
      try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
    }
    this.cleanupOldLogs(dir)
    this.openStream()
  }

  /** Directory where log files live. */
  logsDir(): string {
    return join(app.getPath('userData'), 'logs')
  }

  /** Today's log file path (for display in the UI). */
  currentLogFilePath(): string {
    const today = new Date().toISOString().slice(0, 10)
    return join(this.logsDir(), `app-${today}.log`)
  }

  /** Remove logs older than MAX_AGE_DAYS. Best-effort, never throws. */
  private cleanupOldLogs(dir: string): void {
    try {
      const cutoff = Date.now() - MAX_AGE_DAYS * 86400000
      for (const file of readdirSync(dir)) {
        if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(file)) continue
        const fullPath = join(dir, file)
        try {
          if (statSync(fullPath).mtimeMs < cutoff) {
            unlinkSync(fullPath)
          }
        } catch { /* ignore individual file errors */ }
      }
    } catch { /* ignore readdir errors */ }
  }

  private openStream(): void {
    try {
      const stream = createWriteStream(this.currentLogFilePath(), { flags: 'a', encoding: 'utf-8' })
      // CRITICAL: WriteStream emits async 'error' events on write failures
      // (file lock, permission change, disk full, etc.). Without a listener,
      // Node.js will treat this as an unhandled exception and kill the process.
      // We attach a no-op-ish listener that just mirrors to console — never
      // re-throws. This makes logging best-effort: failures degrade silently
      // rather than crashing the app.
      stream.on('error', (err) => {
        // Mark logger as disabled so future write() calls short-circuit.
        this.stream = null
        try {
          console.error(`[logger] write stream error, logging disabled: ${err.message}`)
        } catch { /* truly nothing more we can do */ }
      })
      this.stream = stream
    } catch (err) {
      // Synchronous creation failure (e.g. invalid path) — logging disabled.
      this.stream = null
      try {
        console.error(`[logger] could not open stream: ${err instanceof Error ? err.message : String(err)}`)
      } catch { /* ignore */ }
    }
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', scope: string, msg: string, meta?: unknown): void {
    if (!this.stream) return
    const ts = new Date().toISOString()
    const scopePadded = scope.slice(0, SCOPE_MAX_LEN).padEnd(SCOPE_MAX_LEN)
    const metaStr = meta !== undefined ? ' ' + safeStringify(meta) : ''
    const line = `${ts} [${level}] [${scopePadded}] ${msg}${metaStr}\n`
    try {
      this.stream.write(line)
    } catch { /* swallow */ }
    // Mirror to console for dev visibility
    if (level === 'ERROR') console.error(line.trimEnd())
    else if (level === 'WARN') console.warn(line.trimEnd())
    else console.log(line.trimEnd())
  }

  info(scope: string, msg: string, meta?: unknown): void { this.write('INFO', scope, msg, meta) }
  warn(scope: string, msg: string, meta?: unknown): void { this.write('WARN', scope, msg, meta) }
  error(scope: string, msg: string, meta?: unknown): void { this.write('ERROR', scope, msg, meta) }
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack })
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = new Logger()
