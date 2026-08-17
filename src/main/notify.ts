/**
 * Main-process notification bus (v1.24).
 *
 * Feature modules (taskRunner, …) fire user-facing notifications through
 * this EventEmitter instead of touching Tray/Notification directly — keeps
 * them decoupled from window/tray lifecycle and testable. src/main/index.ts
 * owns the actual OS surfaces:
 *   - Electron Notification (click focuses the main window) when supported
 *   - tray.displayBalloon fallback on Windows (the existing one-shot balloon
 *     guard does NOT apply here — completion notices are per-event)
 */

import { EventEmitter } from 'events'

export interface AppNotification {
  title: string
  body: string
  /** Optional routing hint shown to the user when they click through. */
  kind: 'task-done' | 'task-error' | 'info'
}

class NotificationBus extends EventEmitter {
  fire(n: AppNotification): void {
    this.emit('notify', n)
  }
}

export const notifyBus = new NotificationBus()
notifyBus.setMaxListeners(20)
