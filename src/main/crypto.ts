/**
 * API key encryption/decryption using OS-level safe storage.
 *
 * Extracted from src/main/index.ts into a reusable module.
 * Uses Electron's `safeStorage` (DPAPI on Windows) to encrypt API keys
 * before persisting to disk, and decrypt on read.
 */

import { safeStorage } from 'electron'

export const ENC_PREFIX = 'enc:'

/** Encrypt an API key using OS-level safe storage (DPAPI on Windows). */
export function encryptApiKey(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plain)
      return ENC_PREFIX + buf.toString('base64')
    }
  } catch (err) {
    console.error('safeStorage encrypt failed, falling back to plaintext:', err)
  }
  return plain
}

/** Decrypt an API key. Handles both encrypted ('enc:' prefixed) and legacy plaintext. */
export function decryptApiKey(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
      return safeStorage.decryptString(buf)
    } catch (err) {
      console.error('safeStorage decrypt failed:', err)
      return ''
    }
  }
  return stored
}
