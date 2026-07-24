/**
 * Module-level scan state manager.
 *
 * Keeps scan progress alive across component mount/unmount cycles.
 * When the user switches from RepoNav to Todo and back, the scan
 * continues running in the main process — this module ensures the
 * renderer still tracks its progress and result.
 *
 * Usage:
 *   initScanManager()  // call once at app startup
 *   const { scanState, startScan } = useScanManager()  // in RepoNavView
 */

import { useState, useEffect, useCallback } from 'react'

export interface ScanState {
  isScanning: boolean
  progress: { current: number; total: number; name: string } | null
}

// ── Module-level state (survives component unmount) ────────────────────────

let scanState: ScanState = { isScanning: false, progress: null }
const listeners = new Set<(state: ScanState) => void>()
let initialized = false

function notifyAll(): void {
  for (const fn of listeners) {
    try { fn(scanState) } catch { /* ignore listener errors */ }
  }
}

/**
 * Initialize the scan manager — subscribes to IPC progress events.
 * Call ONCE at app startup (e.g., in main.tsx or AppShell).
 * Safe to call multiple times (idempotent).
 */
export function initScanManager(): void {
  if (initialized) return
  initialized = true

  // Subscribe to scan progress events from the main process.
  // This subscription lives at module level, NOT tied to any component,
  // so it survives RepoNavView unmount/remount.
  window.repoNav.onScanProgress((p) => {
    scanState = { isScanning: true, progress: p }
    notifyAll()
  })
}

/**
 * Start a scan. Returns a promise that resolves when the scan completes,
 * but the scan ALSO runs independently of the caller — even if the caller
 * unmounts, the scan continues and updates module-level state.
 *
 * Prevents concurrent scans: if a scan is already running, returns immediately.
 */
export async function startScan(): Promise<boolean> {
  if (scanState.isScanning) return false // already scanning

  scanState = { isScanning: true, progress: { current: 0, total: 0, name: '正在发现仓库...' } }
  notifyAll()

  try {
    await window.repoNav.scan()
    return true
  } finally {
    scanState = { isScanning: false, progress: null }
    notifyAll()
  }
}

function getScanState(): ScanState {
  return scanState
}

function subscribe(fn: (state: ScanState) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── React hook ─────────────────────────────────────────────────────────────

/**
 * React hook that tracks scan state. Survives component unmount/remount
 * because the underlying state is module-level.
 *
 * Returns:
 *   - scanState: current { isScanning, progress }
 *   - startScan: function to trigger a new scan (prevents duplicates)
 */
export function useScanManager(): {
  scanState: ScanState
  startScan: () => Promise<boolean>
} {
  const [state, setState] = useState<ScanState>(getScanState())

  useEffect(() => {
    return subscribe(setState)
  }, [])

  const triggerScan = useCallback(async (): Promise<boolean> => {
    return startScan()
  }, [])

  return { scanState: state, startScan: triggerScan }
}
