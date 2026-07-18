/**
 * AI Memory for Repo Navigator.
 *
 * Strategy: LLM analyzes each repo's metadata + README.md to produce a
 * structured { description, tags } memory entry. These entries are then
 * used purely for LOCAL substring search (no LLM at search time).
 *
 * This module provides:
 *   - readRepoReadme: best-effort README extraction
 *   - generateMemoryEntries: batched LLM call to produce tags + descriptions
 *   - loadMemory / saveMemory / getMemoryPath: persistent storage
 *
 * Removed in v1.11.5: searchRepos (LLM-based semantic search). Users
 * reported it consistently underperformed — the LLM often 'didn't see'
 * the right repo in long lists. Search is now 100% local substring
 * matching against path / name / tags / description, in the renderer.
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs'
import { join } from 'path'
import { callLLM } from '../aiClient'
import type { RepoEntry, RepoNavConfig, RepoMemory, RepoMemoryEntry } from '../../shared/repoNav'
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
    try { if (existsSync(tmpPath)) renameSync(tmpPath, path) } catch { /* ignore */ }
    throw err
  }
}

// ── README extraction ──────────────────────────────────────────────────────

/** Candidate README file names in priority order (case-insensitive scan). */
const README_CANDIDATES = [
  'README.md', 'readme.md', 'README.MD', 'Readme.md',
  'README.rst', 'README.txt', 'README',
  'readme.markdown', 'README.markdown'
]

/** Maximum characters of README content to feed to the LLM (bound prompt size). */
const MAX_README_CHARS = 4000

/**
 * Best-effort README extraction. Returns trimmed README content (up to
 * MAX_README_CHARS) or null if no README is found / readable.
 *
 * Case-insensitive scan: tries each candidate filename; first hit wins.
 * This is intentionally simple — no glob, just stat each candidate.
 */
function readRepoReadme(repoPath: string): string | null {
  for (const candidate of README_CANDIDATES) {
    const fullPath = join(repoPath, candidate)
    if (!existsSync(fullPath)) continue
    try {
      const raw = readFileSync(fullPath, 'utf-8')
      // Strip leading BOM if present, trim whitespace
      const cleaned = raw.replace(/^\uFEFF/, '').trim()
      if (!cleaned) continue // empty file = treat as not found, try next
      // Truncate to bound prompt size. Cut at word boundary if possible.
      if (cleaned.length <= MAX_README_CHARS) return cleaned
      const slice = cleaned.slice(0, MAX_README_CHARS)
      const lastSpace = slice.lastIndexOf(' ')
      return (lastSpace > MAX_README_CHARS * 0.7 ? slice.slice(0, lastSpace) : slice) + '\n[... truncated]'
    } catch {
      // Unreadable file — try next candidate
      continue
    }
  }
  return null
}

// ── Prompt helpers ─────────────────────────────────────────────────────────

/**
 * Build the per-repo context block for the LLM prompt. Includes basic
 * metadata + README excerpt (if available).
 */
function buildRepoContextBatch(repos: RepoEntry[]): string {
  return repos
    .map((r, idx) => {
      const readme = readRepoReadme(r.path)
      const block: Record<string, unknown> = {
        index: idx,
        name: r.name,
        path: r.path,
        remoteUrl: r.remoteUrl,
        lastCommitMessage: r.lastCommitMessage
      }
      if (readme) {
        block.readmeExcerpt = readme
      }
      return JSON.stringify(block)
    })
    .join(',\n')
}

// ── JSON extraction ────────────────────────────────────────────────────────

/**
 * Extract a JSON array from an LLM response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns the parsed array or null.
 */
function extractJsonArray(content: string): unknown[] | null {
  if (!content) return null
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenceMatch ? fenceMatch[1] : content
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

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Generate AI descriptions + tags for a list of repos using batched LLM calls.
 *
 * Each batch includes the repo metadata AND a README excerpt (when available),
 * giving the LLM enough context to produce meaningful tags. README inclusion
 * dramatically improves tag quality compared to metadata-only generation.
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

  // Pre-populate with null descriptions so nothing is lost if LLM fails
  const fallbackEntries: RepoMemoryEntry[] = repos.map((r) => ({
    name: r.name,
    path: r.path,
    description: null,
    tags: [],
    generatedAt: now
  }))

  logger.info('aiMemory', 'generateMemoryEntries start', {
    repoCount: repos.length,
    batchSize,
    withReadme: repos.filter((r) => readRepoReadme(r.path) !== null).length
  })

  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize)
    const batchEntries = fallbackEntries.slice(i, i + batchSize)

    const systemPrompt =
      '你是一个代码仓库分析助手。根据提供的仓库元数据（仓库名、路径、远程 URL、最近提交信息）以及 README 内容（如提供），' +
      '为每个仓库生成简洁的中文描述（1-2 句话，聚焦"这个仓库实际是做什么的"）和 3-8 个规范化标签。严格以 JSON 格式返回。'

    const contextJson = buildRepoContextBatch(batch)
    const userPrompt =
      `以下是 ${batch.length} 个仓库的元数据和 README 片段（如有）：\n[\n${contextJson}\n]\n\n` +
      '请返回 JSON 数组，每项格式为 { "index": number, "description": string, "tags": string[] }。\n\n' +
      '**description 要求**：\n' +
      '- 中文，1-2 句话\n' +
      '- 基于 README 内容（如提供）描述仓库的实际用途，避免空泛\n' +
      '- 例如："基于 React + TypeScript 的桌面待办应用，使用 Electron 打包"\n\n' +
      '**tags 要求（重要）**：\n' +
      '- 3-8 个标签\n' +
      '- **统一小写、kebab-case**（连字符分隔），便于本地搜索匹配。如 "react"、"typescript"、"electron"、"machine-learning"、"todo-app"\n' +
      '- 优先从 README 中提取真实涉及的技术栈和领域关键词\n' +
      '- 应包含以下几类：\n' +
      '  1. **主语言/框架**：react, vue, angular, nextjs, express, fastapi, spring-boot, etc.\n' +
      '  2. **运行时/平台**：nodejs, python, go, rust, java, browser, desktop, cli, mobile\n' +
      '  3. **关键能力/用途**：web-app, api, microservice, library, tool, script, automation, bot, game, etc.\n' +
      '  4. **领域/类型**（如能判断）：todo, chat, ecommerce, devops, ml, data-pipeline, etc.\n' +
      '- **不要使用中文标签**，便于搜索\n' +
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
      logger.error('aiMemory', 'batch LLM failed', {
        batchIndex: i,
        batchSize: batch.length,
        error: err instanceof Error ? err.message : String(err)
      })
    }

    results.push(...batchEntries)
  }

  logger.info('aiMemory', 'generateMemoryEntries done', {
    total: results.length,
    withDescription: results.filter((r) => r.description).length,
    withTags: results.filter((r) => r.tags.length > 0).length
  })

  return results
}
