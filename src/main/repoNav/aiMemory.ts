/**
 * AI Memory for Repo Navigator — Strategy B (LLM pre-generates descriptions).
 *
 * Provides:
 *   - generateMemoryEntries: batch call LLM to produce Chinese descriptions + tags
 *   - searchRepos: semantic search over memory using LLM
 *   - loadMemory / saveMemory / getMemoryPath: persistent storage
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { callLLM } from '../aiClient'
import type { RepoEntry, RepoNavConfig, RepoMemory, RepoMemoryEntry, RankedRepoMatch } from '../../shared/repoNav'
import { dataFilePath, migrateFromLegacy } from './paths'
import { logger } from '../logger'

// ── Path helpers ───────────────────────────────────────────────────────────

/**
 * Returns the path to the repo memory JSON file.
 * Location: <userData>/repo-nav/repo-memory.json
 * Triggers a one-time migration from the legacy ~/.repo-navigator/ location.
 */
export function getMemoryPath(): string {
  migrateFromLegacy('repo-memory.json')
  return dataFilePath('repo-memory.json')
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

    const systemPrompt =
      '你是一个代码仓库分析助手。根据提供的仓库元数据（仓库名、路径、远程 URL、最近提交信息）推断该仓库的技术栈和用途，' +
      '为每个仓库生成简洁的中文描述（1-2 句话，聚焦"这个仓库是做什么的"）和 3-8 个规范化标签。严格以 JSON 格式返回。'

    const metadataJson = buildRepoMetadataBatch(batch)
    const userPrompt =
      `以下是 ${batch.length} 个仓库的元数据：\n[\n${metadataJson}\n]\n\n` +
      '请返回 JSON 数组，每项格式为 { "index": number, "description": string, "tags": string[] }。\n\n' +
      '**description 要求**：\n' +
      '- 中文，1-2 句话\n' +
      '- 聚焦"这个仓库是做什么的"，避免空泛描述如"一个项目"\n' +
      '- 例如："基于 React + TypeScript 的桌面待办应用，使用 Electron 打包"\n\n' +
      '**tags 要求（重要）**：\n' +
      '- 3-8 个标签\n' +
      '- **统一小写、kebab-case**（连字符分隔），便于搜索匹配。如 "react"、"typescript"、"electron"、"machine-learning"、"todo-app"\n' +
      '- 应包含以下几类：\n' +
      '  1. **主语言/框架**：react, vue, angular, nextjs, express, fastapi, spring-boot, etc.\n' +
      '  2. **运行时/平台**：nodejs, python, go, rust, java, browser, desktop, cli, mobile\n' +
      '  3. **关键能力/用途**：web-app, api, microservice, library, tool, script, automation, bot, game, etc.\n' +
      '  4. **领域/类型**（如能判断）：todo, chat, ecommerce, devops, ml, data-pipeline, etc.\n' +
      '- **不要使用中文标签**，便于跨用户/跨语言搜索\n' +
      '- **不要使用过于具体的标签**（如版本号、个人项目名）\n\n' +
      '返回严格的 JSON，不要 markdown 代码块，不要多余文字。'

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
      logger.error('aiMemory', 'batch LLM failed', {
        batchIndex: i,
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err)
      })
    }

    results.push(...batchEntries)
  }

  return results
}

/**
 * Search repos using a hybrid approach:
 *   1. **Exact/fast path**: If the user's query (or any whitespace-separated
 *      token in it) matches a repo's name, tag, or path substring, return
 *      those matches immediately with high scores. No LLM call needed — fast
 *      and deterministic.
 *   2. **Semantic fallback**: If no exact matches, call the LLM for natural-
 *      language ranking. Returns top 3 matches with Chinese reasons.
 *
 * The fast path is what users expect when they type a tag like "react" —
 * previously the LLM often "didn't see" the tag and returned empty results.
 */
export async function searchRepos(
  query: string,
  memory: RepoMemory,
  aiConfig: { apiUrl: string; apiKey: string; model: string }
): Promise<RankedRepoMatch[]> {
  if (!memory.entries.length) return []

  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  // ── Step 1: Fast exact-match path ──────────────────────────────────────
  // Lowercase the query and split into tokens so "react typescript" matches
  // repos tagged with either.
  const queryLower = trimmedQuery.toLowerCase()
  const tokens = queryLower.split(/\s+/).filter((t) => t.length > 0)
  const exactMatches: Array<{ entry: RepoMemoryEntry; score: number; reason: string; matched: string }> = []

  for (const entry of memory.entries) {
    const nameLower = entry.name.toLowerCase()
    const pathLower = entry.path.toLowerCase()
    const tagsLower = entry.tags.map((t) => t.toLowerCase())

    let bestScore = 0
    let bestMatch = ''
    let bestReason = ''

    // Exact tag match (strongest signal)
    for (const tag of tagsLower) {
      if (tag === queryLower) {
        if (bestScore < 1.0) {
          bestScore = 1.0
          bestMatch = tag
          bestReason = `标签精确匹配: "${tag}"`
        }
      } else if (tag.startsWith(queryLower) || queryLower.startsWith(tag)) {
        const score = Math.min(tag.length, queryLower.length) / Math.max(tag.length, queryLower.length)
        if (score > bestScore) {
          bestScore = score
          bestMatch = tag
          bestReason = `标签前缀匹配: "${tag}"`
        }
      }
    }

    // Token-level tag containment (e.g. "react typescript" → tag "react" hits)
    if (bestScore === 0) {
      for (const token of tokens) {
        if (token.length < 2) continue
        for (const tag of tagsLower) {
          if (tag.includes(token) || token.includes(tag)) {
            const score = Math.min(token.length, tag.length) / Math.max(token.length, tag.length) * 0.85
            if (score > bestScore) {
              bestScore = score
              bestMatch = tag
              bestReason = `标签包含: "${tag}"`
            }
          }
        }
      }
    }

    // Repo name / path containment
    if (bestScore === 0) {
      if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) {
        bestScore = 0.9
        bestMatch = entry.name
        bestReason = `仓库名匹配: "${entry.name}"`
      } else if (pathLower.includes(queryLower)) {
        bestScore = 0.7
        bestMatch = queryLower
        bestReason = `路径包含: "${queryLower}"`
      }
    }

    if (bestScore > 0) {
      exactMatches.push({ entry, score: bestScore, reason: bestReason, matched: bestMatch })
    }
  }

  if (exactMatches.length > 0) {
    exactMatches.sort((a, b) => b.score - a.score)
    logger.info('aiMemory', 'search exact-match hit', {
      query: trimmedQuery,
      matched: exactMatches.length,
      top3: exactMatches.slice(0, 3).map((m) => ({ name: m.entry.name, score: m.score, matched: m.matched }))
    })
    return exactMatches.slice(0, 3).map((m) => ({
      repoPath: m.entry.path,
      repoName: m.entry.name,
      score: m.score,
      reason: m.reason
    }))
  }

  // ── Step 2: Semantic fallback via LLM ──────────────────────────────────
  logger.info('aiMemory', 'search falling back to LLM semantic', { query: trimmedQuery })

  const systemPrompt =
    '你是代码仓库搜索助手。用户用自然语言描述想找的仓库，你需要根据描述匹配最相关的仓库。' +
    '即使描述模糊（如"我那个做 todo 的项目"）也要尽量推断。严格 JSON 格式返回。'

  const memoryList = buildMemoryListPrompt(memory.entries)
  const userPrompt =
    `用户的搜索查询：${trimmedQuery}\n\n` +
    `仓库列表（共 ${Math.min(memory.entries.length, 200)} 个）：\n${memoryList}\n\n` +
    '请返回 JSON 数组，每项格式为 { "index": number, "score": number, "reason": string }。\n' +
    'index 对应上方仓库的序号（0-based），score 是 0-1 之间的相关性分数，reason 是用中文说明匹配原因。\n' +
    '返回最相关的 3 个结果。即使相关性较低，也尽量返回最接近的 3 个（用户更希望看到"近似匹配"而不是空结果）。\n' +
    '如果没有相关结果则返回空数组 []。'

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
  } catch (err) {
    logger.error('aiMemory', 'search LLM failed', {
      query: trimmedQuery,
      error: err instanceof Error ? err.message : String(err)
    })
    return []
  }
}
