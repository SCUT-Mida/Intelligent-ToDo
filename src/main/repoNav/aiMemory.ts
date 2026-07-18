/**
 * AI Memory for Repo Navigator — Strategy B (LLM pre-generates descriptions).
 *
 * Provides:
 *   - generateMemoryEntries: batch call LLM to produce Chinese descriptions + tags
 *   - searchRepos: semantic search over memory using LLM
 *   - loadMemory / saveMemory / getMemoryPath: persistent storage
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { callLLM } from '../aiClient'
import type { RepoEntry, RepoNavConfig, RepoMemory, RepoMemoryEntry, RankedRepoMatch, CommandTemplate } from '../../shared/repoNav'
import { DEFAULT_TEMPLATES } from '../../shared/repoNav'

// ── Path helpers ───────────────────────────────────────────────────────────

/** Ensure the .repo-navigator directory exists. */
function ensureDir(): string {
  const dir = join(homedir(), '.repo-navigator')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Returns the path to the repo memory JSON file.
 * Same directory as index.json (~/.repo-navigator/repo-memory.json).
 */
export function getMemoryPath(): string {
  return join(ensureDir(), 'repo-memory.json')
}

// ── Persistence ────────────────────────────────────────────────────────────

/**
 * Load repo memory from disk.
 * Returns null if the file does not exist or is corrupted.
 */
export function loadMemory(): RepoMemory | null {
  try {
    const path = getMemoryPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RepoMemory>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return null
    return parsed as RepoMemory
  } catch {
    return null
  }
}

/**
 * Save repo memory to disk atomically (write to temp file, then rename).
 */
export function saveMemory(memory: RepoMemory): void {
  const path = getMemoryPath()
  const tmpPath = path + '.tmp.' + Date.now()
  try {
    writeFileSync(tmpPath, JSON.stringify(memory, null, 2), 'utf-8')
    renameSync(tmpPath, path)
  } catch (err) {
    // Clean up temp file if rename failed
    try { if (existsSync(tmpPath)) renameSync(tmpPath, path) } catch { /* ignore */ }
    throw err
  }
}

// ── Prompt helpers ─────────────────────────────────────────────────────────

/** Build a compact repo list for the LLM prompt (capped at 200 entries). */
function buildMemoryListPrompt(entries: RepoMemoryEntry[]): string {
  const slice = entries.slice(0, 200)
  return slice
    .map((e, i) => `${i}. ${e.name} | ${e.path} | ${e.description ?? '（无描述）'} | 标签：${e.tags.join(', ') || '（无标签）'}`)
    .join('\n')
}

/** Build metadata array for batch generation prompt. */
function buildRepoMetadataBatch(repos: RepoEntry[]): string {
  return repos
    .map((r, idx) => ({
      index: idx,
      name: r.name,
      path: r.path,
      remoteUrl: r.remoteUrl,
      lastCommitMessage: r.lastCommitMessage
    }))
    .map((r) => JSON.stringify(r))
    .join(',\n')
}

// ── JSON extraction (similar to main/index.ts extractJson but for arrays) ──

/**
 * Extract a JSON array from an LLM response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns the parsed array or null.
 */
function extractJsonArray(content: string): unknown[] | null {
  if (!content) return null
  // Strip markdown code fences ```json ... ``` or ``` ... ```
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
  // Find the first '[' and matching last ']'
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = candidate.slice(start, end + 1)
  try {
    const parsed = JSON.parse(slice)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// ── Main functions ─────────────────────────────────────────────────────────

/**
 * Generate AI descriptions + tags for a list of repos using batch LLM calls.
 *
 * Processes repos in batches of config.memoryBatchSize (default 5).
 * All repos always appear in the output; per-repo LLM failures result in
 * description: null + tags: [].
 */
export async function generateMemoryEntries(
  repos: RepoEntry[],
  config: RepoNavConfig,
  aiConfig: { apiUrl: string; apiKey: string; model: string }
): Promise<RepoMemoryEntry[]> {
  const batchSize = config.memoryBatchSize ?? 5
  const results: RepoMemoryEntry[] = []
  const now = new Date().toISOString()

  // Pre-populate with null descriptions so nothing is lost
  const fallbackEntries: RepoMemoryEntry[] = repos.map((r) => ({
    name: r.name,
    path: r.path,
    description: null,
    tags: [],
    generatedAt: now
  }))

  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize)
    const batchEntries = fallbackEntries.slice(i, i + batchSize)

    const systemPrompt = '你是一个代码仓库分析助手。根据提供的仓库元数据，为每个仓库生成简洁的中文描述（1-2 句话）和 3-5 个相关标签。严格以 JSON 格式返回。'

    const metadataJson = buildRepoMetadataBatch(batch)
    const userPrompt =
      `以下是 ${batch.length} 个仓库的元数据：\n[\n${metadataJson}\n]\n\n` +
      '请返回 JSON 数组，每项格式为 { "index": number, "description": string, "tags": string[] }。' +
      'description 用中文简要描述该仓库的功能或用途（1-2 句话）。tags 是与该仓库相关的技术标签（如 "React", "TypeScript", "CLI" 等）。'

    try {
      const result = await callLLM({
        apiUrl: aiConfig.apiUrl,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        timeoutMs: 60000
      })

      const parsed = extractJsonArray(result.content)
      if (parsed) {
        for (const item of parsed) {
          if (typeof item !== 'object' || item === null) continue
          const obj = item as Record<string, unknown>
          const idx = obj['index']
          if (typeof idx !== 'number' || idx < 0 || idx >= batch.length) continue

          const description = typeof obj['description'] === 'string' ? obj['description'] : null
          const tagsRaw = obj['tags']
          const tags: string[] = Array.isArray(tagsRaw)
            ? tagsRaw.filter((t): t is string => typeof t === 'string')
            : []

          batchEntries[idx] = {
            ...batchEntries[idx],
            description,
            tags
          }
        }
      }
    } catch (err) {
      // Batch LLM call failed — keep batchEntries with null descriptions
      console.error('AI memory batch failed:', err)
    }

    results.push(...batchEntries)
  }

  return results
}

/**
 * Search repos using LLM semantic ranking.
 * Returns top 3 matches with scores and Chinese reasons.
 * On parse failure or empty memory, returns [].
 */
export async function searchRepos(
  query: string,
  memory: RepoMemory,
  aiConfig: { apiUrl: string; apiKey: string; model: string }
): Promise<RankedRepoMatch[]> {
  if (!memory.entries.length) return []

  const systemPrompt = '你是代码仓库搜索助手。根据用户的自然语言查询，从仓库列表中返回最相关的 3 个。严格 JSON 格式返回。'

  const memoryList = buildMemoryListPrompt(memory.entries)
  const userPrompt =
    `用户的搜索查询：${query}\n\n` +
    `仓库列表（共 ${Math.min(memory.entries.length, 200)} 个）：\n${memoryList}\n\n` +
    '请返回 JSON 数组，每项格式为 { "index": number, "score": number, "reason": string }。' +
    'index 对应上方仓库的序号，score 是 0-1 之间的相关性分数，reason 是用中文说明匹配原因。' +
    '返回最相关的 3 个结果，如果没有相关结果则返回空数组 []。'

  try {
    const result = await callLLM({
      apiUrl: aiConfig.apiUrl,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      timeoutMs: 30000
    })

    const parsed = extractJsonArray(result.content)
    if (!parsed) return []

    const matches: RankedRepoMatch[] = []
    const entries = memory.entries.slice(0, 200)

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>
      const idx = obj['index']
      if (typeof idx !== 'number' || idx < 0 || idx >= entries.length) continue

      const score = typeof obj['score'] === 'number' ? Math.max(0, Math.min(1, obj['score'])) : 0
      const reason = typeof obj['reason'] === 'string' ? obj['reason'] : ''

      matches.push({
        repoPath: entries[idx].path,
        repoName: entries[idx].name,
        score,
        reason
      })
    }

    return matches
  } catch {
    return []
  }
}
