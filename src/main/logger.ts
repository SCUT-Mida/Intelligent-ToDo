/**
 * File-based application logger with automatic date rollover.
 *
 * Writes to <userData>/logs/app-YYYY-MM-DD.log. One file per day, appended.
 * Logs older than MAX_AGE_DAYS are deleted on initialize() to bound disk use.
 *
 * **Date rollover**: tracks the day the current stream was opened for. If
 * the app runs past midnight, the next write() detects the new day and
 * transparently opens a fresh file. `currentLogFilePath()` returns the
 * path of the file we're ACTUALLY writing to (not a dynamic today's date),
 * so the UI's "open log" button always opens a file that exists.
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

/** Get today's date as yyyy-mm-dd (UTC, matching toISOString). */
function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10)
}

class Logger {
  private stream: WriteStream | null = null
  /** The date (yyyy-mm-dd) the current stream is writing to. */
  private streamDay: string = ''

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

  /**
   * The log file path the stream is ACTUALLY writing to.
   * NOT a dynamic today's date — if the app started yesterday and hasn't
   * rolled over yet, this returns yesterday's path (which is the file
   * that exists and has content). This ensures the UI's "open log file"
   * button always opens a file that exists.
   */
  currentLogFilePath(): string {
    const day = this.streamDay || todayDateStr()
    return join(this.logsDir(), `app-${day}.log`)
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

  /**
   * Open a write stream for the given day's log file. Updates streamDay.
   */
  private openStream(day: string = todayDateStr()): void {
    const filePath = join(this.logsDir(), `app-${day}.log`)
    try {
      const stream = createWriteStream(filePath, { flags: 'a', encoding: 'utf-8' })
      stream.on('error', (err) => {
        this.stream = null
        this.streamDay = ''
        try {
          console.error(`[logger] write stream error, logging disabled: ${err.message}`)
        } catch { /* truly nothing more we can do */ }
      })
      this.stream = stream
      this.streamDay = day
    } catch (err) {
      this.stream = null
      this.streamDay = ''
      try {
        console.error(`[logger] could not open stream: ${err instanceof Error ? err.message : String(err)}`)
      } catch { /* ignore */ }
    }
  }

  private write(level: 'INFO' | 'WARN' | 'ERROR', scope: string, msg: string, meta?: unknown): void {
    // Check for date rollover before writing. If the app has been running
    // past midnight, close the old stream and open today's file.
    const today = todayDateStr()
    if (this.streamDay && this.streamDay !== today) {
      const oldDay = this.streamDay
      this.openStream(today)
      // Log the rollover itself into the NEW file
      const rolloverMsg = `${new Date().toISOString()} [INFO] [logger        ] date rollover: ${oldDay} → ${today}\n`
      try { this.stream?.write(rolloverMsg) } catch { /* ignore */ }
    }

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
