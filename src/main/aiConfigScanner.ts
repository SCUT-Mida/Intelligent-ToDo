/**
 * Scanner for external AI tool config files.
 *
 * Currently supports: opencode.json (~/.config/opencode/opencode.json).
 *
 * The scanner is read-only and best-effort — missing files, parse errors,
 * and shape mismatches are collected into the result.errors array rather
 * than thrown. The renderer decides how to surface them.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AiConfigScanResult, AiProviderConfig, AiProviderModel } from '../shared/aiConfig'
import { KNOWN_OPENCODE_PROVIDERS } from '../shared/aiConfig'

// ── Path resolution ─────────────────────────────────────────────────────────

/**
 * Candidate locations for opencode.json, in priority order.
 * The first existing file wins.
 */
function resolveOpencodePaths(): string[] {
  const home = homedir()
  return [
    join(home, '.config', 'opencode', 'opencode.json'),
    join(home, '.config', 'opencode', 'opencode.jsonc'),
    join(home, '.opencode', 'opencode.json')
  ]
}

// ── opencode.json parsing ───────────────────────────────────────────────────

/**
 * Minimal shape of the parts of opencode.json we care about.
 * We intentionally keep this permissive (everything optional) so future
 * schema additions don't break us.
 */
interface OpencodeProvider {
  options?: {
    apiKey?: unknown
    baseURL?: unknown
  }
  models?: Record<string, { name?: unknown }>
  /** Custom providers often include this; informational only. */
  npm?: unknown
}

interface OpencodeJson {
  provider?: Record<string, OpencodeProvider>
  /** Currently selected model in the form '<providerId>/<modelId>'. */
  model?: unknown
  /** Currently selected small/fast model. */
  small_model?: unknown
}

/**
 * Strip JSONC line comments (// ...) and trailing commas — opencode.jsonc
 * support. Conservative: only strips // comments outside of strings.
 */
function stripJsonC(content: string): string {
  let out = ''
  let i = 0
  let inString = false
  while (i < content.length) {
    const ch = content[i]
    const next = content[i + 1]
    // Handle string literals (don't strip // inside strings)
    if (ch === '"') {
      // Toggle string state unless escaped
      if (i === 0 || content[i - 1] !== '\\') inString = !inString
      out += ch
      i++
      continue
    }
    if (!inString && ch === '/' && next === '/') {
      // Skip to end of line
      while (i < content.length && content[i] !== '\n') i++
      continue
    }
    out += ch
    i++
  }
  // Remove trailing commas that would break JSON.parse
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Parse opencode.json (or .jsonc) and extract providers + models.
 * Returns the parsed object or null on failure.
 */
function parseOpencodeJson(filePath: string): OpencodeJson | null {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const isJsonc = filePath.toLowerCase().endsWith('.jsonc')
    const cleaned = isJsonc ? stripJsonC(raw) : raw
    return JSON.parse(cleaned) as OpencodeJson
  } catch {
    return null
  }
}

/**
 * Convert a provider entry from opencode.json into our standardized shape.
 */
function buildProviderConfig(
  providerId: string,
  raw: OpencodeProvider
): AiProviderConfig | null {
  const apiKey = typeof raw.options?.apiKey === 'string' ? raw.options.apiKey : ''
  if (!apiKey) return null // Skip providers without auth — nothing useful to import

  // Resolve baseURL: explicit > known-table > undefined
  const explicitBaseURL = typeof raw.options?.baseURL === 'string' ? raw.options.baseURL : undefined
  const knownEntry = KNOWN_OPENCODE_PROVIDERS[providerId]
  const baseURL = explicitBaseURL ?? knownEntry?.url
  const baseURLInferred = !explicitBaseURL && !!knownEntry

  // Build model list from the provider's `models` field
  const models: AiProviderModel[] = []
  if (raw.models && typeof raw.models === 'object') {
    for (const [modelId, def] of Object.entries(raw.models)) {
      const displayName = def && typeof def === 'object' && 'name' in def && typeof def.name === 'string'
        ? def.name
        : undefined
      models.push({ modelId, displayName })
    }
  }

  return {
    source: 'opencode',
    providerId,
    displayName: knownEntry?.name ?? providerId,
    apiKey,
    baseURL,
    baseURLInferred,
    models
  }
}

/**
 * Top-level opencode `model` / `small_model` fields use the form
 * '<providerId>/<modelId>'. Add these to the relevant provider's model list
 * if not already present.
 */
function injectSelectedModels(providers: AiProviderConfig[], parsed: OpencodeJson): void {
  for (const topField of [parsed.model, parsed.small_model]) {
    if (typeof topField !== 'string') continue
    const slashIdx = topField.indexOf('/')
    if (slashIdx <= 0) continue
    const providerId = topField.slice(0, slashIdx)
    const modelId = topField.slice(slashIdx + 1)
    if (!modelId) continue

    const provider = providers.find((p) => p.providerId === providerId)
    if (!provider) continue
    if (provider.models.some((m) => m.modelId === modelId)) continue
    provider.models.push({ modelId })
  }
}

/**
 * Scan opencode config files and return discovered providers.
 */
function scanOpencode(result: AiConfigScanResult): void {
  const candidates = resolveOpencodePaths()
  const found = candidates.find((p) => existsSync(p))
  if (!found) {
    result.errors.push(`opencode 配置未找到（已查找：${candidates.join('；')}）`)
    return
  }
  result.scannedPaths.push(found)

  const parsed = parseOpencodeJson(found)
  if (!parsed) {
    result.errors.push(`opencode 配置解析失败：${found}`)
    return
  }

  if (!parsed.provider || typeof parsed.provider !== 'object') {
    result.errors.push('opencode 配置内未发现 provider 字段')
    return
  }

  for (const [providerId, raw] of Object.entries(parsed.provider)) {
    if (!raw || typeof raw !== 'object') continue
    const built = buildProviderConfig(providerId, raw as OpencodeProvider)
    if (built) result.providers.push(built)
  }

  // Inject top-level selected models into their provider's model list
  injectSelectedModels(result.providers, parsed)
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Scan all known AI tool config files and return a unified list of providers.
 * Never throws — errors become entries in result.errors.
 */
export function scanAiConfigs(): AiConfigScanResult {
  const result: AiConfigScanResult = {
    providers: [],
    errors: [],
    scannedPaths: []
  }
  scanOpencode(result)
  return result
}
